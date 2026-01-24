import logger from '../utils/logger';
import { getRulesEngine } from '../rules/engine';
import type { EvaluationSummary } from '../rules/types';

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
    evaluationSummary?: EvaluationSummary;
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
// Service Dependencies (to be injected)
// ============================================================================

export interface TaskDependencies {
  mediaItemRepository?: {
    getAll(): Promise<Array<{ id: number; title: string; status: string }>>;
    updateStatus(id: number, status: string): Promise<void>;
  };
  deletionService?: {
    processPendingDeletions(dryRun: boolean): Promise<Array<{ success: boolean; itemId: number; fileSizeFreed?: number; error?: string }>>;
    getQueue(): Promise<Array<{ id: number; mediaItem: { title: string }; daysRemaining: number }>>;
  };
  notificationService?: {
    notify(event: string, data: Record<string, unknown>): Promise<void>;
  };
  scanHistoryRepository?: {
    create(data: { started_at: string; status: string }): Promise<{ id: number }>;
    update(id: number, data: { completed_at: string; items_scanned: number; items_flagged: number; status: string }): Promise<void>;
  };
  rulesRepository?: {
    getEnabledRules(): Promise<Array<{ id: number; name: string; conditions: string; action: string; enabled: boolean }>>;
  };
}

let dependencies: TaskDependencies = {};

/**
 * Set task dependencies for database and service access
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
// Library Scan Task
// ============================================================================

/**
 * Run a full library scan and evaluate all items against configured rules
 */
export async function scanLibraries(): Promise<ScanResult> {
  const startedAt = new Date();
  const taskName = 'scanLibraries';

  logger.info('Starting library scan task');

  let scanHistoryId: number | undefined;

  try {
    // Create scan history record
    if (dependencies.scanHistoryRepository) {
      const record = await dependencies.scanHistoryRepository.create({
        started_at: startedAt.toISOString(),
        status: 'running',
      });
      scanHistoryId = record.id;
    }

    // Get the rules engine
    const rulesEngine = getRulesEngine();

    // Set up repositories if available
    if (dependencies.mediaItemRepository) {
      rulesEngine.setMediaItemRepository({
        getItemsForEvaluation: async (limit?: number) => {
          const items = await dependencies.mediaItemRepository!.getAll();
          return items.slice(0, limit) as any[];
        },
        updateItemStatus: async (itemId: number, status: string) => {
          await dependencies.mediaItemRepository!.updateStatus(itemId, status);
        },
        markForDeletion: async () => {
          // Implementation depends on deletion service
        },
      });
    }

    if (dependencies.rulesRepository) {
      rulesEngine.setRulesRepository({
        getEnabledRules: async () => {
          return (await dependencies.rulesRepository!.getEnabledRules()) as any[];
        },
        getRuleById: async () => null,
      });
    }

    // Run the evaluation
    const evaluationSummary = await rulesEngine.evaluateAll();

    // Process flagged items
    for (const result of evaluationSummary.results) {
      if (result.matched && result.action === 'mark_for_deletion') {
        if (dependencies.mediaItemRepository) {
          await dependencies.mediaItemRepository.updateStatus(result.item.id, 'flagged');
        }
      }
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Update scan history record
    if (dependencies.scanHistoryRepository && scanHistoryId) {
      await dependencies.scanHistoryRepository.update(scanHistoryId, {
        completed_at: completedAt.toISOString(),
        items_scanned: evaluationSummary.itemsEvaluated,
        items_flagged: evaluationSummary.itemsFlagged,
        status: 'completed',
      });
    }

    // Send notification
    if (dependencies.notificationService) {
      await dependencies.notificationService.notify('SCAN_COMPLETE', {
        itemsScanned: evaluationSummary.itemsEvaluated,
        itemsFlagged: evaluationSummary.itemsFlagged,
        itemsProtected: evaluationSummary.itemsProtected,
        durationMs,
      });
    }

    logger.info(
      `Library scan completed: ${evaluationSummary.itemsEvaluated} items scanned, ` +
        `${evaluationSummary.itemsFlagged} flagged (${durationMs}ms)`
    );

    return {
      success: true,
      taskName,
      startedAt,
      completedAt,
      durationMs,
      message: `Scan completed successfully`,
      data: {
        itemsScanned: evaluationSummary.itemsEvaluated,
        itemsFlagged: evaluationSummary.itemsFlagged,
        itemsProtected: evaluationSummary.itemsProtected,
        evaluationSummary,
      },
    };
  } catch (error) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Library scan task failed:', error);

    // Update scan history with failure
    if (dependencies.scanHistoryRepository && scanHistoryId) {
      await dependencies.scanHistoryRepository.update(scanHistoryId, {
        completed_at: completedAt.toISOString(),
        items_scanned: 0,
        items_flagged: 0,
        status: 'failed',
      });
    }

    // Send error notification
    if (dependencies.notificationService) {
      try {
        await dependencies.notificationService.notify('SCAN_ERROR', {
          error: errorMessage,
          phase: 'scanning', // Generic - can't know exact phase from here
          itemsScannedBeforeError: 0,
          timestamp: new Date().toISOString(),
        });
      } catch (notifyError) {
        // Log but don't throw - notification failure shouldn't mask the original error
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
 * Process items that have passed their grace period and are ready for deletion
 */
export async function processDeletionQueue(): Promise<DeletionProcessingResult> {
  const startedAt = new Date();
  const taskName = 'processDeletionQueue';

  logger.info('Starting deletion queue processing task');

  try {
    if (!dependencies.deletionService) {
      throw new Error('Deletion service not configured');
    }

    // Process pending deletions (not a dry run)
    const results = await dependencies.deletionService.processPendingDeletions(false);

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
      await dependencies.notificationService.notify('DELETION_COMPLETE', {
        itemsDeleted,
        spaceFreedBytes,
        spaceFreedGB: (spaceFreedBytes / (1024 * 1024 * 1024)).toFixed(2),
        errors: errors.length,
      });
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
        // Log but don't throw
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
 * Send notifications for items with upcoming deletions
 */
export async function sendDeletionReminders(): Promise<ReminderResult> {
  const startedAt = new Date();
  const taskName = 'sendDeletionReminders';

  logger.info('Starting deletion reminder task');

  try {
    if (!dependencies.deletionService) {
      throw new Error('Deletion service not configured');
    }

    if (!dependencies.notificationService) {
      throw new Error('Notification service not configured');
    }

    // Get items in deletion queue
    const queue = await dependencies.deletionService.getQueue();

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
