import { prisma } from '../db/client.js';
import { resolveRequestUser } from '../middleware/auth.js';
import { discussOverview, recommendOverviewChoices } from '../services/aiService.js';
import { loadProjectsOverview, sanitizeOverviewChoices } from '../utils/projectOverview.js';
import { createProgressWriter } from '../utils/aiProgress.js';
import { redactDeep } from '../utils/secrets.js';
import { persistCalendarProposals, loadUpcomingCalendarForUser, applyPendingCalendarProposals, dismissPendingCalendarProposals } from './calendarController.js';
import { deleteApproachesByIds } from './uploadController.js';
import {
  serializeCalendarEntry,
  serializeCalendarProposal,
  isScheduleApprovalMessage,
  isScheduleRejectionMessage,
} from '../utils/calendar.js';
import { captureDiscussTraining, isLocalTrainingEnabled, loadTrainingExamples } from '../utils/aiTraining.js';
import { attachKnownModelLimits, trainingLimitOptions } from '../utils/aiModelCatalog.js';
import { readUserClock } from '../utils/userTime.js';

const FEED_LIMIT = 12;

function serializeMessage(entry) {
  return {
    id: entry.id,
    role: entry.role,
    content: entry.content,
    createdAt: entry.createdAt,
  };
}

function sanitizeFeedHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && (row.role === 'user' || row.role === 'assistant'))
    .map((row, index) => ({
      id: String(row.id || `feed-${index}`).slice(0, 80),
      role: row.role,
      content: String(row.content || '').trim().slice(0, 4000),
      createdAt: row.createdAt || new Date().toISOString(),
    }))
    .filter((row) => row.content)
    .slice(-FEED_LIMIT);
}

function appendFeedMessages(history, entries) {
  const now = Date.now();
  return [
    ...sanitizeFeedHistory(history),
    ...entries
      .filter((row) => row?.content)
      .map((row, index) => ({
        id: row.id || `feed-${now}-${index}`,
        role: row.role,
        content: String(row.content).trim().slice(0, 4000),
        createdAt: new Date().toISOString(),
      })),
  ];
}

async function listFeed(userId, messages = []) {
  const projects = await prisma.project.findMany({
    where: { userId },
    select: { id: true },
  });
  const projectIds = projects.map((row) => row.id);
  const [proposals, upcomingCalendar] = await Promise.all([
    prisma.calendarProposal.findMany({
      where: { userId, status: 'pending', source: 'overview' },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
      take: 12,
    }),
    loadUpcomingCalendarForUser(userId, projectIds),
  ]);
  return {
    messages: messages.map(serializeMessage),
    proposals: proposals.map(serializeCalendarProposal),
    upcomingCalendar,
  };
}

export async function getOverviewFeed(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    await prisma.overviewFeedMessage.deleteMany({ where: { userId: user.id } });
    return res.json(await listFeed(user.id));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function discussOverviewFeed(req, res) {
  const progress = createProgressWriter(req, res);
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return progress.fail(401, { error: 'Authentication required.' });
    }
    await attachKnownModelLimits(req, { userId: user.id });

    const message = String(req.body?.message || '').trim().slice(0, 2000);
    if (!message) {
      return progress.fail(400, { error: 'Message is required.' });
    }

    const history = sanitizeFeedHistory(req.body?.history);
    const pendingWhere = { userId: user.id, status: 'pending', source: 'overview' };
    const pendingCount = await prisma.calendarProposal.count({ where: pendingWhere });
    if (pendingCount && isScheduleApprovalMessage(message)) {
      progress.stage('Saving', 45);
      await applyPendingCalendarProposals({ userId: user.id, source: 'overview' });
      progress.stage('Done', 100);
      return progress.done({
        ...(await listFeed(
          user.id,
          appendFeedMessages(history, [
            { role: 'user', content: message },
            {
              role: 'assistant',
              content: 'Confirmed. Those schedule changes are on the calendar now.',
            },
          ])
        )),
        source: 'user',
      });
    }
    if (pendingCount && isScheduleRejectionMessage(message)) {
      await dismissPendingCalendarProposals({ userId: user.id, source: 'overview' });
      progress.stage('Done', 100);
      return progress.done({
        ...(await listFeed(
          user.id,
          appendFeedMessages(history, [
            { role: 'user', content: message },
            {
              role: 'assistant',
              content: 'Okay — I left the calendar as it is.',
            },
          ])
        )),
        source: 'user',
      });
    }

    progress.stage('Reading', 10);
    const overview = await loadUserOverview(user.id);
    const projectIds = (overview.projects || []).map((row) => row.id);
    const calendar = projectIds.length
      ? (
          await prisma.calendarEntry.findMany({
            where: { projectId: { in: projectIds } },
            orderBy: { startAt: 'asc' },
            take: 24,
            include: {
              project: { select: { name: true } },
              item: { select: { id: true, title: true, description: true, priority: true, completed: true } },
            },
          })
        ).map(serializeCalendarEntry)
      : [];
    const approaches = projectIds.length
      ? await prisma.aIActionItem.findMany({
          where: { projectId: { in: projectIds }, completed: false },
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
          take: 40,
          select: { id: true, projectId: true, title: true, description: true, priority: true, completed: true },
        })
      : [];

    const examples = isLocalTrainingEnabled(req)
      ? await loadTrainingExamples(prisma, {
          userId: user.id,
          kind: 'overview-feed',
          ...trainingLimitOptions(req),
        })
      : [];
    const result = await discussOverview(
      req,
      overview,
      history,
      message,
      progress.stage,
      req.body?.choices ? sanitizeOverviewChoices(overview, req.body.choices) : null,
      calendar,
      readUserClock(req.body?.clock || {}),
      examples,
      approaches
    );

    const persisted = await persistCalendarProposals({
      userId: user.id,
      proposals: result.proposals,
      source: 'overview',
      applyImmediately: Boolean(result.applyImmediately),
    });

    const deleted = result.deleteApproaches?.length
      ? await deleteApproachesByIds({
          userId: user.id,
          itemIds: result.deleteApproaches.map((row) => row.id),
        })
      : [];

    await captureDiscussTraining(prisma, {
      req,
      userId: user.id,
      kind: 'overview-feed',
      history,
      userMessage: message,
      reply: result.reply,
      fromDump: Boolean(result.dumpRecovered),
    });

    progress.stage('Done', 100);
    return progress.done({
      ...(await listFeed(
        user.id,
        appendFeedMessages(history, [
          { role: 'user', content: message },
          result.reply ? { role: 'assistant', content: result.reply } : null,
        ].filter(Boolean))
      )),
      entries: persisted.entries,
      deletedItemIds: deleted.map((row) => row.id),
      source: result.source,
    });
  } catch (error) {
    console.error('[discussOverviewFeed]', redactDeep(error));
    const status = error.statusCode || 500;
    return progress.fail(status, { error: error.message, code: error.code });
  }
}

async function loadUserOverview(userId) {
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: {
        select: {
          uploadedReports: true,
          actionItems: true,
        },
      },
    },
  });
  return loadProjectsOverview(prisma, projects);
}

export async function chooseOverviewActions(req, res) {
  const progress = createProgressWriter(req, res);
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return progress.fail(401, { error: 'Authentication required.' });
    }
    await attachKnownModelLimits(req, { userId: user.id });

    progress.stage('Reading', 10);
    const overview = await loadUserOverview(user.id);
    if (!overview?.projects?.length) {
      return progress.done({ choices: null, source: 'ai' });
    }

    const result = await recommendOverviewChoices(req, overview, progress.stage);
    progress.stage('Done', 100);
    return progress.done({
      choices: result.choices,
      source: result.source,
    });
  } catch (error) {
    console.error('[chooseOverviewActions]', redactDeep(error));
    const status = error.statusCode || 500;
    return progress.fail(status, { error: error.message, code: error.code });
  }
}
