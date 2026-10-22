import { Router, Request, Response } from 'express';
import { buildForecast } from '../services/forecast';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/forecast[?fresh=1]
 * When current rules will reach each item over the next five years. Read-only:
 * nothing is queued or deleted.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const data = await buildForecast({ fresh: req.query['fresh'] === '1' });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Failed to build forecast:', error);
    res.status(500).json({ success: false, error: 'Failed to build forecast' });
  }
});

export default router;
