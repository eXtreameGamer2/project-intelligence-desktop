import { Router } from 'express';
import multer from 'multer';
import {
  uploadReport,
  expandReport,
  listProjectReports,
  updateReportNickname,
  deleteReport,
} from '../controllers/uploadController.js';
import { aiJobRateLimit } from '../middleware/rateLimit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router = Router({ mergeParams: true });
const limitAi = aiJobRateLimit({ max: 20 });

router.get('/', listProjectReports);
router.post('/:reportId/expand', limitAi, expandReport);
router.patch('/:reportId', updateReportNickname);
router.delete('/:reportId', deleteReport);
router.post('/upload', limitAi, upload.single('file'), uploadReport);

export default router;
