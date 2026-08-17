import { Router } from 'express';
import { prisma } from '../db/client.js';

const router = Router();

/**
 * GET /api/roadmap/:token
 * Public read-only roadmap viewer (no authentication required).
 */
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const project = await prisma.project.findFirst({
      where: {
        shareToken: token,
        isPublicRoadmap: true,
      },
      select: {
        id: true,
        name: true,
        shareToken: true,
        updatedAt: true,
        actionItems: {
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            title: true,
            description: true,
            priority: true,
            completed: true,
            updatedAt: true,
          },
        },
        _count: {
          select: {
            uploadedReports: true,
            actionItems: true,
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        error: 'Roadmap not found or sharing is disabled.',
      });
    }

    const completedCount = project.actionItems.filter((item) => item.completed).length;

    return res.json({
      project: {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        stats: {
          reports: project._count.uploadedReports,
          actionItems: project._count.actionItems,
          completed: completedCount,
        },
      },
      actionItems: project.actionItems,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
