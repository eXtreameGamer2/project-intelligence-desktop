import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import multer from 'multer';
import { prisma } from '../db/client.js';
import { removeCalendarForProject } from '../utils/calendar.js';
import {
  assertProjectOwnership,
  enforcePaidSharing,
} from '../middleware/tierGate.js';
import { resolveRequestUser } from '../middleware/auth.js';
import reportRoutes from './reportRoutes.js';
import {
  listProjectActionItems,
  updateActionItem,
  deleteActionItem,
} from '../controllers/uploadController.js';
import {
  analyzeSavedSuggestions,
  completeItemSuggestion,
  discussItem,
  generateItemSuggestions,
  getActionItem,
  saveItemSuggestion,
  unsaveItemSuggestion,
} from '../controllers/discussionController.js';
import {
  createCalendarEntry,
  deleteCalendarEntry,
  listCalendar,
  loadUpcomingCalendarForUser,
  updateCalendarEntry,
} from '../controllers/calendarController.js';
import {
  ACTION_ITEM_LIST_INCLUDE,
  serializeActionItem,
} from '../utils/actionItemView.js';
import { loadProjectsOverview } from '../utils/projectOverview.js';
import { serializeCalendarEntry, serializeCalendarProposal } from '../utils/calendar.js';
import { removeProjectUploads } from '../utils/uploadStore.js';

const suggestionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router = Router();

async function loadProjectDashboard(project, userId) {
  const [reports, actionItems, calendar, proposals] = await Promise.all([
    prisma.uploadedReport.findMany({
      where: { projectId: project.id },
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
    }),
    prisma.aIActionItem.findMany({
      where: { projectId: project.id },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      include: ACTION_ITEM_LIST_INCLUDE,
    }),
    prisma.calendarEntry.findMany({
      where: { projectId: project.id },
      orderBy: { startAt: 'asc' },
      include: {
        item: { select: { id: true, title: true, description: true, priority: true, completed: true } },
      },
    }),
    prisma.calendarProposal.findMany({
      where: { userId, projectId: project.id, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
    }),
  ]);

  return {
    project,
    reports,
    actionItems: actionItems.map(serializeActionItem),
    calendar: calendar.map(serializeCalendarEntry),
    calendarProposals: proposals.map(serializeCalendarProposal),
  };
}

router.get('/', async (req, res) => {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const projects = await prisma.project.findMany({
      where: { userId: user.id },
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

    const overview = await loadProjectsOverview(prisma, projects);
    const upcomingCalendar = await loadUpcomingCalendarForUser(
      user.id,
      projects.map((row) => row.id)
    );

    if (String(req.query.include || '') !== 'active') {
      return res.json({ projects, overview, upcomingCalendar });
    }

    const requestedId = String(req.query.projectId || '').trim();
    const active = projects.find((entry) => entry.id === requestedId) || projects[0];
    if (!active) {
      return res.json({
        projects,
        overview,
        upcomingCalendar,
        project: null,
        reports: [],
        actionItems: [],
        calendar: [],
        calendarProposals: [],
      });
    }

    const payload = await loadProjectDashboard(active, user.id);
    return res.json({ projects, overview, upcomingCalendar, ...payload });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Project name is required.' });
    }

    const project = await prisma.project.create({
      data: { name, userId: user.id },
    });

    return res.status(201).json({ project });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/:projectId', async (req, res) => {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const existing = await assertProjectOwnership(req.params.projectId, user.id);
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Project name is required.' });
    }

    const project = await prisma.project.update({
      where: { id: existing.id },
      data: { name },
      include: {
        _count: {
          select: {
            uploadedReports: true,
            actionItems: true,
          },
        },
      },
    });

    return res.json({ project });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
});

router.delete('/:projectId', async (req, res) => {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const existing = await assertProjectOwnership(req.params.projectId, user.id);
    await prisma.$transaction(async (tx) => {
      await removeCalendarForProject(tx, existing.id);
      await tx.project.delete({ where: { id: existing.id } });
    });
    await removeProjectUploads({ userId: user.id, projectId: existing.id }).catch(() => {});
    return res.json({ ok: true, id: existing.id });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const project = await assertProjectOwnership(req.params.projectId, user.id);
    return res.json(await loadProjectDashboard(project, user.id));
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message });
  }
});

router.get('/:projectId/calendar', listCalendar);
router.post('/:projectId/calendar', createCalendarEntry);
router.patch('/:projectId/calendar/:entryId', updateCalendarEntry);
router.delete('/:projectId/calendar/:entryId', deleteCalendarEntry);

router.get('/:projectId/action-items', listProjectActionItems);
router.get('/:projectId/action-items/:itemId', getActionItem);
router.patch('/:projectId/action-items/:itemId', updateActionItem);
router.delete('/:projectId/action-items/:itemId', deleteActionItem);
router.post('/:projectId/action-items/:itemId/suggestions', generateItemSuggestions);
router.post('/:projectId/action-items/:itemId/suggestions/save', saveItemSuggestion);
router.post('/:projectId/action-items/:itemId/suggestions/complete', completeItemSuggestion);
router.delete('/:projectId/action-items/:itemId/suggestions/:savedId', unsaveItemSuggestion);
router.post('/:projectId/action-items/:itemId/discuss', discussItem);
router.post(
  '/:projectId/action-items/:itemId/suggestion-analyses',
  suggestionUpload.single('file'),
  analyzeSavedSuggestions
);

router.post(
  '/:projectId/share-roadmap',
  enforcePaidSharing,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await assertProjectOwnership(projectId, req.user.id);

      const shareToken =
        project.shareToken ?? randomBytes(24).toString('hex');

      const updated = await prisma.project.update({
        where: { id: projectId },
        data: {
          shareToken,
          isPublicRoadmap: true,
        },
      });

      return res.json({
        message: 'Public roadmap link generated.',
        shareUrl: `/roadmap/${updated.shareToken}`,
        project: {
          id: updated.id,
          name: updated.name,
          isPublicRoadmap: updated.isPublicRoadmap,
        },
      });
    } catch (error) {
      const status = error.statusCode || 500;
      return res.status(status).json({ error: error.message });
    }
  }
);

router.use('/:projectId/reports', reportRoutes);

export default router;
