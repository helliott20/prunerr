import logger from '../utils/logger';
import rulesRepo from '../db/repositories/rules';
import mediaItemsRepo from '../db/repositories/mediaItems';
import storageSnapshotsRepo from '../db/repositories/storageSnapshots';
import unraidSnapshotsRepo from '../db/repositories/unraidSnapshots';
import settingsRepo from '../db/repositories/settings';
import { UnraidService } from '../services/unraid';
import { getDeletionService } from '../services/deletion';
import { PlexUsersService } from '../services/plexUsers';
import { isSyncInProgress, runLibrarySync } from '../services/syncCoordinator';
import { logActivity } from '../db/repositories/activity';
import { evaluateRuleConditions } from '../rules/engine';
import { buildEvaluationContext } from '../rules/context';
import { getNotificationService } from '../notifications';
import { getUsageForPaths, resolveTargetBytes, GiB, type FsUsage, type TargetMode } from '../services/diskSpace';
import { DeletionAction } from '../rules/types';
import type { DiskPressureData } from '../notifications/templates';
import type { EvaluationContext } from '../rules/conditions';
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
// Rule-triggered deletion queueing
// ============================================================================

/**
 * Rule info needed to queue an item for deletion.
 * Shared between scheduled scans, manual full scans, and "Run Rule Now".
 */
export interface QueueingRule {
  id: number;
  name: string;
  grace_period_days: number | null;
  deletion_action: string | null;
  reset_overseerr: boolean;
}

/**
 * Match recorded by a caller during a scan pass, to be batched into one
 * ITEMS_MARKED notification per scan.
 */
export interface QueuedMatch {
  item: MediaItem;
  rule: QueueingRule;
  deleteAfter: string;
}

/**
 * Queue a media item for deletion based on a rule match.
 * Sets all the metadata required by the deletion queue (marked_at, delete_after,
 * deletion_action, reset_overseerr, matched_rule_id) and logs to activity.
 *
 * Shared between scheduled scans (scheduler/tasks.ts) and manual scans (routes/scan.ts)
 * so rule-triggered deletions properly flow through the queue → history → notifications.
 */
export function queueItemForDeletion(
  item: MediaItem,
  rule: QueueingRule
): { deleteAfter: string } {
  const gracePeriodDays = rule.grace_period_days ?? 7;
  const deletionAction = rule.deletion_action ?? 'unmonitor_and_delete';
  const resetOverseerr = rule.reset_overseerr ? 1 : 0;

  const now = new Date();
  const deleteAfter = new Date(now);
  deleteAfter.setDate(deleteAfter.getDate() + gracePeriodDays);
  const deleteAfterIso = deleteAfter.toISOString();

  // Preserve existing marked_at if the item is already queued (idempotent re-runs)
  const isAlreadyQueued = item.status === 'pending_deletion';
  const markedAt = isAlreadyQueued ? (item.marked_at ?? now.toISOString()) : now.toISOString();

  mediaItemsRepo.update(item.id, {
    status: 'pending_deletion',
    marked_at: markedAt,
    delete_after: deleteAfterIso,
    deletion_action: deletionAction,
    reset_overseerr: resetOverseerr,
    matched_rule_id: rule.id,
  } as any);

  try {
    logActivity({
      eventType: 'rule_match',
      action: 'item_queued',
      actorType: 'rule',
      actorId: rule.id.toString(),
      actorName: rule.name,
      targetType: 'media_item',
      targetId: item.id,
      targetTitle: item.title,
      metadata: JSON.stringify({
        gracePeriodDays,
        deleteAfter: deleteAfterIso,
        deletionAction,
        resetOverseerr: Boolean(resetOverseerr),
      }),
    });
  } catch (activityError) {
    logger.warn('Failed to log activity for rule-triggered queue:', activityError);
  }

  return { deleteAfter: deleteAfterIso };
}

/**
 * Fire a single batched ITEMS_MARKED notification for all items queued during a
 * scan. Groups items by rule so one Discord message summarizes the whole scan.
 * No-ops when there are no matches. Falls back to the global notification
 * service if task dependencies haven't been wired yet (e.g. the route fires
 * before the scheduler DI runs — DI still preferred when set for testability).
 */
export async function notifyItemsQueued(matches: QueuedMatch[]): Promise<void> {
  if (matches.length === 0) {
    return;
  }

  const notifier = dependencies.notificationService ?? {
    notify: (event: string, data: Record<string, unknown>) =>
      getNotificationService().notify(event as any, data).then(() => undefined),
  };

  const groupMap = new Map<
    number,
    {
      ruleId: number;
      ruleName: string;
      gracePeriodDays: number;
      deleteAfter: string;
      items: Array<{ id: number; title: string; type: string }>;
    }
  >();

  let latestDeleteAfter = matches[0]!.deleteAfter;
  for (const m of matches) {
    if (new Date(m.deleteAfter).getTime() > new Date(latestDeleteAfter).getTime()) {
      latestDeleteAfter = m.deleteAfter;
    }
    const existing = groupMap.get(m.rule.id);
    if (existing) {
      existing.items.push({ id: m.item.id, title: m.item.title, type: m.item.type });
    } else {
      groupMap.set(m.rule.id, {
        ruleId: m.rule.id,
        ruleName: m.rule.name,
        gracePeriodDays: m.rule.grace_period_days ?? 7,
        deleteAfter: m.deleteAfter,
        items: [{ id: m.item.id, title: m.item.title, type: m.item.type }],
      });
    }
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => b.items.length - a.items.length);
  const count = matches.length;

  // Pick the grace period of the first (largest) group for the legacy top-level
  // fields, for back-compat with template fallbacks and downstream consumers.
  const primary = groups[0]!;

  try {
    await notifier.notify('ITEMS_MARKED', {
      groups,
      count,
      gracePeriodDays: primary.gracePeriodDays,
      deleteAfter: latestDeleteAfter,
    });
  } catch (notifyError) {
    logger.error('Failed to send batched ITEMS_MARKED notification:', notifyError);
  }
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
    const mediaItems = mediaItemsRepo.fetchAll({ status: 'monitored' as any });
    logger.info(`Found ${mediaItems.length} monitored media item(s)`);

    // Load exclusion patterns
    const exclusionPatterns = loadExclusionPatterns();
    if (exclusionPatterns.length > 0) {
      logger.info(`Loaded ${exclusionPatterns.length} exclusion pattern(s)`);
    }

    // Built once for the whole scan — includes the watch lookup, without which
    // watched_by conditions treat every item as never-watched.
    const ctx: EvaluationContext = buildEvaluationContext();

    let itemsScanned = 0;
    let itemsFlagged = 0;
    let itemsProtected = 0;
    const queuedMatches: QueuedMatch[] = [];

    for (const item of mediaItems) {
      itemsScanned++;

      // Skip protected items
      if (item.is_protected) {
        itemsProtected++;
        continue;
      }

      // Skip items matching exclusion patterns
      if (exclusionPatterns.length > 0 && matchesExclusionPattern(item, exclusionPatterns)) {
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

        const matches = evaluateRuleConditions(rule.conditions, item, ctx);

        if (matches) {
          logger.debug(`Rule "${rule.name}" matched item "${item.title}"`);

          switch (rule.action) {
            case 'flag':
              mediaItemsRepo.updateStatus(item.id, 'flagged');
              itemsFlagged++;
              break;
            case 'delete': {
              const { deleteAfter } = queueItemForDeletion(item, rule);
              queuedMatches.push({ item, rule, deleteAfter });
              itemsFlagged++;
              break;
            }
            case 'notify':
              logger.info(`Notification triggered for "${item.title}" by rule "${rule.name}"`);
              break;
          }

          // Only apply first matching rule
          break;
        }
      }
    }

    // One batched ITEMS_MARKED notification for the whole scan
    await notifyItemsQueued(queuedMatches);

    // Complete the scan history record
    rulesRepo.scanHistory.complete(scanId, itemsScanned, itemsFlagged);

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Send notification (respecting scan notification preference)
    const scanNotify = settingsRepo.getValue('notifications_scanNotify') || 'flagged_only';
    if (dependencies.notificationService && scanNotify !== 'never') {
      if (scanNotify === 'always' || itemsFlagged > 0) {
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

    // Snapshot the queue BEFORE deletion so we can enrich the notification with
    // item types and matched rule names (the DeletionResult stream only has title + id).
    const preSnapshot = await deletionService.getPendingDeletions();
    const snapshotById = new Map(preSnapshot.map((p) => [p.id, p]));

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

    // Send notification if any items were deleted. Falls back to the global
    // notification service when DI hasn't been wired yet so the notification
    // never silently no-ops on us.
    if (itemsDeleted > 0) {
      const notifier = dependencies.notificationService ?? {
        notify: (event: string, data: Record<string, unknown>) =>
          getNotificationService().notify(event as any, data).then(() => undefined),
      };

      // Resolve rule names once per ruleId (sync DB lookups — cheap, small cache)
      const ruleNameCache = new Map<number, string>();
      const resolveRuleName = (ruleId: number | undefined): string | undefined => {
        if (ruleId === undefined) return undefined;
        if (!ruleNameCache.has(ruleId)) {
          const rule = rulesRepo.rules.getById(ruleId);
          ruleNameCache.set(ruleId, rule?.name ?? `Rule #${ruleId}`);
        }
        return ruleNameCache.get(ruleId);
      };

      const notifyItems = results
        .filter((r) => r.success)
        .map((r) => {
          const snap = snapshotById.get(r.itemId);
          return {
            title: r.title,
            type: snap?.mediaItem.type ?? 'unknown',
            ruleName: resolveRuleName(snap?.ruleId),
          };
        });

      try {
        await notifier.notify('DELETION_COMPLETE', {
          itemsDeleted,
          spaceFreedBytes,
          spaceFreedGB: (spaceFreedBytes / (1024 * 1024 * 1024)).toFixed(2),
          errors: errors.length,
          items: notifyItems,
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

    // Falls back to the global notification service when DI hasn't been wired
    // (matches the pattern used by notifyItemsQueued and processDeletionQueue).
    const notifier = dependencies.notificationService ?? {
      notify: (event: string, data: Record<string, unknown>) =>
        getNotificationService().notify(event as any, data).then(() => undefined),
    };

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
      await notifier.notify('DELETION_IMMINENT', {
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
      await notifier.notify('DELETION_IMMINENT', {
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
// Storage Snapshot Task
// ============================================================================

/**
 * Capture a storage snapshot and prune old ones.
 */
export async function captureStorageSnapshot(): Promise<TaskResult> {
  const startedAt = new Date();
  const taskName = 'captureStorageSnapshot';

  logger.info('Starting storage snapshot capture');

  try {
    const snapshot = storageSnapshotsRepo.capture();
    storageSnapshotsRepo.pruneOld(90);

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    logger.info(`Storage snapshot captured in ${durationMs}ms`);

    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      message: 'Storage snapshot captured successfully',
      data: {
        totalSize: snapshot.total_size,
        itemCount: snapshot.item_count,
      },
    };
  } catch (error) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Storage snapshot capture failed:', error);

    return {
      success: false,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Capture a daily Unraid array capacity snapshot for the trend/forecast UI.
 * No-op when Unraid is not configured. Idempotent per day.
 */
export async function captureUnraidCapacitySnapshot(): Promise<TaskResult> {
  const startedAt = new Date();
  const taskName = 'captureUnraidCapacitySnapshot';

  const url = settingsRepo.getValue('unraid_url');
  const apiKey = settingsRepo.getValue('unraid_apiKey');

  if (!url || !apiKey) {
    const completedAt = new Date();
    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      message: 'Unraid not configured, skipping',
    };
  }

  if (unraidSnapshotsRepo.hasTodaySnapshot()) {
    const completedAt = new Date();
    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      message: 'Snapshot already captured today',
    };
  }

  try {
    const service = new UnraidService(url, apiKey);
    const stats = await service.getArrayStats();
    const KB = 1024;
    const total = stats.capacity.kilobytes.total * KB;
    const used = stats.capacity.kilobytes.used * KB;
    const free = stats.capacity.kilobytes.free * KB;

    unraidSnapshotsRepo.capture({ total, used, free });
    unraidSnapshotsRepo.pruneOld(400);

    const completedAt = new Date();
    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      message: 'Unraid capacity snapshot captured',
      data: { totalBytes: total, usedBytes: used, freeBytes: free },
    };
  } catch (error) {
    const completedAt = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Unraid capacity snapshot failed:', error);
    return {
      success: false,
      taskName,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      error: errorMessage,
    };
  }
}

// ============================================================================
// Exclusion Pattern Helpers
// ============================================================================

export interface ExclusionPattern {
  field: 'title' | 'type';
  operator: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'regex';
  value: string;
}

/**
 * Load exclusion patterns from settings
 */
export function loadExclusionPatterns(): ExclusionPattern[] {
  try {
    const raw = settingsRepo.getValue('exclusion_patterns');
    if (!raw) return [];
    return JSON.parse(raw) as ExclusionPattern[];
  } catch {
    return [];
  }
}

/**
 * Check if a media item matches any exclusion pattern
 */
export function matchesExclusionPattern(item: MediaItem, patterns: ExclusionPattern[]): boolean {
  for (const pattern of patterns) {
    const fieldValue = pattern.field === 'title' ? item.title : item.type;
    if (!fieldValue) continue;

    let matches = false;
    switch (pattern.operator) {
      case 'contains':
        matches = fieldValue.toLowerCase().includes(pattern.value.toLowerCase());
        break;
      case 'equals':
        matches = fieldValue.toLowerCase() === pattern.value.toLowerCase();
        break;
      case 'starts_with':
        matches = fieldValue.toLowerCase().startsWith(pattern.value.toLowerCase());
        break;
      case 'ends_with':
        matches = fieldValue.toLowerCase().endsWith(pattern.value.toLowerCase());
        break;
      case 'regex':
        try {
          matches = new RegExp(pattern.value, 'i').test(fieldValue);
        } catch {
          matches = false;
        }
        break;
    }

    if (matches) return true;
  }
  return false;
}

// ============================================================================
// Plex Users Sync Task
// ============================================================================

/**
 * Sync Plex users (owner + shared/home users) to the local database.
 * Requires Plex URL and token to be configured in settings.
 */
export async function syncPlexUsers(): Promise<TaskResult> {
  const startedAt = new Date();
  const taskName = 'syncPlexUsers';

  logger.info('Starting Plex users sync task');

  try {
    const plexUrl = settingsRepo.getValue('plex_url');
    const plexToken = settingsRepo.getValue('plex_token');

    if (!plexUrl || !plexToken) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      logger.warn('Plex users sync skipped: Plex not configured');
      return {
        success: true,
        taskName,
        startedAt,
        completedAt,
        durationMs,
        message: 'Skipped — Plex not configured',
        data: { usersSynced: 0 },
      };
    }

    const service = new PlexUsersService(plexUrl, plexToken);
    const users = await service.syncUsers();

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    logger.info(`Plex users sync completed: ${users.length} users (${durationMs}ms)`);

    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      message: `Synced ${users.length} Plex user(s)`,
      data: { usersSynced: users.length },
    };
  } catch (error) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Plex users sync task failed:', error);

    return {
      success: false,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      error: errorMessage,
      data: { usersSynced: 0 },
    };
  }
}

// ============================================================================
// Plex Library Sync Task
// ============================================================================

/**
 * Pull the catalog from Plex into the local DB on a schedule, so users don't
 * have to click "Sync Library" manually to pick up new movies/shows. Shares
 * the syncCoordinator's in-progress flag with the manual button so the two
 * can never run at the same time.
 */
export async function syncPlexLibrary(): Promise<TaskResult> {
  const startedAt = new Date();
  const taskName = 'syncPlexLibrary';

  logger.info('Starting scheduled Plex library sync');

  // Early-exit if another sync is already running so we don't write an orphan
  // 'started' activity entry that never gets a matching 'completed'. The
  // isSyncInProgress() check and the runLibrarySync() call below are both
  // synchronous in JS's single-threaded loop, so the coordinator's internal
  // 'busy' guard is only reached if we somehow miss here — handled below
  // as a defensive fallback.
  if (isSyncInProgress()) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    logger.warn('Scheduled Plex sync skipped: another sync is already running');
    try {
      logActivity({
        eventType: 'scan',
        action: 'skipped',
        actorType: 'scheduler',
        actorId: 'system',
        actorName: 'Scheduled Plex Sync',
        targetType: null,
        targetId: null,
        targetTitle: null,
        metadata: JSON.stringify({ reason: 'another sync is already running' }),
      });
    } catch (activityError) {
      logger.warn('Failed to log Plex sync skipped activity:', activityError);
    }
    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      message: 'Skipped — another sync was already running',
      data: { skipped: true },
    };
  }

  try {
    logActivity({
      eventType: 'scan',
      action: 'started',
      actorType: 'scheduler',
      actorId: 'system',
      actorName: 'Scheduled Plex Sync',
      targetType: null,
      targetId: null,
      targetTitle: null,
      metadata: null,
    });
  } catch (activityError) {
    logger.warn('Failed to log Plex sync start activity:', activityError);
  }

  const outcome = await runLibrarySync();
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  // Defensive: a coordinator-level 'busy' should be impossible here given the
  // pre-check, but handle it anyway so the run is still represented in the log.
  if (outcome.status === 'busy') {
    try {
      logActivity({
        eventType: 'scan',
        action: 'skipped',
        actorType: 'scheduler',
        actorId: 'system',
        actorName: 'Scheduled Plex Sync',
        targetType: null,
        targetId: null,
        targetTitle: null,
        metadata: JSON.stringify({ reason: 'coordinator reported busy after pre-check' }),
      });
    } catch (activityError) {
      logger.warn('Failed to log Plex sync skipped activity:', activityError);
    }
    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      message: 'Skipped — coordinator reported busy',
      data: { skipped: true },
    };
  }

  if (outcome.status === 'failed') {
    try {
      logActivity({
        eventType: 'scan',
        action: 'failed',
        actorType: 'scheduler',
        actorId: 'system',
        actorName: 'Scheduled Plex Sync',
        targetType: null,
        targetId: null,
        targetTitle: null,
        metadata: JSON.stringify({ error: outcome.error, duration: durationMs }),
      });
    } catch (activityError) {
      logger.warn('Failed to log Plex sync failure activity:', activityError);
    }

    return {
      success: false,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      error: outcome.error,
    };
  }

  const result = outcome.result!;
  const errorCount = result.errors.length;

  try {
    logActivity({
      eventType: 'scan',
      action: 'completed',
      actorType: 'scheduler',
      actorId: 'system',
      actorName: 'Scheduled Plex Sync',
      targetType: null,
      targetId: null,
      targetTitle: null,
      metadata: JSON.stringify({
        itemsScanned: result.itemsScanned,
        itemsAdded: result.itemsAdded,
        itemsUpdated: result.itemsUpdated,
        errors: errorCount,
        duration: durationMs,
      }),
    });
  } catch (activityError) {
    logger.warn('Failed to log Plex sync completion activity:', activityError);
  }

  logger.info(
    `Scheduled Plex sync completed: ${result.itemsScanned} scanned, ` +
      `${result.itemsAdded} added, ${result.itemsUpdated} updated, ${errorCount} errors (${durationMs}ms)`
  );

  return {
    success: errorCount === 0,
    taskName,
    startedAt,
    completedAt,
    durationMs,
    message: `Synced ${result.itemsScanned} items from Plex`,
    data: {
      itemsScanned: result.itemsScanned,
      itemsAdded: result.itemsAdded,
      itemsUpdated: result.itemsUpdated,
      errors: errorCount,
    },
  };
}

// ============================================================================
// Task Registry
// ============================================================================

// ============================================================================
// Disk-Pressure Reactive Monitor
// ============================================================================

/** Read the configured media paths for the disk-pressure monitor. */
export function loadDiskPressurePaths(): string[] {
  try {
    const raw = settingsRepo.getValue('diskPressure_paths');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string' && p.trim().length > 0) : [];
  } catch {
    return [];
  }
}

interface DiskPressureConfig {
  targetMode: TargetMode;
  targetValue: number;
  criticalValue: number;
  bufferGb: number;
  observeOnly: boolean;
  softGraceDays: number;
  criticalGraceDays: number;
  criticalAutoProcess: boolean;
  deletionAction: DeletionAction;
  maxItemsPerRun: number;
  maxGbPerRun: number;
  unwatchedDays: number;
}

function loadDiskPressureConfig(): DiskPressureConfig {
  const action = settingsRepo.getValue('diskPressure_deletionAction') as DeletionAction | null;
  const validAction = action && Object.values(DeletionAction).includes(action)
    ? action
    : DeletionAction.UNMONITOR_AND_DELETE;
  return {
    targetMode: (settingsRepo.getValue('diskPressure_targetMode') as TargetMode) || 'percent',
    targetValue: settingsRepo.getNumber('diskPressure_targetValue', 10),
    criticalValue: settingsRepo.getNumber('diskPressure_criticalValue', 5),
    bufferGb: settingsRepo.getNumber('diskPressure_bufferGb', 50),
    observeOnly: settingsRepo.getBoolean('diskPressure_observeOnly', true),
    softGraceDays: settingsRepo.getNumber('diskPressure_softGraceDays', 7),
    criticalGraceDays: settingsRepo.getNumber('diskPressure_criticalGraceDays', 0),
    criticalAutoProcess: settingsRepo.getBoolean('diskPressure_criticalAutoProcess', false),
    deletionAction: validAction,
    maxItemsPerRun: settingsRepo.getNumber('diskPressure_maxItemsPerRun', 25),
    maxGbPerRun: settingsRepo.getNumber('diskPressure_maxGbPerRun', 500),
    unwatchedDays: settingsRepo.getNumber('diskPressure_unwatchedDays', 90),
  };
}

/**
 * Rank candidate items for reclamation, reusing the recommendations ordering
 * (oldest-watched first, then largest). Excludes protected / already-pending
 * items and anything matching the user's exclusion patterns. When a breached
 * path is given, items on that filesystem are preferred.
 */
function selectDiskPressureCandidates(unwatchedDays: number, breachedPath: string): MediaItem[] {
  const exclusionPatterns = loadExclusionPatterns();
  const candidates = mediaItemsRepo
    .getUnwatched(unwatchedDays)
    .filter((item) => !item.is_protected && item.status !== 'pending_deletion')
    .filter((item) => !(exclusionPatterns.length > 0 && matchesExclusionPattern(item, exclusionPatterns)));

  return candidates.sort((a, b) => {
    // Prefer items physically under the breached path (so we free the right FS)
    const aOnPath = a.file_path?.startsWith(breachedPath) ? 0 : 1;
    const bOnPath = b.file_path?.startsWith(breachedPath) ? 0 : 1;
    if (aOnPath !== bOnPath) return aOnPath - bOnPath;
    // Oldest watched first
    const aDate = a.last_watched_at ? new Date(a.last_watched_at).getTime() : 0;
    const bDate = b.last_watched_at ? new Date(b.last_watched_at).getTime() : 0;
    if (aDate !== bDate) return aDate - bDate;
    // Then largest first
    return (b.file_size || 0) - (a.file_size || 0);
  });
}

/**
 * Reactive disk-pressure monitor. Runs frequently; when free space on a
 * configured filesystem drops below the soft/critical threshold, it reclaims
 * just enough lowest-value content to recover (or, in observe-only mode, only
 * reports what it would do). Self-disables when `diskPressure_enabled` is off.
 */
export async function monitorDiskPressure(): Promise<TaskResult> {
  const startedAt = new Date();
  const taskName = 'monitorDiskPressure';
  const done = (message: string, data?: Record<string, unknown>, success = true): TaskResult => {
    const completedAt = new Date();
    return { success, taskName, startedAt, completedAt, durationMs: completedAt.getTime() - startedAt.getTime(), message, data };
  };

  if (!settingsRepo.getBoolean('diskPressure_enabled', false)) {
    return done('Disk-pressure monitoring disabled');
  }

  // Don't fight the nightly scan/sync over the same items.
  if (isSyncInProgress() || rulesRepo.scanHistory.getRunning()) {
    return done('Scan or sync in progress, skipping disk-pressure check');
  }

  const paths = loadDiskPressurePaths();
  if (paths.length === 0) {
    return done('No media paths configured for disk-pressure monitoring');
  }

  const cfg = loadDiskPressureConfig();
  const usages = await getUsageForPaths(paths);
  if (usages.length === 0) {
    return done('Could not read any configured paths', undefined, true);
  }

  // Find the most-breached filesystem (largest deficit vs its soft target).
  type Breach = { fs: FsUsage; severity: 'soft' | 'critical'; softTarget: number; criticalTarget: number; deficit: number };
  let worst: Breach | null = null;
  for (const fs of usages) {
    const softTarget = resolveTargetBytes(fs, cfg.targetMode, cfg.targetValue);
    const criticalTarget = resolveTargetBytes(fs, cfg.targetMode, cfg.criticalValue);
    const severity = fs.freeBytes < criticalTarget ? 'critical' : fs.freeBytes < softTarget ? 'soft' : null;
    if (!severity) continue;
    const deficit = softTarget - fs.freeBytes;
    if (!worst || deficit > worst.deficit) {
      worst = { fs, severity, softTarget, criticalTarget, deficit };
    }
  }

  if (!worst) {
    return done('All filesystems above target', { checked: usages.length });
  }

  const { fs, severity, softTarget, deficit } = worst;
  const targetBytes = severity === 'critical' ? worst.criticalTarget : softTarget;
  const deletesFiles = cfg.deletionAction !== DeletionAction.UNMONITOR_ONLY;
  // Reclaim enough to clear the soft target plus a buffer so we don't re-trigger.
  const reclaimGoal = deficit + cfg.bufferGb * GiB;
  const maxBytes = cfg.maxGbPerRun * GiB;

  // Pick items until we've projected enough reclaim or hit a safety cap.
  const ranked = selectDiskPressureCandidates(cfg.unwatchedDays, fs.path);
  const chosen: MediaItem[] = [];
  let projected = 0;
  for (const item of ranked) {
    if (chosen.length >= cfg.maxItemsPerRun) break;
    if (deletesFiles && projected >= reclaimGoal) break;
    if (deletesFiles && projected + (item.file_size || 0) > maxBytes && chosen.length > 0) break;
    chosen.push(item);
    if (deletesFiles) projected += item.file_size || 0;
  }

  const graceDays = severity === 'critical' ? cfg.criticalGraceDays : cfg.softGraceDays;

  // Queue (unless observe-only). Suppress per-item notifications so we emit a
  // single DISK_PRESSURE_TRIGGERED event below instead of ITEMS_MARKED noise.
  let itemsQueued = 0;
  if (!cfg.observeOnly && chosen.length > 0) {
    const deletionService = getDeletionService();
    for (const item of chosen) {
      try {
        await deletionService.markForDeletion(item.id, {
          gracePeriodDays: graceDays,
          deletionAction: cfg.deletionAction,
          skipNotification: true,
        });
        itemsQueued++;
      } catch (error) {
        logger.warn(`Disk-pressure: failed to queue item ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Critical + auto-process: reclaim immediately rather than waiting for grace.
    if (severity === 'critical' && cfg.criticalAutoProcess && itemsQueued > 0) {
      try {
        await deletionService.processPendingDeletions(false);
      } catch (error) {
        logger.error('Disk-pressure: critical auto-process failed:', error);
      }
    }
  }

  // Emit the event (Discord + webhooks). Use DI notifier when wired.
  const notifier = dependencies.notificationService ?? {
    notify: (event: string, data: Record<string, unknown>) =>
      getNotificationService().notify(event as any, data).then(() => undefined),
  };
  const eventData: DiskPressureData = {
    severity,
    path: fs.path,
    freeBytes: fs.freeBytes,
    totalBytes: fs.totalBytes,
    targetBytes,
    deficitBytes: Math.max(0, deficit),
    observeOnly: cfg.observeOnly,
    itemsQueued,
    projectedReclaimBytes: projected,
    deletionAction: cfg.deletionAction,
    items: chosen.map((i) => ({ id: i.id, title: i.title, type: i.type, sizeBytes: i.file_size || 0 })),
    timestamp: startedAt.toISOString(),
  };
  try {
    await notifier.notify('DISK_PRESSURE_TRIGGERED', eventData as unknown as Record<string, unknown>);
  } catch (error) {
    logger.error('Disk-pressure: failed to send notification:', error);
  }

  // Activity log
  try {
    logActivity({
      eventType: 'disk_pressure',
      action: cfg.observeOnly
        ? `Disk pressure (${severity}) on ${fs.path} — ${chosen.length} item(s) would be reclaimed (observe-only)`
        : `Disk pressure (${severity}) on ${fs.path} — queued ${itemsQueued} item(s)`,
      actorType: 'scheduler',
      actorName: 'Disk-pressure monitor',
      metadata: JSON.stringify({
        severity,
        path: fs.path,
        freeBytes: fs.freeBytes,
        targetBytes,
        itemsQueued,
        observeOnly: cfg.observeOnly,
        projectedReclaimBytes: projected,
      }),
    });
  } catch (error) {
    logger.warn('Disk-pressure: failed to log activity:', error);
  }

  return done(
    cfg.observeOnly
      ? `Observe-only: ${chosen.length} item(s) flagged for ${severity} pressure on ${fs.path}`
      : `Queued ${itemsQueued} item(s) for ${severity} pressure on ${fs.path}`,
    { severity, path: fs.path, itemsQueued, projectedReclaimBytes: projected, observeOnly: cfg.observeOnly }
  );
}

export type TaskFunction = () => Promise<TaskResult>;

export const taskRegistry: Record<string, TaskFunction> = {
  syncPlexLibrary,
  scanLibraries,
  processDeletionQueue,
  sendDeletionReminders,
  captureStorageSnapshot,
  captureUnraidCapacitySnapshot,
  syncPlexUsers,
  monitorDiskPressure,
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
