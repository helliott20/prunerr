import { Router, Request, Response } from 'express';
import { z } from 'zod';
import settingsRepo from '../db/repositories/settings';
import { getStorageStats } from '../services/storage';
import logger from '../utils/logger';

/**
 * Storage from Unraid or Sonarr/Radarr, whichever is chosen and connected.
 * Every storage view in the app reads this.
 */
const router = Router();

const SourceSchema = z.object({ source: z.enum(['auto', 'unraid', 'arr']) });

// GET /api/storage/stats[?source=unraid|arr] — the optional source previews
// one without saving it.
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const requested = req.query['source'];
    const override = requested === 'unraid' || requested === 'arr' ? requested : undefined;
    res.json({ success: true, data: await getStorageStats(override) });
  } catch (error) {
    logger.error('Failed to get storage stats:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve storage stats' });
  }
});

// PUT /api/storage/source — choose where storage comes from.
router.put('/source', async (req: Request, res: Response) => {
  const parsed = SourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'source must be auto, unraid or arr' });
    return;
  }
  try {
    settingsRepo.set({ key: 'storage_source', value: parsed.data.source });
    res.json({ success: true, data: await getStorageStats() });
  } catch (error) {
    logger.error('Failed to set storage source:', error);
    res.status(500).json({ success: false, error: 'Failed to set storage source' });
  }
});

export default router;
