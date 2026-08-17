import { prisma } from '../db/client.js';
import { resolveRequestUser } from '../middleware/auth.js';
import { assertProjectOwnership } from '../middleware/tierGate.js';
import { extractFileContent } from '../utils/fileParser.js';
import {
  analyzeAgainstSavedSuggestions,
  discussApproach,
  generateApproachSuggestions,
} from '../services/aiService.js';
import {
  ACTION_ITEM_DISCUSSION_INCLUDE,
  serializeActionItem,
  serializeSuggestionAnalysis,
} from '../utils/actionItemView.js';
import { createProgressWriter } from '../utils/aiProgress.js';
import { redactDeep } from '../utils/secrets.js';
import { persistCalendarProposals, applyPendingCalendarProposals, dismissPendingCalendarProposals } from './calendarController.js';
import { deleteApproachesByIds } from './uploadController.js';
import {
  serializeCalendarEntry,
  isScheduleApprovalMessage,
  isScheduleRejectionMessage,
} from '../utils/calendar.js';
import { captureDiscussTraining, isLocalTrainingEnabled, loadTrainingExamples } from '../utils/aiTraining.js';
import { attachKnownModelLimits, trainingLimitOptions } from '../utils/aiModelCatalog.js';
import { readUserClock } from '../utils/userTime.js';

async function loadOwnedItem(req) {
  const user = resolveRequestUser(req);
  if (!user) {
    const error = new Error('Authentication required.');
    error.statusCode = 401;
    throw error;
  }

  const { projectId, itemId } = req.params;
  await assertProjectOwnership(projectId, user.id);

  const item = await prisma.aIActionItem.findFirst({
    where: { id: itemId, projectId },
    include: ACTION_ITEM_DISCUSSION_INCLUDE,
  });

  if (!item) {
    const error = new Error('Action item not found.');
    error.statusCode = 404;
    throw error;
  }

  return item;
}

export async function getActionItem(req, res) {
  try {
    const item = await loadOwnedItem(req);
    return res.json({ actionItem: serializeActionItem(item) });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function generateItemSuggestions(req, res) {
  const progress = createProgressWriter(req, res);
  try {
    progress.stage('Reading', 10);
    const item = await loadOwnedItem(req);
    await attachKnownModelLimits(req, { userId: resolveRequestUser(req)?.id });
    const result = await generateApproachSuggestions(req, item, progress.stage);

    const updated = await prisma.aIActionItem.update({
      where: { id: item.id },
      data: { suggestionsJson: JSON.stringify(result.suggestions) },
      include: ACTION_ITEM_DISCUSSION_INCLUDE,
    });

    progress.stage('Done', 100);
    return progress.done({
      actionItem: serializeActionItem(updated),
      source: result.source,
      warning: result.warning,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return progress.fail(status, { error: error.message, code: error.code });
  }
}

export async function discussItem(req, res) {
  const progress = createProgressWriter(req, res);
  try {
    progress.stage('Reading', 8);
    const item = await loadOwnedItem(req);
    const message = String(req.body?.message || '').trim();

    if (!message) {
      return progress.fail(400, { error: 'Message is required.' });
    }

    const user = resolveRequestUser(req);
    await attachKnownModelLimits(req, { userId: user.id });
    const pendingWhere = {
      userId: user.id,
      status: 'pending',
      source: 'discussion',
      itemId: item.id,
    };
    const pendingCount = await prisma.calendarProposal.count({ where: pendingWhere });
    if (pendingCount && isScheduleApprovalMessage(message)) {
      progress.stage('Saving', 45);
      const applied = await applyPendingCalendarProposals({
        userId: user.id,
        source: 'discussion',
        itemId: item.id,
      });
      await prisma.actionItemMessage.create({
        data: { itemId: item.id, role: 'user', content: message },
      });
      await prisma.actionItemMessage.create({
        data: {
          itemId: item.id,
          role: 'assistant',
          content: 'Confirmed. That schedule change is on the calendar now.',
        },
      });
      const confirmed = await prisma.aIActionItem.findUnique({
        where: { id: item.id },
        include: ACTION_ITEM_DISCUSSION_INCLUDE,
      });
      progress.stage('Done', 100);
      return progress.done({
        actionItem: serializeActionItem(confirmed),
        proposals: [],
        entries: applied.map((row) => row.entry).filter(Boolean),
        source: 'user',
      });
    }
    if (pendingCount && isScheduleRejectionMessage(message)) {
      await dismissPendingCalendarProposals({
        userId: user.id,
        source: 'discussion',
        itemId: item.id,
      });
      await prisma.actionItemMessage.create({
        data: { itemId: item.id, role: 'user', content: message },
      });
      await prisma.actionItemMessage.create({
        data: {
          itemId: item.id,
          role: 'assistant',
          content: 'Okay — I left the calendar as it is.',
        },
      });
      const dismissed = await prisma.aIActionItem.findUnique({
        where: { id: item.id },
        include: ACTION_ITEM_DISCUSSION_INCLUDE,
      });
      progress.stage('Done', 100);
      return progress.done({
        actionItem: serializeActionItem(dismissed),
        proposals: [],
        source: 'user',
      });
    }

    const [calendarRows, approaches] = await Promise.all([
      prisma.calendarEntry.findMany({
        where: { projectId: item.projectId },
        orderBy: { startAt: 'asc' },
        take: 24,
        include: {
          item: { select: { id: true, title: true, description: true, priority: true, completed: true } },
        },
      }),
      prisma.aIActionItem.findMany({
        where: { projectId: item.projectId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: 40,
        select: { id: true, projectId: true, title: true, description: true, priority: true, completed: true },
      }),
    ]);
    const calendar = calendarRows.map(serializeCalendarEntry);

    const examples = isLocalTrainingEnabled(req)
      ? await loadTrainingExamples(prisma, {
          userId: user.id,
          projectId: item.projectId,
          kind: 'project-discuss',
          ...trainingLimitOptions(req),
        })
      : [];
    const result = await discussApproach(
      req,
      item,
      item.discussion,
      message,
      progress.stage,
      calendar,
      readUserClock(req.body?.clock || {}),
      examples,
      approaches
    );

    const deletingCurrent = (result.deleteApproaches || []).some((row) => row.id === item.id);
    const persisted = deletingCurrent
      ? { proposals: [], entries: [] }
      : await persistCalendarProposals({
          userId: user.id,
          proposals: result.proposals,
          source: 'discussion',
          itemId: item.id,
          applyImmediately: Boolean(result.applyImmediately),
        });

    await captureDiscussTraining(prisma, {
      req,
      userId: user.id,
      projectId: item.projectId,
      kind: 'project-discuss',
      history: item.discussion,
      userMessage: message,
      reply: result.reply,
      fromDump: Boolean(result.dumpRecovered),
    });

    if (!deletingCurrent) {
      await prisma.actionItemMessage.create({
        data: { itemId: item.id, role: 'user', content: message },
      });

      if (result.reply) {
        await prisma.actionItemMessage.create({
          data: { itemId: item.id, role: 'assistant', content: result.reply },
        });
      }
    }

    const deleted = result.deleteApproaches?.length
      ? await deleteApproachesByIds({
          userId: user.id,
          projectId: item.projectId,
          itemIds: result.deleteApproaches.map((row) => row.id),
        })
      : [];

    if (deletingCurrent) {
      progress.stage('Done', 100);
      return progress.done({
        actionItem: null,
        deletedItemIds: deleted.map((row) => row.id),
        proposals: [],
        entries: persisted.entries,
        source: result.source,
        warning: result.warning,
      });
    }

    const updated = await prisma.aIActionItem.findUnique({
      where: { id: item.id },
      include: ACTION_ITEM_DISCUSSION_INCLUDE,
    });

    progress.stage('Done', 100);
    return progress.done({
      actionItem: serializeActionItem(updated),
      deletedItemIds: deleted.map((row) => row.id),
      proposals: persisted.proposals,
      entries: persisted.entries,
      source: result.source,
      warning: result.warning,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return progress.fail(status, { error: error.message, code: error.code });
  }
}

export async function saveItemSuggestion(req, res) {
  try {
    const item = await loadOwnedItem(req);
    const title = String(req.body?.title || '').trim();
    const detail = String(req.body?.detail || '').trim();

    if (!title) {
      return res.status(400).json({ error: 'Suggestion title is required.' });
    }

    const alreadySaved = (item.savedSuggestions || []).some(
      (entry) => !entry.completed && entry.title.toLowerCase() === title.toLowerCase()
    );
    const activeCount = (item.savedSuggestions || []).filter((entry) => !entry.completed).length;

    if (!alreadySaved && activeCount >= 3) {
      return res.status(400).json({
        error: 'You can save up to 3 suggestions as steps in this approach.',
      });
    }

    await prisma.savedSuggestion.upsert({
      where: {
        itemId_title: {
          itemId: item.id,
          title,
        },
      },
      create: {
        projectId: item.projectId,
        itemId: item.id,
        title,
        detail: detail || null,
      },
      update: {
        detail: detail || null,
      },
    });

    const updated = await prisma.aIActionItem.findUnique({
      where: { id: item.id },
      include: ACTION_ITEM_DISCUSSION_INCLUDE,
    });

    return res.json({ actionItem: serializeActionItem(updated) });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function unsaveItemSuggestion(req, res) {
  try {
    const item = await loadOwnedItem(req);
    const { savedId } = req.params;

    const existing = await prisma.savedSuggestion.findFirst({
      where: { id: savedId, itemId: item.id, projectId: item.projectId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Saved suggestion not found.' });
    }

    await prisma.savedSuggestion.delete({ where: { id: existing.id } });

    const updated = await prisma.aIActionItem.findUnique({
      where: { id: item.id },
      include: ACTION_ITEM_DISCUSSION_INCLUDE,
    });

    return res.json({ actionItem: serializeActionItem(updated) });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function completeItemSuggestion(req, res) {
  try {
    const item = await loadOwnedItem(req);
    const savedId = String(req.body?.savedId || req.params.savedId || '').trim();
    const title = String(req.body?.title || '').trim();
    const detail = String(req.body?.detail || '').trim();
    const markComplete = req.body?.completed !== false && req.body?.completed !== 'false';

    let existing = null;
    if (savedId) {
      existing = await prisma.savedSuggestion.findFirst({
        where: { id: savedId, itemId: item.id, projectId: item.projectId },
      });
    }
    if (!existing && title) {
      existing = await prisma.savedSuggestion.findFirst({
        where: { itemId: item.id, projectId: item.projectId, title },
      });
    }

    if (existing) {
      if (!markComplete) {
        const activeCount = (item.savedSuggestions || []).filter(
          (entry) => !entry.completed && entry.id !== existing.id
        ).length;
        if (activeCount >= 3) {
          return res.status(400).json({
            error: 'You can save up to 3 suggestions as steps in this approach.',
          });
        }
      }

      await prisma.savedSuggestion.update({
        where: { id: existing.id },
        data: { completed: markComplete },
      });
    } else if (markComplete) {
      if (!title) {
        return res.status(400).json({ error: 'Suggestion title is required.' });
      }

      await prisma.savedSuggestion.create({
        data: {
          projectId: item.projectId,
          itemId: item.id,
          title,
          detail: detail || null,
          completed: true,
        },
      });
    } else {
      return res.status(404).json({ error: 'Saved suggestion not found.' });
    }

    const updated = await prisma.aIActionItem.findUnique({
      where: { id: item.id },
      include: ACTION_ITEM_DISCUSSION_INCLUDE,
    });

    return res.json({ actionItem: serializeActionItem(updated) });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function analyzeSavedSuggestions(req, res) {
  const progress = createProgressWriter(req, res);
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return progress.fail(401, { error: 'Authentication required.' });
    }

    if (!req.file) {
      return progress.fail(400, { error: 'No file uploaded.' });
    }

    const { projectId } = req.params;
    await assertProjectOwnership(projectId, user.id);

    const itemId = String(req.body?.itemId || req.params.itemId || '').trim();
    const savedId = String(req.body?.savedId || req.query?.savedId || '').trim();
    const linkAllFlag = req.body?.linkAll ?? req.query?.linkAll;
    const linkAll =
      linkAllFlag === '1' ||
      linkAllFlag === 'true' ||
      linkAllFlag === true;
    const extraIds = [req.body?.savedIds, req.query?.savedIds]
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    const requestedIds = [...new Set([savedId, ...extraIds].filter(Boolean))];
    const compareAll = linkAll || requestedIds.length > 1;

    if (!itemId || !savedId) {
      return progress.fail(400, {
        error: 'Upload a file from inside a saved suggestion.',
      });
    }

    progress.stage('Reading', 12);
    const savedSuggestions = (
      await prisma.savedSuggestion.findMany({
        where: compareAll
          ? { itemId, projectId, completed: false }
          : { id: savedId, itemId, projectId, completed: false },
        orderBy: { createdAt: 'asc' },
        include: { item: { select: { title: true } } },
      })
    ).filter((entry) => !entry.completed);

    if (!savedSuggestions.some((entry) => entry.id === savedId)) {
      return progress.fail(400, {
        error: 'Save this AI suggestion before uploading a related file.',
      });
    }

    const { content, fileType } = await extractFileContent(req.file);

    if (!content.trim()) {
      return progress.fail(400, { error: 'Uploaded file contained no readable text.' });
    }

    const result = await analyzeAgainstSavedSuggestions(
      req,
      savedSuggestions,
      req.file.originalname,
      content,
      progress.stage
    );

    const created = await prisma.suggestionAnalysis.create({
      data: {
        projectId,
        itemId,
        fileName: req.file.originalname,
        fileType,
        fileSize: req.file.size,
        rawContent: content.slice(0, 500_000),
        analysis: result.analysis,
        snapshotJson: JSON.stringify(
          savedSuggestions.map((entry) => ({
            id: entry.id,
            title: entry.title,
            detail: entry.detail || '',
            itemTitle: entry.item?.title || null,
          }))
        ),
      },
    });

    const [actionItems, suggestionAnalyses] = await Promise.all([
      prisma.aIActionItem.findMany({
        where: { projectId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        include: ACTION_ITEM_DISCUSSION_INCLUDE,
      }),
      prisma.suggestionAnalysis.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    progress.stage('Done', 100);
    return progress.done({
      analysis: serializeSuggestionAnalysis(created),
      actionItems: actionItems.map(serializeActionItem),
      suggestionAnalyses: suggestionAnalyses.map(serializeSuggestionAnalysis),
      source: result.source,
      warning: result.warning,
    }, 201);
  } catch (error) {
    console.error('[analyzeSavedSuggestions]', redactDeep(error));
    const status = error.statusCode || 500;
    return progress.fail(status, { error: error.message, code: error.code });
  }
}
