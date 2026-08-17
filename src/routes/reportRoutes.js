import { Router } from 'express';
import multer from 'multer';
import {
  uploadReport,
  expandReport,
  listProjectReports,
  updateReportNickname,
  deleteReport,
} from '../controllers/uploadController.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router = Router({ mergeParams: true });

router.get('/', listProjectReports);
router.post('/:reportId/expand', expandReport);
router.patch('/:reportId', updateReportNickname);
router.delete('/:reportId', deleteReport);
router.post('/upload', upload.single('file'), uploadReport);

export default router;
