import { prisma } from '../db/client.js';
import { analyzeReportContent, expandReportApproaches, refineReportContent } from '../services/aiService.js';
import { extractFileContent } from '../utils/fileParser.js';
import { resolveRequestUser } from '../middleware/auth.js';
import { assertProjectOwnership, assertReportRetentionLimit } from '../middleware/tierGate.js';
import {
  ACTION_ITEM_DISCUSSION_INCLUDE,
  serializeActionItem,
} from '../utils/actionItemView.js';
import { removeCalendarForApproaches } from '../utils/calendar.js';
import { createProgressWriter } from '../utils/aiProgress.js';
import {
  isLocalTrainingEnabled,
  isMultiPassImportEnabled,
  loadJobTimingEstimate,
  loadTrainingExamples,
  maybeRecordAccepted,
  multiPassImportCount,
  recordJobTiming,
  recordTrainingExample,
} from '../utils/aiTraining.js';
import { loadSavedUpload, removeSavedUpload, removeSavedUploadsForFile, saveUploadedFile } from '../utils/uploadStore.js';
import { redactDeep } from '../utils/secrets.js';
import { clampApproachPriority } from '../utils/jsonRepair.js';
import { attachKnownModelLimits, trainingLimitOptions } from '../utils/aiModelCatalog.js';
import { clientAbortSignal, isCanceledError, throwIfCanceled } from '../utils/requestAbort.js';
import {
  allApproachesComplete,
  atPriorityCap,
  findMatchingReport,
  remainingPrioritySlots,
  selectNewApproaches,
  totalRemainingSlots,
} from '../utils/reportApproaches.js';

function itemsFingerprint(items) {
  return JSON.stringify(
    (Array.isArray(items) ? items : []).map((item) => ({
      title: String(item.title || '').trim().toLowerCase(),
      description: String(item.description || '').trim().toLowerCase(),
      priority: Number(item.priority) || 0,
    }))
  );
}

async function appendApproaches(tx, { projectId, reportId, items }) {
  const created = [];
  for (const [index, item] of items.entries()) {
    created.push(
      await tx.aIActionItem.create({
        data: {
          projectId,
          reportId,
          title: item.title,
          description: item.description ?? null,
          priority: clampApproachPriority(item.priority, index),
        },
      })
    );
  }
  return created;
}

function reportPayload(report) {
  return {
    id: report.id,
    projectId: report.projectId,
    fileName: report.fileName,
    nickname: report.nickname || null,
    fileType: report.fileType,
    fileSize: report.fileSize,
    parsedAt: report.parsedAt,
    createdAt: report.createdAt,
  };
}

function itemPayload(item) {
  return {
    id: item.id,
    projectId: item.projectId,
    reportId: item.reportId,
    title: item.title,
    description: item.description,
    priority: item.priority,
    completed: item.completed,
  };
}

async function runImportAnalysis({
  req,
  progress,
  content,
  readUpload,
  useMultiPass,
  passCount,
  loadExamples,
}) {
  let analysis;
  let firstPassItems = [];
  let latestContent = content;

  if (useMultiPass) {
    let actionItems = [];
    for (let pass = 1; pass <= passCount; pass += 1) {
      throwIfCanceled(req);
      const percent = 14 + Math.round(((pass - 1) / passCount) * 78);
      progress.stage(`Pass ${pass} of ${passCount}`, percent);
      ({ content: latestContent } = await readUpload());
      const examples = await loadExamples();
      const onPassProgress = () => progress.stage(`Pass ${pass} of ${passCount}`, percent);
      if (pass === 1) {
        const result = await analyzeReportContent(req, latestContent, onPassProgress, examples);
        actionItems = result.actionItems;
        firstPassItems = result.actionItems;
        analysis = result;
      } else {
        actionItems = await refineReportContent(
          req,
          latestContent,
          actionItems,
          onPassProgress,
          examples,
          { pass, passCount }
        );
        analysis = { ...analysis, actionItems };
      }
    }
  } else {
    const examples = await loadExamples();
    analysis = await analyzeReportContent(req, latestContent, progress.stage, examples);
  }

  return { analysis, firstPassItems, content: latestContent };
}

async function expandExistingReport({
  req,
  progress,
  user,
  projectId,
  report,
  content,
  countCompleted,
  requireComplete,
  useLocalTraining,
}) {
  const existingItems =
    report.actionItems ||
    (await prisma.aIActionItem.findMany({
      where: { reportId: report.id, projectId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    }));

  if (requireComplete && !allApproachesComplete(existingItems)) {
    const error = new Error('Complete every approach on this file before refreshing findings.');
    error.statusCode = 409;
    error.code = 'APPROACHES_INCOMPLETE';
    throw error;
  }

  const remaining = remainingPrioritySlots(existingItems, { countCompleted });
  if (totalRemainingSlots(remaining) <= 0) {
    return {
      report,
      added: [],
      truncated: atPriorityCap(existingItems),
      analysis: { analysisSource: 'ai' },
    };
  }

  progress.stage('Expanding', 24);
  throwIfCanceled(req);
  const examples = useLocalTraining
    ? await loadTrainingExamples(prisma, {
        userId: user.id,
        projectId,
        kind: 'report-parse',
        ...trainingLimitOptions(req),
      })
    : [];
  const analysis = await expandReportApproaches(
    req,
    content,
    existingItems,
    remaining,
    progress.stage,
    examples
  );
  const { accepted, truncated } = selectNewApproaches(analysis.actionItems, existingItems, {
    countCompleted,
  });

  const added = accepted.length
    ? await prisma.$transaction((tx) =>
        appendApproaches(tx, { projectId, reportId: report.id, items: accepted })
      )
    : [];

  if (useLocalTraining && added.length) {
    await maybeRecordAccepted(prisma, {
      userId: user.id,
      projectId,
      kind: 'report-parse',
      input: content,
      items: accepted,
      force: true,
    });
  }

  return { report, added, truncated, analysis };
}

/**
 * POST /api/projects/:projectId/reports/upload
 *
 * Accepts a multipart file upload, extracts content,
 * sends it to the configured AI provider, and persists parsed action items
 * scoped strictly to the target project_id.
 */
export async function uploadReport(req, res) {
  const progress = createProgressWriter(req, res);
  let savedPath = '';
  try {
    clientAbortSignal(req);
    throwIfCanceled(req);
    const user = resolveRequestUser(req);
    if (!user) {
      return progress.fail(401, { error: 'Authentication required.' });
    }

    const { projectId } = req.params;

    if (!req.file) {
      return progress.fail(400, { error: 'No file uploaded.' });
    }

    await assertProjectOwnership(projectId, user.id);
    await attachKnownModelLimits(req, { userId: user.id });

    const useLocalTraining = isLocalTrainingEnabled(req);
    const useMultiPass = isMultiPassImportEnabled(req);
    const passCount = useMultiPass ? multiPassImportCount(req) : 1;
    const jobStartedAt = Date.now();
    req._jobKind = 'import';
    req._jobFileBytes = req.file.size;
    req._jobPassCount = passCount;
    req._jobStartedAt = jobStartedAt;
    if (useLocalTraining) {
      req._expectedJobMs = await loadJobTimingEstimate(prisma, user.id, {
        job: 'import',
        fileBytes: req.file.size,
        passCount,
        inputChars: 0,
      });
      if (req._expectedJobMs) {
        progress.stage({
          step: useMultiPass ? 'Saving' : 'Reading',
          percent: useMultiPass ? 6 : 10,
          remainingMs: req._expectedJobMs,
          trained: true,
        });
      }
    }
    if (useMultiPass) {
      progress.stage('Saving', 6);
      savedPath = await saveUploadedFile({
        userId: user.id,
        projectId,
        originalname: req.file.originalname,
        buffer: req.file.buffer,
      });
    }

    const readUpload = async () => {
      const file = savedPath
        ? await loadSavedUpload(savedPath, req.file.originalname)
        : req.file;
      return extractFileContent(file);
    };

    progress.stage('Reading', 10);
    let { content, fileType } = await readUpload();

    if (!content.trim()) {
      return progress.fail(400, { error: 'Uploaded file contained no readable text.' });
    }

    const loadExamples = () =>
      useLocalTraining
        ? loadTrainingExamples(prisma, {
            userId: user.id,
            projectId,
            kind: 'report-parse',
            ...trainingLimitOptions(req),
          })
        : Promise.resolve([]);

    const matchingReport = await findMatchingReport(
      prisma,
      projectId,
      req.file.originalname,
      content,
      { fileSize: req.file.size }
    );

    if (matchingReport) {
      let analysis = { actionItems: [], analysisSource: 'ai' };
      try {
        const ran = await runImportAnalysis({
          req,
          progress,
          content,
          readUpload,
          useMultiPass,
          passCount,
          loadExamples,
        });
        analysis = ran.analysis;
        content = ran.content;
      } catch (error) {
        if (!/did not include any action items/i.test(String(error.message || ''))) {
          throw error;
        }
      }

      const existingItems = matchingReport.actionItems || [];
      let { accepted, truncated } = selectNewApproaches(analysis.actionItems || [], existingItems, {
        countCompleted: true,
      });

      let considered = [...existingItems, ...accepted];
      let remaining = remainingPrioritySlots(considered, { countCompleted: true });
      if (totalRemainingSlots(remaining) > 0) {
        progress.stage('Expanding', 82);
        const extra = await expandReportApproaches(
          req,
          content,
          considered,
          remaining,
          progress.stage,
          await loadExamples()
        );
        const more = selectNewApproaches(extra.actionItems || [], considered, {
          countCompleted: true,
        });
        accepted = [...accepted, ...more.accepted];
        truncated = truncated || more.truncated;
        considered = [...existingItems, ...accepted];
      }

      const added = accepted.length
        ? await prisma.$transaction((tx) =>
            appendApproaches(tx, { projectId, reportId: matchingReport.id, items: accepted })
          )
        : [];

      if (useLocalTraining) {
        await recordJobTiming(prisma, {
          userId: user.id,
          job: 'import',
          fileBytes: req.file.size,
          passCount,
          inputChars: String(content || '').length,
          elapsedMs: Date.now() - jobStartedAt,
        });
      }
      if (useLocalTraining && added.length) {
        await maybeRecordAccepted(prisma, {
          userId: user.id,
          projectId,
          kind: 'report-parse',
          input: content,
          items: accepted,
          force: true,
        });
      }

      progress.stage('Done', 100);
      const atCap = truncated || atPriorityCap(considered);
      return progress.done({
        message: added.length
          ? `This file was already imported. ${added.length} additional approach${added.length === 1 ? '' : 'es'} added.`
          : atCap
            ? 'This file was already imported. Complete its approaches, then refresh the file to expand findings.'
            : 'This file was already imported. No additional approaches were found for this target.',
        duplicate: true,
        expanded: added.length > 0,
        addedCount: added.length,
        atCap,
        report: reportPayload(matchingReport),
        actionItems: added.map(itemPayload),
        analysisSource: analysis.analysisSource,
        analysisWarning: analysis.analysisWarning,
        stats: {
          actionItemCount: added.length,
        },
      });
    }

    await assertReportRetentionLimit(user.id, projectId);

    let { analysis, firstPassItems, content: parsedContent } = await runImportAnalysis({
      req,
      progress,
      content,
      readUpload,
      useMultiPass,
      passCount,
      loadExamples,
    });
    content = parsedContent;

    const parsedItems = analysis.actionItems;
    const { accepted: cappedItems } = selectNewApproaches(parsedItems, [], {
      countCompleted: true,
    });
    analysis = { ...analysis, actionItems: cappedItems };

    const result = await prisma.$transaction(async (tx) => {
      const report = await tx.uploadedReport.create({
        data: {
          projectId,
          fileName: req.file.originalname,
          fileType,
          fileSize: req.file.size,
          rawContent: content.slice(0, 500_000),
        },
      });

      const createdItems = await appendApproaches(tx, {
        projectId,
        reportId: report.id,
        items: analysis.actionItems,
      });

      return { report, actionItems: createdItems };
    });

    if (useLocalTraining) {
      await recordJobTiming(prisma, {
        userId: user.id,
        job: 'import',
        fileBytes: req.file.size,
        passCount,
        inputChars: String(content || '').length,
        elapsedMs: Date.now() - jobStartedAt,
      });
      await maybeRecordAccepted(prisma, {
        userId: user.id,
        projectId,
        kind: 'report-parse',
        input: content,
        items: analysis.actionItems,
        force: useMultiPass,
      });
      if (
        useMultiPass &&
        firstPassItems.length &&
        itemsFingerprint(firstPassItems) !== itemsFingerprint(parsedItems)
      ) {
        await recordTrainingExample(prisma, {
          userId: user.id,
          projectId,
          kind: 'report-parse',
          input: content,
          output: {
            type: 'correction',
            mistake: JSON.stringify(firstPassItems).slice(0, 2500),
            userCorrection:
              'A later re-read of the same saved report corrected the first pass. Prefer the later extraction.',
          },
        });
      }
    }

    progress.stage('Done', 100);
    return progress.done({
      message: result.actionItems.length
        ? 'Report uploaded and parsed successfully.'
        : 'Report uploaded. No approaches matched this import target.',
      report: reportPayload(result.report),
      actionItems: result.actionItems.map(itemPayload),
      analysisSource: analysis.analysisSource,
      analysisWarning: analysis.analysisWarning,
      stats: {
        actionItemCount: result.actionItems.length,
      },
    }, 201);
  } catch (error) {
    await removeSavedUpload(savedPath);
    if (isCanceledError(error)) {
      return progress.fail(499, { error: 'Import canceled.', code: 'REQUEST_CANCELED' });
    }
    console.error('[uploadReport]', redactDeep(error));

    const status = error.statusCode || 500;
    return progress.fail(status, {
      error: error.message || 'Failed to process uploaded report.',
      code: error.code,
    });
  }
}

/**
 * POST /api/projects/:projectId/reports/:reportId/expand
 * Adds more approaches to an existing file after its current approaches are complete.
 */
export async function expandReport(req, res) {
  const progress = createProgressWriter(req, res);
  try {
    clientAbortSignal(req);
    throwIfCanceled(req);
    const user = resolveRequestUser(req);
    if (!user) {
      return progress.fail(401, { error: 'Authentication required.' });
    }

    const { projectId, reportId } = req.params;
    await assertProjectOwnership(projectId, user.id);
    await attachKnownModelLimits(req, { userId: user.id });

    const report = await prisma.uploadedReport.findFirst({
      where: { id: reportId, projectId },
      include: { actionItems: true },
    });

    if (!report) {
      return progress.fail(404, { error: 'Uploaded file not found.' });
    }

    if (!String(report.rawContent || '').trim()) {
      return progress.fail(400, { error: 'This file has no saved content to expand.' });
    }

    const useLocalTraining = isLocalTrainingEnabled(req);
    req._jobKind = 'import';
    req._jobFileBytes = Number(report.fileSize) || 0;
    req._jobPassCount = 1;
    req._jobStartedAt = Date.now();
    if (useLocalTraining) {
      req._expectedJobMs = await loadJobTimingEstimate(prisma, user.id, {
        job: 'import',
        fileBytes: Number(report.fileSize) || 0,
        passCount: 1,
        inputChars: String(report.rawContent || '').length,
      });
    }
    const expanded = await expandExistingReport({
      req,
      progress,
      user,
      projectId,
      report,
      content: report.rawContent,
      countCompleted: false,
      requireComplete: true,
      useLocalTraining,
    });

    if (useLocalTraining) {
      await recordJobTiming(prisma, {
        userId: user.id,
        job: 'import',
        fileBytes: Number(report.fileSize) || 0,
        passCount: 1,
        inputChars: String(report.rawContent || '').length,
        elapsedMs: Date.now() - req._jobStartedAt,
      });
    }

    progress.stage('Done', 100);
    return progress.done({
      message: expanded.added.length
        ? 'Additional approaches were added from this file.'
        : 'No additional approaches were found.',
      expanded: expanded.added.length > 0,
      addedCount: expanded.added.length,
      atCap: atPriorityCap([...(report.actionItems || []), ...expanded.added]),
      report: reportPayload(report),
      actionItems: expanded.added.map(itemPayload),
      analysisSource: expanded.analysis?.analysisSource,
      analysisWarning: expanded.analysis?.analysisWarning,
      stats: {
        actionItemCount: expanded.added.length,
      },
    });
  } catch (error) {
    if (isCanceledError(error)) {
      return progress.fail(499, { error: 'Import canceled.', code: 'REQUEST_CANCELED' });
    }
    console.error('[expandReport]', redactDeep(error));
    const status = error.statusCode || 500;
    return progress.fail(status, {
      error: error.message || 'Failed to expand uploaded report.',
      code: error.code,
    });
  }
}

/**
 * GET /api/projects/:projectId/reports
 * Returns the upload timeline for a single project container.
 */
export async function listProjectReports(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { projectId } = req.params;
    await assertProjectOwnership(projectId, user.id);

    const reports = await prisma.uploadedReport.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        fileName: true,
        nickname: true,
        fileType: true,
        fileSize: true,
        parsedAt: true,
        createdAt: true,
        _count: { select: { actionItems: true } },
      },
    });

    return res.json({ projectId, reports });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

/**
 * GET /api/projects/:projectId/action-items
 * Returns the prioritized checklist scoped to a project.
 */
export async function listProjectActionItems(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { projectId } = req.params;
    await assertProjectOwnership(projectId, user.id);

    const actionItems = await prisma.aIActionItem.findMany({
      where: { projectId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      include: ACTION_ITEM_DISCUSSION_INCLUDE,
    });

    return res.json({
      projectId,
      actionItems: actionItems.map(serializeActionItem),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

/**
 * PATCH /api/projects/:projectId/action-items/:itemId
 * Toggle completion state on a checklist item.
 */
export async function updateActionItem(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { projectId, itemId } = req.params;
    await assertProjectOwnership(projectId, user.id);

    const existing = await prisma.aIActionItem.findFirst({
      where: { id: itemId, projectId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Action item not found.' });
    }

    const completed =
      typeof req.body?.completed === 'boolean'
        ? req.body.completed
        : !existing.completed;

    const updated = await prisma.aIActionItem.update({
      where: { id: itemId },
      data: { completed },
      include: ACTION_ITEM_DISCUSSION_INCLUDE,
    });

    return res.json({ actionItem: serializeActionItem(updated) });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function deleteApproachesByIds({ userId, itemIds = [], projectId = null } = {}) {
  const ids = [...new Set((itemIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length || !userId) return [];

  const found = await prisma.aIActionItem.findMany({
    where: {
      id: { in: ids },
      ...(projectId ? { projectId } : {}),
      project: { userId },
    },
    select: { id: true, title: true, projectId: true },
  });
  if (!found.length) return [];

  const grouped = new Map();
  for (const row of found) {
    const list = grouped.get(row.projectId) || [];
    list.push(row);
    grouped.set(row.projectId, list);
  }

  await prisma.$transaction(async (tx) => {
    for (const [ownedProjectId, ownedItems] of grouped.entries()) {
      await removeCalendarForApproaches(tx, { projectId: ownedProjectId, items: ownedItems });
      await tx.aIActionItem.deleteMany({
        where: { id: { in: ownedItems.map((row) => row.id) }, projectId: ownedProjectId },
      });
    }
  });

  return found;
}

/**
 * DELETE /api/projects/:projectId/action-items/:itemId
 */
export async function deleteActionItem(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { projectId, itemId } = req.params;
    await assertProjectOwnership(projectId, user.id);

    const deleted = await deleteApproachesByIds({
      userId: user.id,
      projectId,
      itemIds: [itemId],
    });
    if (!deleted.length) {
      return res.status(404).json({ error: 'Approach not found.' });
    }

    return res.json({
      ok: true,
      id: deleted[0].id,
      deletedItemIds: deleted.map((row) => row.id),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function updateReportNickname(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { projectId, reportId } = req.params;
    await assertProjectOwnership(projectId, user.id);

    const existing = await prisma.uploadedReport.findFirst({
      where: { id: reportId, projectId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Uploaded file not found.' });
    }

    const nickname = String(req.body?.nickname || '').trim() || null;

    const report = await prisma.uploadedReport.update({
      where: { id: existing.id },
      data: { nickname },
      select: {
        id: true,
        projectId: true,
        fileName: true,
        nickname: true,
        fileType: true,
        fileSize: true,
        parsedAt: true,
        createdAt: true,
      },
    });

    return res.json({ report });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export async function deleteReport(req, res) {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { projectId, reportId } = req.params;
    await assertProjectOwnership(projectId, user.id);

    const existing = await prisma.uploadedReport.findFirst({
      where: { id: reportId, projectId },
      select: { id: true, fileName: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Uploaded file not found.' });
    }

    const items = await prisma.aIActionItem.findMany({
      where: { reportId: existing.id, projectId },
      select: { id: true, title: true },
    });
    const itemIds = items.map((row) => row.id);

    await prisma.$transaction(async (tx) => {
      if (items.length) {
        await removeCalendarForApproaches(tx, { projectId, items });
        await tx.aIActionItem.deleteMany({
          where: { id: { in: itemIds } },
        });
      }
      await tx.uploadedReport.delete({ where: { id: existing.id } });
    });

    await removeSavedUploadsForFile({
      userId: user.id,
      projectId,
      originalname: existing.fileName,
    }).catch(() => {});

    return res.json({ ok: true, id: existing.id, deletedItemIds: itemIds });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
}

export default {
  uploadReport,
  expandReport,
  listProjectReports,
  listProjectActionItems,
  updateActionItem,
  deleteActionItem,
  updateReportNickname,
  deleteReport,
};
