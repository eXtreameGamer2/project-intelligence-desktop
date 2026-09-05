import { Router } from 'express';
import { prisma } from '../db/client.js';
import { requireAuth, resolveRequestUser } from '../middleware/auth.js';
import { aiJobRateLimit } from '../middleware/rateLimit.js';
import { testAiConnection } from '../services/aiService.js';
import { createProgressWriter } from '../utils/aiProgress.js';
import { deleteTrainingExamples } from '../utils/aiTraining.js';

const router = Router();

router.use(requireAuth);

router.delete('/training', async (req, res) => {
  try {
    const user = resolveRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const result = await deleteTrainingExamples(prisma, user.id);
    return res.json({ ok: true, deleted: result.deleted });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not delete saved examples.' });
  }
});

router.post(
  '/test-connection',
  aiJobRateLimit({ max: 12 }),
  async (req, res) => {
    const progress = createProgressWriter(req, res);
    try {
      const result = await testAiConnection(req, progress.stage);
      progress.stage('Done', 100);
      return progress.done(result);
    } catch (error) {
      return progress.fail(error.statusCode || 400, {
        ok: false,
        error: error.message,
        code: error.code,
      });
    }
  }
);

export default router;
