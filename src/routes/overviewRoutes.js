import { Router } from 'express';
import { chooseOverviewActions, discussOverviewFeed, getOverviewFeed } from '../controllers/overviewController.js';
import {
  applyCalendarProposal,
  dismissCalendarProposal,
  listCalendarProposals,
} from '../controllers/calendarController.js';

const router = Router();

router.get('/feed', getOverviewFeed);
router.post('/feed', discussOverviewFeed);
router.post('/choices', chooseOverviewActions);
router.get('/calendar-proposals', listCalendarProposals);
router.post('/calendar-proposals/:proposalId/apply', applyCalendarProposal);
router.post('/calendar-proposals/:proposalId/dismiss', dismissCalendarProposal);

export default router;
