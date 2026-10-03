import { Router, Request, Response } from 'express';
import { UnraidService } from '../services/unraid';
import { getUnraidConfig, readUnraidStorage } from '../services/storage';
import logger from '../utils/logger';

const router = Router();

// GET /api/unraid/test - Test connection to Unraid
router.get('/test', async (_req: Request, res: Response) => {
  try {
    const unraidConfig = getUnraidConfig();
    if (!unraidConfig) {
      res.status(400).json({
        success: false,
        error: 'Unraid is not configured. Please configure it in Settings.',
      });
      return;
    }

    const unraidService = new UnraidService(unraidConfig.url, unraidConfig.apiKey);
    const isConnected = await unraidService.testConnection();

    if (isConnected) {
      res.json({
        success: true,
        message: 'Successfully connected to Unraid',
      });
    } else {
      res.status(503).json({
        success: false,
        error: 'Failed to connect to Unraid. Please check your configuration.',
      });
    }
  } catch (error) {
    logger.error('Failed to test Unraid connection:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test Unraid connection',
    });
  }
});

// GET /api/unraid/stats - Unraid array stats (kept for existing clients and
// Home Assistant; the app itself reads /api/storage/stats).
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const unraidConfig = getUnraidConfig();
    if (!unraidConfig) {
      res.json({ success: true, data: { configured: false } });
      return;
    }
    res.json({ success: true, data: await readUnraidStorage(unraidConfig) });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get Unraid stats:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    res.status(500).json({
      success: false,
      error: `Failed to retrieve Unraid array statistics: ${errorMessage}`,
    });
  }
});

export default router;
