import logger from '../utils/logger';
import rulesRepo from '../db/repositories/rules';
import mediaItemsRepo from '../db/repositories/mediaItems';
import { getDeletionService } from '../services/deletion';
import { logActivity } from '../db/repositories/activity';
import type { MediaItem } from '../types';

// ============================================================================
// Task Result Types
// ============================================================================

export interface TaskResult {
  success: boolean;
  taskName: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  message?: string;
  error?: string;
  data?: Record<string, unknown>;
}

export interface ScanResult extends TaskResult {
  data: {
    itemsScanned: number;
    itemsFlagged: number;
    itemsProtected: number;
  };
}

export interface DeletionProcessingResult extends TaskResult {
  data: {
    itemsProcessed: number;
    itemsDeleted: number;
    spaceFreedBytes: number;
    errors: Array<{ itemId: number; error: string }>;
  };
}

export interface ReminderResult extends TaskResult {
  data: {
    remindersSent: number;
    itemsPendingDeletion: number;
  };
}

// ============================================================================
// Notification Service Dependency
// ============================================================================

export interface TaskDependencies {
  notificationService?: {
    notify(event: string, data: Record<string, unknown>): Promise<void>;
  };
}

let dependencies: TaskDependencies = {};

/**
 * Set task dependencies (notification service)
 */
export function setTaskDependencies(deps: TaskDependencies): void {
  dependencies = deps;
  logger.info('Task dependencies configured');
}

/**
 * Get current task dependencies
 */
export function getTaskDependencies(): TaskDependencies {
  return dependencies;
}

// ============================================================================
// Condition Evaluation (shared with scan route)
// ============================================================================

function getFieldValue(item: MediaItem, field: string): unknown {
  switch (field) {
    case 'type':
      return item.type;
    case 'title':
      return item.title;
    case 'file_size':
      return item.file_size;
    case 'size_gb':
      return item.file_size ? item.file_size / (1024 * 1024 * 1024) : null;
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

function evaluateConditions(
  item: MediaItem,
  conditions: Array<{ field: string; operator: string; value: string | number | boolean }>
): boolean {
  if (!item || conditions.length === 0) {
    return false;
  }

  for (const condition of conditions) {
    const itemValue = getFieldValue(item, condition.field);
    const matches = evaluateCondition(itemValue, condition.operator, condition.value);
    if (!matches) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Library Scan Task
// ============================================================================

/**
 * Run a full library scan and evaluate all items against configured rules.
 * Uses the database repos directly (same approach as manual scan in scan route).
 */
export async function scanLibraries(): Promise<ScanResult> {
  const startedAt = new Date();
  const taskName = 'scanLibraries';

  logger.info('Starting library scan task');

  // Create scan history record
  const scan = rulesRepo.scanHistory.start();
  const scanId = scan.id;

  try {
    // Log scan start to activity log
    try {
      logActivity({
        eventType: 'scan',
        action: 'started',
        actorType: 'scheduler',
        actorId: 'system',
        actorName: 'Scheduled Scan',
        targetType: null,
        targetId: null,
        targetTitle: null,
        metadata: JSON.stringify({ scanId }),
      });
    } catch (activityError) {
      logger.warn('Failed to log scan start activity:', activityError);
    }

    // Get all enabled rules
    const enabledRules = rulesRepo.rules.getEnabled();
    logger.info(`Found ${enabledRules.length} enabled rule(s)`);

    // Get all monitored media items
    const { data: mediaItems } = mediaItemsRepo.getAll({ status: 'monitored' as any, limit: 10000 });
    logger.info(`Found ${mediaItems.length} monitored media item(s)`);

    let itemsScanned = 0;
    let itemsFlagged = 0;
    let itemsProtected = 0;

    for (const item of mediaItems) {
      itemsScanned++;

      // Skip protected items
      if (item.is_protected) {
        itemsProtected++;
        continue;
      }

      // Check each rule
      for (const rule of enabledRules) {
        // Skip rule if media type doesn't match
        const ruleMediaType = rule.media_type || 'all';
        if (ruleMediaType !== 'all') {
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
              logger.info(`Notification triggered for "${item.title}" by rule "${rule.name}"`);
              break;
          }

          // Only apply first matching rule
          break;
        }
      }
    }

    // Complete the scan history record
    rulesRepo.scanHistory.complete(scanId, itemsScanned, itemsFlagged);

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Send notification
    if (dependencies.notificationService) {
      try {
        await dependencies.notificationService.notify('SCAN_COMPLETE', {
          itemsScanned,
          itemsFlagged,
          itemsProtected,
          durationMs,
        });
      } catch (notifyError) {
        logger.error('Failed to send scan complete notification:', notifyError);
      }
    }

    // Log scan completion to activity log
    try {
      logActivity({
        eventType: 'scan',
        action: 'completed',
        actorType: 'scheduler',
        actorId: 'system',
        actorName: 'Scheduled Scan',
        targetType: 'scan',
        targetId: scanId,
        targetTitle: null,
        metadata: JSON.stringify({ itemsScanned, itemsFlagged, itemsProtected, duration: durationMs }),
      });
    } catch (activityError) {
      logger.warn('Failed to log scan completion activity:', activityError);
    }

    logger.info(
      `Library scan completed: ${itemsScanned} items scanned, ` +
        `${itemsFlagged} flagged, ${itemsProtected} protected (${durationMs}ms)`
    );

    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      message: `Scan completed successfully`,
      data: {
        itemsScanned,
        itemsFlagged,
        itemsProtected,
      },
    };
  } catch (error) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Library scan task failed:', error);

    // Update scan history with failure
    rulesRepo.scanHistory.fail(scanId);

    // Log scan failure to activity log
    try {
      logActivity({
        eventType: 'scan',
        action: 'failed',
        actorType: 'scheduler',
        actorId: 'system',
        actorName: 'Scheduled Scan',
        targetType: 'scan',
        targetId: scanId,
        targetTitle: null,
        metadata: JSON.stringify({ error: errorMessage, duration: durationMs }),
      });
    } catch (activityError) {
      logger.warn('Failed to log scan failure activity:', activityError);
    }

    // Send error notification
    if (dependencies.notificationService) {
      try {
        await dependencies.notificationService.notify('SCAN_ERROR', {
          error: errorMessage,
          phase: 'scanning',
          itemsScannedBeforeError: 0,
          timestamp: new Date().toISOString(),
        });
      } catch (notifyError) {
        logger.error('Failed to send scan error notification:', notifyError);
      }
    }

    return {
      success: false,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      error: errorMessage,
      data: {
        itemsScanned: 0,
        itemsFlagged: 0,
        itemsProtected: 0,
      },
    };
  }
}

// ============================================================================
// Deletion Processing Task
// ============================================================================

/**
 * Process items that have passed their grace period and are ready for deletion.
 * Uses the DeletionService singleton directly.
 */
export async function processDeletionQueue(): Promise<DeletionProcessingResult> {
  const startedAt = new Date();
  const taskName = 'processDeletionQueue';

  logger.info('Starting deletion queue processing task');

  try {
    const deletionService = getDeletionService();

    // Process pending deletions (not a dry run)
    const results = await deletionService.processPendingDeletions(false);

    const itemsDeleted = results.filter((r) => r.success).length;
    const spaceFreedBytes = results
      .filter((r) => r.success && r.fileSizeFreed)
      .reduce((sum, r) => sum + (r.fileSizeFreed || 0), 0);
    const errors = results
      .filter((r) => !r.success)
      .map((r) => ({ itemId: r.itemId, error: r.error || 'Unknown error' }));

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Send notification if any items were deleted
    if (dependencies.notificationService && itemsDeleted > 0) {
      try {
        await dependencies.notificationService.notify('DELETION_COMPLETE', {
          itemsDeleted,
          spaceFreedBytes,
          spaceFreedGB: (spaceFreedBytes / (1024 * 1024 * 1024)).toFixed(2),
          errors: errors.length,
        });
      } catch (notifyError) {
        logger.error('Failed to send deletion complete notification:', notifyError);
      }
    }

    logger.info(
      `Deletion queue processing completed: ${itemsDeleted} items deleted, ` +
        `${(spaceFreedBytes / (1024 * 1024 * 1024)).toFixed(2)}GB freed (${durationMs}ms)`
    );

    return {
      success: errors.length === 0,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      message: `Processed ${results.length} items, deleted ${itemsDeleted}`,
      data: {
        itemsProcessed: results.length,
        itemsDeleted,
        spaceFreedBytes,
        errors,
      },
    };
  } catch (error) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Deletion queue processing task failed:', error);

    // Send error notification
    if (dependencies.notificationService) {
      try {
        await dependencies.notificationService.notify('DELETION_ERROR', {
          error: errorMessage,
          itemsProcessedBeforeError: 0,
          timestamp: new Date().toISOString(),
        });
      } catch (notifyError) {
        logger.error('Failed to send deletion error notification:', notifyError);
      }
    }

    return {
      success: false,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      error: errorMessage,
      data: {
        itemsProcessed: 0,
        itemsDeleted: 0,
        spaceFreedBytes: 0,
        errors: [],
      },
    };
  }
}

// ============================================================================
// Deletion Reminder Task
// ============================================================================

/**
 * Send notifications for items with upcoming deletions.
 * Uses the DeletionService singleton directly.
 */
export async function sendDeletionReminders(): Promise<ReminderResult> {
  const startedAt = new Date();
  const taskName = 'sendDeletionReminders';

  logger.info('Starting deletion reminder task');

  try {
    const deletionService = getDeletionService();

    if (!dependencies.notificationService) {
      throw new Error('Notification service not configured');
    }

    // Get items in deletion queue
    const queue = await deletionService.getQueue();

    // Filter items that are due for deletion within the next 24 hours
    const imminentDeletions = queue.filter((item) => item.daysRemaining <= 1);

    // Filter items that are due for deletion within the next 3 days (for warning)
    const upcomingDeletions = queue.filter(
      (item) => item.daysRemaining > 1 && item.daysRemaining <= 3
    );

    let remindersSent = 0;

    // Send imminent deletion notifications
    if (imminentDeletions.length > 0) {
      await dependencies.notificationService.notify('DELETION_IMMINENT', {
        items: imminentDeletions.map((item) => ({
          id: item.id,
          title: item.mediaItem.title,
          daysRemaining: item.daysRemaining,
        })),
        count: imminentDeletions.length,
        urgency: 'high',
      });
      remindersSent++;
    }

    // Send upcoming deletion warnings
    if (upcomingDeletions.length > 0) {
      await dependencies.notificationService.notify('DELETION_IMMINENT', {
        items: upcomingDeletions.map((item) => ({
          id: item.id,
          title: item.mediaItem.title,
          daysRemaining: item.daysRemaining,
        })),
        count: upcomingDeletions.length,
        urgency: 'medium',
      });
      remindersSent++;
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    logger.info(
      `Deletion reminders sent: ${remindersSent} notifications, ` +
        `${queue.length} items pending deletion (${durationMs}ms)`
    );

    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      message: `Sent ${remindersSent} reminder notifications`,
      data: {
        remindersSent,
        itemsPendingDeletion: queue.length,
      },
    };
  } catch (error) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Deletion reminder task failed:', error);

    return {
      success: false,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      error: errorMessage,
      data: {
        remindersSent: 0,
        itemsPendingDeletion: 0,
      },
    };
  }
}

// ============================================================================
// Task Registry
// ============================================================================

export type TaskFunction = () => Promise<TaskResult>;

export const taskRegistry: Record<string, TaskFunction> = {
  scanLibraries,
  processDeletionQueue,
  sendDeletionReminders,
};

/**
 * Get a task function by name
 */
export function getTask(taskName: string): TaskFunction | undefined {
  return taskRegistry[taskName];
}

/**
 * Get all available task names
 */
export function getAvailableTasks(): string[] {
  return Object.keys(taskRegistry);
}
