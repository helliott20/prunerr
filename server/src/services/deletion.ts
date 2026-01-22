import type { MediaItem, MediaType, DeletionType } from '../types';
import {
  DeletionAction,
  type QueueItem,
  type DeletionResult,
} from '../rules/types';
import logger from '../utils/logger';
import { logActivity } from '../db/repositories/activity';

// ============================================================================
// Types
// ============================================================================

export interface DeletionQueueItem {
  id: number;
  mediaItem: MediaItem;
  markedAt: Date;
  deleteAfter: Date;
  ruleId?: number;
  ruleName?: string;
  daysRemaining: number;
  action: DeletionAction;
}

export interface DeletionHistoryEntry {
  id: number;
  media_item_id: number | null;
  title: string;
  type: MediaType;
  file_size: number | null;
  deleted_at: string;
  deletion_type: DeletionType;
  deleted_by_rule_id: number | null;
}

// ============================================================================
// Service Dependencies
// ============================================================================

export interface DeletionServiceDependencies {
  mediaItemRepository?: {
    getById(id: number): Promise<MediaItem | null>;
    update(id: number, data: Partial<MediaItem>): Promise<void>;
    delete(id: number): Promise<void>;
    getByStatus(status: string): Promise<MediaItem[]>;
  };
  deletionHistoryRepository?: {
    create(data: Omit<DeletionHistoryEntry, 'id'> & { overseerr_reset?: number }): Promise<DeletionHistoryEntry>;
  };
  ruleRepository?: {
    getById(id: number): Promise<{ id: number; name: string; deletion_action?: string; reset_overseerr?: number } | null>;
  };
  sonarrService?: {
    unmonitorSeries(seriesId: number): Promise<void>;
    deleteEpisodeFile(episodeFileId: number): Promise<void>;
    deleteAllEpisodeFiles(seriesId: number): Promise<{ deleted: number; failed: number }>;
    removeSeries(seriesId: number, deleteFiles: boolean): Promise<void>;
  };
  radarrService?: {
    unmonitorMovie(movieId: number): Promise<void>;
    deleteMovieFile(movieFileId: number): Promise<void>;
    deleteMovieFilesByMovieId(movieId: number): Promise<boolean>;
    removeMovie(movieId: number, deleteFiles: boolean): Promise<void>;
  };
  overseerrService?: {
    resetMediaByTmdbId(tmdbId: number, type: 'movie' | 'tv'): Promise<boolean>;
    getRequestedBy(tmdbId: number, type: 'movie' | 'tv'): Promise<string | null>;
    notifyRequesterOfDeletion(tmdbId: number, type: 'movie' | 'tv', title: string, reason?: string): Promise<boolean>;
  };
  fileService?: {
    deleteFile(path: string): Promise<boolean>;
    getFileSize(path: string): Promise<number | null>;
  };
  notificationService?: {
    notify(event: string, data: Record<string, unknown>): Promise<void>;
  };
}

// ============================================================================
// Deletion Service Class
// ============================================================================

/**
 * Service for managing media item deletion queue and execution
 */
export class DeletionService {
  private dependencies: DeletionServiceDependencies = {};
  private defaultGracePeriodDays: number = 7;
  private defaultDeletionAction: DeletionAction = DeletionAction.UNMONITOR_AND_DELETE;

  constructor(deps?: DeletionServiceDependencies) {
    if (deps) {
      this.dependencies = deps;
    }
  }

  /**
   * Set service dependencies
   */
  setDependencies(deps: DeletionServiceDependencies): void {
    this.dependencies = { ...this.dependencies, ...deps };
    logger.info('Deletion service dependencies configured');
  }

  /**
   * Set default configuration
   */
  setDefaults(gracePeriodDays: number, deletionAction: DeletionAction): void {
    this.defaultGracePeriodDays = gracePeriodDays;
    this.defaultDeletionAction = deletionAction;
  }

  // ============================================================================
  // Queue Management
  // ============================================================================

  /**
   * Mark an item for deletion with a grace period
   */
  async markForDeletion(
    itemId: number,
    options: {
      gracePeriodDays?: number;
      ruleId?: number;
      deletionAction?: DeletionAction;
      resetOverseerr?: boolean;
    } = {}
  ): Promise<void> {
    const {
      gracePeriodDays = this.defaultGracePeriodDays,
      ruleId,
      deletionAction = this.defaultDeletionAction,
      resetOverseerr = false,
    } = options;

    logger.info(`Marking item ${itemId} for deletion with ${gracePeriodDays} day grace period, action: ${deletionAction}, reset overseerr: ${resetOverseerr}`);

    if (!this.dependencies.mediaItemRepository) {
      throw new Error('Media item repository not configured');
    }

    const item = await this.dependencies.mediaItemRepository.getById(itemId);
    if (!item) {
      throw new Error(`Media item ${itemId} not found`);
    }

    if (item.is_protected) {
      throw new Error(`Media item ${itemId} is protected and cannot be marked for deletion`);
    }

    const markedAt = new Date();
    const deleteAfter = new Date(markedAt);
    deleteAfter.setDate(deleteAfter.getDate() + gracePeriodDays);

    await this.dependencies.mediaItemRepository.update(itemId, {
      status: 'pending_deletion',
      marked_at: markedAt.toISOString(),
      delete_after: deleteAfter.toISOString(),
      deletion_action: deletionAction,
      reset_overseerr: resetOverseerr ? 1 : 0,
      matched_rule_id: ruleId || null,
    } as any);

    // Get rule name if ruleId provided
    let ruleName: string | undefined;
    if (ruleId && this.dependencies.ruleRepository) {
      const rule = await this.dependencies.ruleRepository.getById(ruleId);
      ruleName = rule?.name;
    }

    // Send notification
    if (this.dependencies.notificationService) {
      await this.dependencies.notificationService.notify('ITEMS_MARKED', {
        item: {
          id: item.id,
          title: item.title,
          type: item.type,
        },
        gracePeriodDays,
        deleteAfter: deleteAfter.toISOString(),
        deletionAction,
        resetOverseerr,
        ruleId,
        ruleName,
      });
    }

    // Log to activity log
    try {
      logActivity({
        eventType: 'rule_match',
        action: 'item_queued',
        actorType: ruleId ? 'rule' : 'user',
        actorId: ruleId?.toString() || null,
        actorName: ruleName || 'Manual queue',
        targetType: 'media_item',
        targetId: item.id,
        targetTitle: item.title,
        metadata: JSON.stringify({
          gracePeriodDays,
          deleteAfter: deleteAfter.toISOString(),
          deletionAction,
          resetOverseerr,
        }),
      });
    } catch (activityError) {
      logger.warn('Failed to log activity for mark for deletion:', activityError);
    }

    logger.info(`Item "${item.title}" marked for deletion, will be deleted after ${deleteAfter.toISOString()}`);
  }

  /**
   * Remove an item from the deletion queue
   */
  async unmarkForDeletion(itemId: number): Promise<void> {
    logger.info(`Removing item ${itemId} from deletion queue`);

    if (!this.dependencies.mediaItemRepository) {
      throw new Error('Media item repository not configured');
    }

    const item = await this.dependencies.mediaItemRepository.getById(itemId);
    if (!item) {
      throw new Error(`Media item ${itemId} not found`);
    }

    await this.dependencies.mediaItemRepository.update(itemId, {
      status: 'monitored',
      marked_at: null,
      delete_after: null,
    });

    logger.info(`Item "${item.title}" removed from deletion queue`);
  }

  /**
   * Get all items in the deletion queue
   */
  async getQueue(): Promise<QueueItem[]> {
    if (!this.dependencies.mediaItemRepository) {
      throw new Error('Media item repository not configured');
    }

    const items = await this.dependencies.mediaItemRepository.getByStatus('pending_deletion');
    const now = new Date();

    const queueItems: QueueItem[] = items
      .filter((item) => item.delete_after)
      .map((item) => {
        const deleteAfter = new Date(item.delete_after!);
        const markedAt = item.marked_at ? new Date(item.marked_at) : now;
        const daysRemaining = Math.max(
          0,
          Math.ceil((deleteAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        );

        // Get deletion action from the item, or use default
        const itemWithExtras = item as any;
        const action = (itemWithExtras.deletion_action as DeletionAction) || this.defaultDeletionAction;
        const resetOverseerr = Boolean(itemWithExtras.reset_overseerr);
        const requestedBy = itemWithExtras.requested_by as string | undefined;
        const matchedRuleId = itemWithExtras.matched_rule_id as number | undefined;

        return {
          id: item.id,
          mediaItem: item,
          markedAt,
          deleteAfter,
          daysRemaining,
          action,
          resetOverseerr,
          requestedBy,
          ruleId: matchedRuleId,
        };
      })
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    return queueItems;
  }

  /**
   * Get items that are past their grace period and ready for deletion
   */
  async getPendingDeletions(): Promise<QueueItem[]> {
    const queue = await this.getQueue();
    return queue.filter((item) => item.daysRemaining === 0);
  }

  // ============================================================================
  // Deletion Execution
  // ============================================================================

  /**
   * Process all pending deletions
   */
  async processPendingDeletions(dryRun: boolean = false): Promise<DeletionResult[]> {
    logger.info(`Processing pending deletions (dryRun: ${dryRun})`);

    const pendingItems = await this.getPendingDeletions();
    const results: DeletionResult[] = [];

    logger.info(`Found ${pendingItems.length} items ready for deletion`);

    for (const queueItem of pendingItems) {
      try {
        if (dryRun) {
          logger.info(`[DRY RUN] Would delete: "${queueItem.mediaItem.title}" (action: ${queueItem.action}, overseerr reset: ${queueItem.resetOverseerr})`);
          results.push({
            success: true,
            itemId: queueItem.mediaItem.id,
            title: queueItem.mediaItem.title,
            action: queueItem.action,
            fileSizeFreed: queueItem.action !== DeletionAction.UNMONITOR_ONLY ? (queueItem.mediaItem.file_size || 0) : 0,
            overseerrReset: queueItem.resetOverseerr,
          });
        } else {
          const result = await this.executeDelete(queueItem.mediaItem, queueItem.action, {
            resetOverseerr: queueItem.resetOverseerr,
            ruleId: queueItem.ruleId,
          });
          results.push(result);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to delete item "${queueItem.mediaItem.title}":`, error);
        results.push({
          success: false,
          itemId: queueItem.mediaItem.id,
          title: queueItem.mediaItem.title,
          action: queueItem.action,
          error: errorMessage,
        });
      }
    }

    // Log summary
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const totalFreed = successful.reduce((sum, r) => sum + (r.fileSizeFreed || 0), 0);
    const overseerrResets = successful.filter((r) => r.overseerrReset).length;

    logger.info(
      `Deletion processing complete: ${successful.length} successful, ${failed.length} failed, ` +
        `${(totalFreed / (1024 * 1024 * 1024)).toFixed(2)}GB freed, ${overseerrResets} Overseerr resets`
    );

    return results;
  }

  /**
   * Execute deletion for a single media item
   */
  async executeDelete(
    item: MediaItem,
    action: DeletionAction,
    options: {
      resetOverseerr?: boolean;
      ruleId?: number;
    } = {}
  ): Promise<DeletionResult> {
    logger.info(`Executing deletion for "${item.title}" with action: ${action}, resetOverseerr: ${options.resetOverseerr}`);

    const startTime = Date.now();
    // Only count freed space if we're actually deleting files
    const deletesFiles = action !== DeletionAction.UNMONITOR_ONLY;
    let fileSizeFreed = deletesFiles ? (item.file_size || 0) : 0;
    let overseerrReset = false;
    let overseerrError: string | undefined;

    try {
      switch (action) {
        case DeletionAction.UNMONITOR_ONLY:
          await this.unmonitorOnly(item);
          break;

        case DeletionAction.DELETE_FILES_ONLY:
          await this.deleteFilesOnly(item);
          break;

        case DeletionAction.UNMONITOR_AND_DELETE:
          await this.unmonitorAndDelete(item);
          break;

        case DeletionAction.FULL_REMOVAL:
          await this.fullRemoval(item);
          break;

        default:
          throw new Error(`Unknown deletion action: ${action}`);
      }

      // Reset in Overseerr if requested and item has TMDB ID
      if (options.resetOverseerr && item.tmdb_id && this.dependencies.overseerrService) {
        try {
          const mediaType = item.type === 'movie' ? 'movie' : 'tv';
          overseerrReset = await this.dependencies.overseerrService.resetMediaByTmdbId(
            item.tmdb_id,
            mediaType
          );

          if (overseerrReset) {
            logger.info(`Reset "${item.title}" in Overseerr - can be re-requested`);

            // Update media item with reset timestamp
            if (this.dependencies.mediaItemRepository) {
              await this.dependencies.mediaItemRepository.update(item.id, {
                overseerr_reset_at: new Date().toISOString(),
              } as any);
            }
          }
        } catch (overseerrErr) {
          overseerrError = overseerrErr instanceof Error ? overseerrErr.message : String(overseerrErr);
          logger.warn(`Failed to reset "${item.title}" in Overseerr: ${overseerrError}`);
          // Don't fail the deletion, just log the error
        }
      }

      // Record in deletion history
      if (this.dependencies.deletionHistoryRepository) {
        await this.dependencies.deletionHistoryRepository.create({
          media_item_id: item.id,
          title: item.title,
          type: item.type,
          file_size: deletesFiles ? item.file_size : null,
          deleted_at: new Date().toISOString(),
          deletion_type: 'automatic',
          deleted_by_rule_id: options.ruleId || null,
          overseerr_reset: overseerrReset ? 1 : 0,
        });
      }

      // Get rule name for activity logging
      let ruleName: string | undefined;
      if (options.ruleId && this.dependencies.ruleRepository) {
        const rule = await this.dependencies.ruleRepository.getById(options.ruleId);
        ruleName = rule?.name;
      }

      // Log to activity log
      try {
        logActivity({
          eventType: 'deletion',
          action: action === DeletionAction.UNMONITOR_ONLY ? 'unmonitored' : 'deleted',
          actorType: options.ruleId ? 'rule' : 'user',
          actorId: options.ruleId?.toString() || null,
          actorName: ruleName || 'Manual deletion',
          targetType: 'media_item',
          targetId: item.id,
          targetTitle: item.title,
          metadata: JSON.stringify({
            mediaType: item.type,
            fileSize: item.file_size,
            deletionAction: action,
            overseerrReset: overseerrReset,
          }),
        });
      } catch (activityError) {
        logger.warn('Failed to log activity for deletion:', activityError);
      }

      // Update item status (unless fully removed)
      if (action !== DeletionAction.FULL_REMOVAL && this.dependencies.mediaItemRepository) {
        await this.dependencies.mediaItemRepository.update(item.id, {
          status: 'deleted',
        });
      }

      const duration = Date.now() - startTime;
      logger.info(`Successfully processed "${item.title}" in ${duration}ms (action: ${action}, overseerr reset: ${overseerrReset})`);

      return {
        success: true,
        itemId: item.id,
        title: item.title,
        action,
        fileSizeFreed,
        deletedAt: new Date(),
        overseerrReset,
        overseerrError,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to delete "${item.title}":`, error);

      return {
        success: false,
        itemId: item.id,
        title: item.title,
        action,
        error: errorMessage,
        overseerrReset,
        overseerrError,
      };
    }
  }

  // ============================================================================
  // Deletion Action Implementations
  // ============================================================================

  /**
   * Only unmonitor the item, keep all files and metadata
   */
  private async unmonitorOnly(item: MediaItem): Promise<void> {
    logger.debug(`Unmonitoring "${item.title}" (keeping files)`);

    // Unmonitor in Sonarr
    if (item.sonarr_id && this.dependencies.sonarrService) {
      await this.dependencies.sonarrService.unmonitorSeries(item.sonarr_id);
      logger.debug(`Unmonitored series ${item.sonarr_id} in Sonarr`);
    }

    // Unmonitor in Radarr
    if (item.radarr_id && this.dependencies.radarrService) {
      await this.dependencies.radarrService.unmonitorMovie(item.radarr_id);
      logger.debug(`Unmonitored movie ${item.radarr_id} in Radarr`);
    }
  }

  /**
   * Delete only the media files, keep metadata in arr apps
   */
  private async deleteFilesOnly(item: MediaItem): Promise<void> {
    logger.debug(`Deleting files only for "${item.title}"`);

    // Delete physical file if path exists
    if (item.file_path && this.dependencies.fileService) {
      const deleted = await this.dependencies.fileService.deleteFile(item.file_path);
      if (!deleted) {
        logger.warn(`Could not delete file at: ${item.file_path}`);
      }
    }

    // Delete from Sonarr - sonarr_id is the series ID, so delete all episode files
    if (item.sonarr_id && this.dependencies.sonarrService) {
      await this.dependencies.sonarrService.deleteAllEpisodeFiles(item.sonarr_id);
    }

    // Delete from Radarr - radarr_id is the movie ID, so get and delete the movie file
    if (item.radarr_id && this.dependencies.radarrService) {
      await this.dependencies.radarrService.deleteMovieFilesByMovieId(item.radarr_id);
    }
  }

  /**
   * Unmonitor in arr apps and delete files
   */
  private async unmonitorAndDelete(item: MediaItem): Promise<void> {
    logger.debug(`Unmonitoring and deleting "${item.title}"`);

    // Unmonitor and delete in Sonarr - sonarr_id is the series ID
    if (item.sonarr_id && this.dependencies.sonarrService) {
      await this.dependencies.sonarrService.unmonitorSeries(item.sonarr_id);
      await this.dependencies.sonarrService.deleteAllEpisodeFiles(item.sonarr_id);
    }

    // Unmonitor and delete in Radarr - radarr_id is the movie ID
    if (item.radarr_id && this.dependencies.radarrService) {
      await this.dependencies.radarrService.unmonitorMovie(item.radarr_id);
      await this.dependencies.radarrService.deleteMovieFilesByMovieId(item.radarr_id);
    }

    // Delete physical file as fallback
    if (item.file_path && this.dependencies.fileService) {
      await this.dependencies.fileService.deleteFile(item.file_path);
    }
  }

  /**
   * Completely remove from arr apps (including metadata)
   */
  private async fullRemoval(item: MediaItem): Promise<void> {
    logger.debug(`Performing full removal of "${item.title}"`);

    // Remove from Sonarr completely
    if (item.sonarr_id && this.dependencies.sonarrService) {
      await this.dependencies.sonarrService.removeSeries(item.sonarr_id, true);
    }

    // Remove from Radarr completely
    if (item.radarr_id && this.dependencies.radarrService) {
      await this.dependencies.radarrService.removeMovie(item.radarr_id, true);
    }

    // Delete physical file as fallback
    if (item.file_path && this.dependencies.fileService) {
      await this.dependencies.fileService.deleteFile(item.file_path);
    }

    // Remove from local database
    if (this.dependencies.mediaItemRepository) {
      await this.dependencies.mediaItemRepository.delete(item.id);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get deletion statistics
   */
  async getStatistics(): Promise<{
    queueSize: number;
    pendingDeletions: number;
    totalSizeToFree: number;
  }> {
    const queue = await this.getQueue();
    const pending = queue.filter((item) => item.daysRemaining === 0);
    const totalSize = queue.reduce(
      (sum, item) => sum + (item.mediaItem.file_size || 0),
      0
    );

    return {
      queueSize: queue.length,
      pendingDeletions: pending.length,
      totalSizeToFree: totalSize,
    };
  }

  /**
   * Bulk mark items for deletion
   */
  async bulkMarkForDeletion(
    itemIds: number[],
    options: {
      gracePeriodDays?: number;
      ruleId?: number;
      deletionAction?: DeletionAction;
      resetOverseerr?: boolean;
    } = {}
  ): Promise<{ success: number; failed: number; errors: Array<{ id: number; error: string }> }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ id: number; error: string }>,
    };

    for (const itemId of itemIds) {
      try {
        await this.markForDeletion(itemId, options);
        results.success++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push({ id: itemId, error: errorMessage });
      }
    }

    logger.info(`Bulk mark for deletion: ${results.success} succeeded, ${results.failed} failed`);
    return results;
  }

  /**
   * Bulk unmark items from deletion
   */
  async bulkUnmarkForDeletion(
    itemIds: number[]
  ): Promise<{ success: number; failed: number; errors: Array<{ id: number; error: string }> }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ id: number; error: string }>,
    };

    for (const itemId of itemIds) {
      try {
        await this.unmarkForDeletion(itemId);
        results.success++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push({ id: itemId, error: errorMessage });
      }
    }

    logger.info(`Bulk unmark for deletion: ${results.success} succeeded, ${results.failed} failed`);
    return results;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let deletionServiceInstance: DeletionService | null = null;

/**
 * Get the singleton deletion service instance
 */
export function getDeletionService(): DeletionService {
  if (!deletionServiceInstance) {
    deletionServiceInstance = new DeletionService();
  }
  return deletionServiceInstance;
}

/**
 * Create a new deletion service instance
 */
export function createDeletionService(deps?: DeletionServiceDependencies): DeletionService {
  return new DeletionService(deps);
}

export { DeletionAction };
export default DeletionService;
