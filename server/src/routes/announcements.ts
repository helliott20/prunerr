import { Router, Request, Response } from 'express';

import logger from '../utils/logger';
import { getAnnouncementsState, refreshAnnouncements } from '../services/announcements';

const router = Router();

// GET /api/announcements - Everything the "What's new" panel shows
router.get('/', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getAnnouncementsState() });
  } catch (error) {
    logger.error('Failed to get announcements:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve announcements' });
  }
});

// POST /api/announcements/refresh - Fetch the remote feed now, then return the state
router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const result = await refreshAnnouncements(true);
    res.json({ success: true, data: { ...getAnnouncementsState(), refresh: result } });
  } catch (error) {
    logger.error('Failed to refresh announcements:', error);
    res.status(500).json({ success: false, error: 'Failed to refresh announcements' });
  }
});

export default router;
