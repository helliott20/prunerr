import { Router, Request, Response } from 'express';
import rulesRepo from '../db/repositories/rules';
import scanHistoryRepo from '../db/repositories/scanHistoryRepo';
import { scanLibraries } from '../scheduler/tasks';
import logger from '../utils/logger';

const router = Router();

// In-memory flag to prevent concurrent scans
let scanInProgress = false;

// GET /api/scan/history - Get scan history
router.get('/history', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query['limit'] as string, 10) || 50;
    const history = rulesRepo.scanHistory.getAll(limit);
    res.json({
      success: true,
      data: history,
      total: history.length,
    });
  } catch (error) {
    logger.error('Failed to get scan history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve scan history',
    });
  }
});

// GET /api/scan/cadence - Recent scan runs shaped for the Schedule cadence ribbon
router.get('/cadence', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query['days'] as string, 10) || 14;
    const runs = scanHistoryRepo.getCadence(days);
    res.json({
      success: true,
      data: runs,
    });
  } catch (error) {
    logger.error('Failed to get scan cadence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve scan cadence',
    });
  }
});

// GET /api/scan/latest - Get latest scan
router.get('/latest', (_req: Request, res: Response) => {
  try {
    const scan = rulesRepo.scanHistory.getLatest();
    if (!scan) {
      res.status(404).json({
        success: false,
        error: 'No scans found',
      });
      return;
    }

    res.json({
      success: true,
      data: scan,
    });
  } catch (error) {
    logger.error('Failed to get latest scan:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve latest scan',
    });
  }
});

// GET /api/scan/status - Get current scan status
router.get('/status', (_req: Request, res: Response) => {
  try {
    const runningScan = rulesRepo.scanHistory.getRunning();
    res.json({
      success: true,
      data: {
        isRunning: scanInProgress || !!runningScan,
        currentScan: runningScan,
      },
    });
  } catch (error) {
    logger.error('Failed to get scan status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve scan status',
    });
  }
});

// POST /api/scan/trigger - Trigger a manual scan
router.post('/trigger', async (_req: Request, res: Response) => {
  // Check if scan is already in progress
  if (scanInProgress) {
    res.status(409).json({
      success: false,
      error: 'A scan is already in progress',
    });
    return;
  }

  const existingRunningScan = rulesRepo.scanHistory.getRunning();
  if (existingRunningScan) {
    res.status(409).json({
      success: false,
      error: 'A scan is already in progress',
      data: existingRunningScan,
    });
    return;
  }

  // Return immediately — the scan runs asynchronously.
  scanInProgress = true;
  res.status(202).json({
    success: true,
    message: 'Scan started',
  });

  // Reuse the scheduled scan task so manual and scheduled scans behave
  // identically: the v2 nested-condition rule engine, deletion queueing,
  // notifications, and scan_history bookkeeping (including failure handling)
  // all live there.
  try {
    await scanLibraries();
  } catch (error) {
    logger.error('Manual scan failed:', error);
  } finally {
    scanInProgress = false;
  }
});

export default router;
