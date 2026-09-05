import { Router } from 'express';
import { chooseOverviewActions, discussOverviewFeed, getOverviewFeed } from '../controllers/overviewController.js';
import {
  applyCalendarProposal,
  dismissCalendarProposal,
  listCalendarProposals,
} from '../controllers/calendarController.js';
import { aiJobRateLimit } from '../middleware/rateLimit.js';

const router = Router();
const limitAi = aiJobRateLimit({ max: 30 });

router.get('/feed', getOverviewFeed);
router.post('/feed', limitAi, discussOverviewFeed);
router.post('/choices', limitAi, chooseOverviewActions);
router.get('/calendar-proposals', listCalendarProposals);
router.post('/calendar-proposals/:proposalId/apply', applyCalendarProposal);
router.post('/calendar-proposals/:proposalId/dismiss', dismissCalendarProposal);

export default router;
