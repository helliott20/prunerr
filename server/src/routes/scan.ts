import { Router, Request, Response } from 'express';
import rulesRepo from '../db/repositories/rules';
import mediaItemsRepo from '../db/repositories/mediaItems';
import { logActivity } from '../db/repositories/activity';
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

  // Start the scan
  scanInProgress = true;
  const scan = rulesRepo.scanHistory.start();

  // Return immediately - scan runs asynchronously
  res.status(202).json({
    success: true,
    message: 'Scan started',
    data: scan,
  });

  // Execute scan asynchronously
  try {
    await executeScan(scan.id);
  } catch (error) {
    logger.error('Scan failed:', error);
    rulesRepo.scanHistory.fail(scan.id);
  } finally {
    scanInProgress = false;
  }
});

// Execute the actual scan logic
async function executeScan(scanId: number): Promise<void> {
  const startTime = Date.now();
  logger.info(`Starting scan ${scanId}`);

  // Log scan start to activity log
  try {
    logActivity({
      eventType: 'scan',
      action: 'started',
      actorType: 'scheduler',
      actorId: 'system',
      actorName: 'Library Scan',
      targetType: null,
      targetId: null,
      targetTitle: null,
      metadata: JSON.stringify({ scanId }),
    });
  } catch (activityError) {
    logger.warn('Failed to log scan start activity:', activityError);
  }

  try {
    // Get all enabled rules
    const enabledRules = rulesRepo.rules.getEnabled();
    logger.info(`Found ${enabledRules.length} enabled rule(s)`);

    // Get all monitored media items
    const { data: mediaItems } = mediaItemsRepo.getAll({ status: 'monitored', limit: 10000 });
    logger.info(`Found ${mediaItems.length} monitored media item(s)`);

    let itemsScanned = 0;
    let itemsFlagged = 0;

    // Process each media item against rules
    for (const item of mediaItems) {
      itemsScanned++;

      // Skip protected items
      if (item.is_protected) {
        continue;
      }

      // Check each rule
      for (const rule of enabledRules) {
        // Skip rule if media type doesn't match
        const ruleMediaType = rule.media_type || 'all';
        if (ruleMediaType !== 'all') {
          // Rule media_type uses 'show', item.type uses 'show' or 'movie'
          if (ruleMediaType !== item.type) {
            continue;
          }
        }

        const conditions = JSON.parse(rule.conditions) as Array<{
          field: string;
          operator: string;
          value: string | number | boolean;
        }>;

        const matches = evaluateConditions(item, conditions);

        if (matches) {
          logger.debug(`Rule "${rule.name}" matched item "${item.title}"`);

          // Apply action based on rule
          switch (rule.action) {
            case 'flag':
              mediaItemsRepo.updateStatus(item.id, 'flagged');
              itemsFlagged++;
              break;
            case 'delete':
              mediaItemsRepo.updateStatus(item.id, 'pending_deletion');
              itemsFlagged++;
              break;
            case 'notify':
              // Notification would be handled by a separate service
              logger.info(`Notification triggered for "${item.title}" by rule "${rule.name}"`);
              break;
          }

          // Only apply first matching rule
          break;
        }
      }
    }

    // Complete the scan
    rulesRepo.scanHistory.complete(scanId, itemsScanned, itemsFlagged);
    const duration = Date.now() - startTime;
    logger.info(`Scan ${scanId} completed: ${itemsScanned} scanned, ${itemsFlagged} flagged`);

    // Log scan completion to activity log
    try {
      logActivity({
        eventType: 'scan',
        action: 'completed',
        actorType: 'scheduler',
        actorId: 'system',
        actorName: 'Library Scan',
        targetType: 'scan',
        targetId: scanId,
        targetTitle: null,
        metadata: JSON.stringify({
          itemsScanned,
          itemsFlagged,
          duration,
        }),
      });
    } catch (activityError) {
      logger.warn('Failed to log scan completion activity:', activityError);
    }
  } catch (error) {
    logger.error(`Scan ${scanId} failed:`, error);
    rulesRepo.scanHistory.fail(scanId);
    const duration = Date.now() - startTime;

    // Log scan failure to activity log
    try {
      logActivity({
        eventType: 'scan',
        action: 'failed',
        actorType: 'scheduler',
        actorId: 'system',
        actorName: 'Library Scan',
        targetType: 'scan',
        targetId: scanId,
        targetTitle: null,
        metadata: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          duration,
        }),
      });
    } catch (activityError) {
      logger.warn('Failed to log scan failure activity:', activityError);
    }

    throw error;
  }
}

// Evaluate rule conditions against a media item
function evaluateConditions(
  item: ReturnType<typeof mediaItemsRepo.getById>,
  conditions: Array<{
    field: string;
    operator: string;
    value: string | number | boolean;
  }>
): boolean {
  if (!item || conditions.length === 0) {
    return false;
  }

  // All conditions must match (AND logic)
  for (const condition of conditions) {
    const itemValue = getFieldValue(item, condition.field);
    const matches = evaluateCondition(itemValue, condition.operator, condition.value);

    if (!matches) {
      return false;
    }
  }

  return true;
}

// Get field value from media item
function getFieldValue(item: NonNullable<ReturnType<typeof mediaItemsRepo.getById>>, field: string): unknown {
  switch (field) {
    case 'type':
      return item.type;
    case 'title':
      return item.title;
    case 'file_size':
      return item.file_size;
    case 'resolution':
      return item.resolution;
    case 'codec':
      return item.codec;
    case 'play_count':
      return item.play_count;
    case 'added_at':
      return item.added_at;
    case 'last_watched_at':
      return item.last_watched_at;
    case 'days_since_added':
      if (!item.added_at) return null;
      return Math.floor((Date.now() - new Date(item.added_at).getTime()) / (1000 * 60 * 60 * 24));
    case 'days_since_watched':
      if (!item.last_watched_at) return null;
      return Math.floor((Date.now() - new Date(item.last_watched_at).getTime()) / (1000 * 60 * 60 * 24));
    case 'never_watched':
      return item.play_count === 0;
    default:
      return undefined;
  }
}

// Evaluate a single condition
function evaluateCondition(
  itemValue: unknown,
  operator: string,
  conditionValue: string | number | boolean
): boolean {
  switch (operator) {
    case 'equals':
      return itemValue === conditionValue;
    case 'not_equals':
      return itemValue !== conditionValue;
    case 'greater_than':
      return typeof itemValue === 'number' && typeof conditionValue === 'number' && itemValue > conditionValue;
    case 'less_than':
      return typeof itemValue === 'number' && typeof conditionValue === 'number' && itemValue < conditionValue;
    case 'contains':
      return typeof itemValue === 'string' && typeof conditionValue === 'string' && itemValue.toLowerCase().includes(conditionValue.toLowerCase());
    case 'not_contains':
      return typeof itemValue === 'string' && typeof conditionValue === 'string' && !itemValue.toLowerCase().includes(conditionValue.toLowerCase());
    case 'is_empty':
      return itemValue === null || itemValue === undefined || itemValue === '';
    case 'is_not_empty':
      return itemValue !== null && itemValue !== undefined && itemValue !== '';
    default:
      logger.warn(`Unknown operator: ${operator}`);
      return false;
  }
}

export default router;
