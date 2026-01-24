import { Router, Request, Response } from 'express';
import mediaItemsRepo from '../db/repositories/mediaItems';
import historyRepo from '../db/repositories/historyRepo';
import logger from '../utils/logger';
import { getDeletionService } from '../services/deletion';
import { getSonarrService, getRadarrService, getOverseerrService } from '../services/init';
import { DeletionAction, DELETION_ACTION_LABELS } from '../rules/types';

// Progress event type
interface DeletionProgress {
  stage: 'starting' | 'unmonitoring' | 'deleting_files' | 'resetting_overseerr' | 'complete' | 'error';
  message: string;
  fileProgress?: {
    current: number;
    total: number;
    fileName: string;
    status: 'deleting' | 'deleted' | 'failed';
  };
  result?: {
    success: boolean;
    fileSizeFreed?: number;
    overseerrReset?: boolean;
    error?: string;
  };
}

const router = Router();

/**
 * Normalize deletion action values to handle legacy/malformed values
 */
function normalizeDeletionAction(action: string | undefined): DeletionAction {
  if (!action) return DeletionAction.UNMONITOR_AND_DELETE;

  // Map legacy values to current enum values
  const legacyMappings: Record<string, DeletionAction> = {
    'delete_files': DeletionAction.DELETE_FILES_ONLY,
    'unmonitor': DeletionAction.UNMONITOR_ONLY,
    'full_delete': DeletionAction.FULL_REMOVAL,
    'remove': DeletionAction.FULL_REMOVAL,
  };

  // Check if it's a legacy value
  if (legacyMappings[action]) {
    return legacyMappings[action];
  }

  // Check if it's a valid current enum value
  const validActions = Object.values(DeletionAction) as string[];
  if (validActions.includes(action)) {
    return action as DeletionAction;
  }

  // Default fallback
  logger.warn(`Unknown deletion action "${action}", defaulting to UNMONITOR_AND_DELETE`);
  return DeletionAction.UNMONITOR_AND_DELETE;
}

interface QueueItemResponse {
  id: string;
  mediaItemId: string;
  title: string;
  type: string;
  size: number;
  posterUrl?: string;
  queuedAt: string;
  deleteAt: string;
  matchedRule?: string;
  daysRemaining: number;
  deletionAction: DeletionAction;
  deletionActionLabel: string;
  resetOverseerr: boolean;
  requestedBy?: string;
  tmdbId?: number;
  overseerrResetAt?: string;
}

// GET /api/queue/upcoming - Get upcoming deletion queue items
router.get('/upcoming', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query['limit'] as string, 10) || 50;

    // Get all items pending deletion
    const pendingItems = mediaItemsRepo.getPendingDeletion();

    const now = new Date();
    const queueItems: QueueItemResponse[] = pendingItems
      .filter((item) => item.delete_after && item.marked_at)
      .map((item) => {
        const deleteAfter = new Date(item.delete_after!);
        const daysRemaining = Math.max(
          0,
          Math.ceil((deleteAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        );

        // Extract extended fields
        const itemAny = item as any;
        const deletionAction = normalizeDeletionAction(itemAny.deletion_action);

        return {
          id: String(item.id),
          mediaItemId: String(item.id),
          title: item.title,
          type: item.type === 'show' ? 'tv' : item.type,
          size: item.file_size || 0,
          posterUrl: item.poster_url || undefined,
          queuedAt: item.marked_at!,
          deleteAt: item.delete_after!,
          daysRemaining,
          deletionAction,
          deletionActionLabel: DELETION_ACTION_LABELS[deletionAction] || deletionAction,
          resetOverseerr: Boolean(itemAny.reset_overseerr),
          requestedBy: itemAny.requested_by || undefined,
          tmdbId: itemAny.tmdb_id || undefined,
          overseerrResetAt: itemAny.overseerr_reset_at || undefined,
        };
      })
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, limit);

    // Calculate totals
    const totalSize = queueItems.reduce((sum, item) => sum + item.size, 0);
    const readyForDeletion = queueItems.filter((item) => item.daysRemaining === 0).length;
    const willResetOverseerr = queueItems.filter((item) => item.resetOverseerr).length;

    res.json({
      success: true,
      data: queueItems,
      total: queueItems.length,
      summary: {
        totalItems: pendingItems.length,
        totalSize,
        readyForDeletion,
        willResetOverseerr,
      },
    });
  } catch (error) {
    logger.error('Failed to get upcoming queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve upcoming queue',
    });
  }
});

// GET /api/queue - Get full deletion queue
router.get('/', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query['limit'] as string, 10) || 100;
    const offset = parseInt(req.query['offset'] as string, 10) || 0;

    // Get all items pending deletion
    const pendingItems = mediaItemsRepo.getPendingDeletion();

    const now = new Date();
    const allQueueItems: QueueItemResponse[] = pendingItems
      .filter((item) => item.delete_after && item.marked_at)
      .map((item) => {
        const deleteAfter = new Date(item.delete_after!);
        const daysRemaining = Math.max(
          0,
          Math.ceil((deleteAfter.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        );

        // Extract extended fields
        const itemAny = item as any;
        const deletionAction = normalizeDeletionAction(itemAny.deletion_action);

        return {
          id: String(item.id),
          mediaItemId: String(item.id),
          title: item.title,
          type: item.type === 'show' ? 'tv' : item.type,
          size: item.file_size || 0,
          posterUrl: item.poster_url || undefined,
          queuedAt: item.marked_at!,
          deleteAt: item.delete_after!,
          daysRemaining,
          deletionAction,
          deletionActionLabel: DELETION_ACTION_LABELS[deletionAction] || deletionAction,
          resetOverseerr: Boolean(itemAny.reset_overseerr),
          requestedBy: itemAny.requested_by || undefined,
          tmdbId: itemAny.tmdb_id || undefined,
          overseerrResetAt: itemAny.overseerr_reset_at || undefined,
        };
      })
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const paginatedItems = allQueueItems.slice(offset, offset + limit);

    // Calculate totals
    const totalSize = allQueueItems.reduce((sum, item) => sum + item.size, 0);
    const readyForDeletion = allQueueItems.filter((item) => item.daysRemaining === 0).length;
    const willResetOverseerr = allQueueItems.filter((item) => item.resetOverseerr).length;

    res.json({
      success: true,
      data: paginatedItems,
      total: allQueueItems.length,
      limit,
      offset,
      summary: {
        totalItems: allQueueItems.length,
        totalSize,
        readyForDeletion,
        willResetOverseerr,
      },
    });
  } catch (error) {
    logger.error('Failed to get queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve queue',
    });
  }
});

// DELETE /api/queue/:id - Remove an item from the deletion queue (cancel deletion)
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid queue item ID',
      });
      return;
    }

    // Verify the item exists and is in pending_deletion status
    const item = mediaItemsRepo.getById(id);
    if (!item) {
      res.status(404).json({
        success: false,
        error: `Item not found: ${id}`,
      });
      return;
    }

    if (item.status !== 'pending_deletion') {
      res.status(400).json({
        success: false,
        error: 'Item is not in the deletion queue',
      });
      return;
    }

    // Remove from deletion queue by resetting status and clearing deletion fields
    const updatedItem = mediaItemsRepo.update(id, {
      status: 'monitored',
      marked_at: undefined,
      delete_after: undefined,
    });

    if (!updatedItem) {
      res.status(500).json({
        success: false,
        error: 'Failed to update item',
      });
      return;
    }

    logger.info(`Removed item "${item.title}" from deletion queue`);

    res.json({
      success: true,
      data: updatedItem,
      message: `"${item.title}" removed from deletion queue`,
    });
  } catch (error) {
    logger.error('Failed to remove item from queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove item from queue',
    });
  }
});

// POST /api/queue/process - Process the deletion queue (delete items whose grace period has expired)
router.post('/process', async (req: Request, res: Response) => {
  try {
    const dryRun = req.query['dryRun'] === 'true';

    // Get the deletion service
    const deletionService = getDeletionService();

    // Get items ready for deletion (where deleteAfter date has passed)
    const pendingItems = mediaItemsRepo.getPendingDeletion();
    const now = new Date();

    const itemsReadyForDeletion = pendingItems.filter((item) => {
      if (!item.delete_after) return false;
      const deleteAfter = new Date(item.delete_after);
      return deleteAfter <= now;
    });

    if (itemsReadyForDeletion.length === 0) {
      res.json({
        success: true,
        data: {
          processed: 0,
          deleted: 0,
          failed: 0,
          freedSpace: 0,
          overseerrResets: 0,
          dryRun,
        },
        message: 'No items ready for deletion',
      });
      return;
    }

    interface DeletionResultItem {
      id: number;
      title: string;
      fileSize: number | null;
      deletionAction: DeletionAction;
      deletionActionLabel: string;
      overseerrReset?: boolean;
      overseerrError?: string;
    }

    const results: {
      deleted: DeletionResultItem[];
      failed: Array<{ id: number; title: string; error: string }>;
    } = {
      deleted: [],
      failed: [],
    };

    let freedSpace = 0;
    let overseerrResets = 0;

    // Process each item
    for (const item of itemsReadyForDeletion) {
      try {
        const itemAny = item as any;
        const deletionAction = normalizeDeletionAction(itemAny.deletion_action);
        const resetOverseerr = Boolean(itemAny.reset_overseerr);
        const matchedRuleId = itemAny.matched_rule_id as number | undefined;

        if (dryRun) {
          // Dry run - just record what would be deleted
          const actionDeletesFiles = deletionAction !== DeletionAction.UNMONITOR_ONLY;
          logger.info(`[DRY RUN] Would process: "${item.title}" (action: ${deletionAction}, reset overseerr: ${resetOverseerr})`);
          results.deleted.push({
            id: item.id,
            title: item.title,
            fileSize: actionDeletesFiles ? item.file_size : 0,
            deletionAction,
            deletionActionLabel: DELETION_ACTION_LABELS[deletionAction] || deletionAction,
            overseerrReset: resetOverseerr,
          });
          if (actionDeletesFiles) {
            freedSpace += item.file_size || 0;
          }
          if (resetOverseerr) {
            overseerrResets++;
          }
        } else {
          // Actual deletion using DeletionService
          const result = await deletionService.executeDelete(item as any, deletionAction, {
            resetOverseerr,
            ruleId: matchedRuleId,
          });

          if (result.success) {
            results.deleted.push({
              id: item.id,
              title: item.title,
              fileSize: result.fileSizeFreed || null,
              deletionAction,
              deletionActionLabel: DELETION_ACTION_LABELS[deletionAction] || deletionAction,
              overseerrReset: result.overseerrReset,
              overseerrError: result.overseerrError,
            });
            freedSpace += result.fileSizeFreed || 0;
            if (result.overseerrReset) {
              overseerrResets++;
            }
            logger.info(`Processed item: "${item.title}" (action: ${deletionAction}, overseerr reset: ${result.overseerrReset})`);
          } else {
            results.failed.push({
              id: item.id,
              title: item.title,
              error: result.error || 'Unknown error',
            });
          }
        }
      } catch (itemError) {
        const errorMessage = itemError instanceof Error ? itemError.message : String(itemError);
        logger.error(`Failed to process deletion for "${item.title}":`, itemError);
        results.failed.push({
          id: item.id,
          title: item.title,
          error: errorMessage,
        });
      }
    }

    const freedSpaceGB = (freedSpace / (1024 * 1024 * 1024)).toFixed(2);

    logger.info(
      `Queue processing complete: ${results.deleted.length} processed, ${results.failed.length} failed, ${freedSpaceGB}GB freed, ${overseerrResets} Overseerr resets${dryRun ? ' (dry run)' : ''}`
    );

    res.json({
      success: true,
      data: {
        processed: itemsReadyForDeletion.length,
        deleted: results.deleted.length,
        failed: results.failed.length,
        freedSpace,
        freedSpaceFormatted: `${freedSpaceGB} GB`,
        overseerrResets,
        dryRun,
        results,
      },
      message: dryRun
        ? `Dry run complete: ${results.deleted.length} item(s) would be processed`
        : `Processed ${results.deleted.length} item(s), ${results.failed.length} failed, ${overseerrResets} Overseerr resets`,
    });
  } catch (error) {
    logger.error('Failed to process deletion queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process deletion queue',
    });
  }
});

// POST /api/queue/:id/delete-now - Immediately delete a single item (bypass grace period)
router.post('/:id/delete-now', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid queue item ID',
      });
      return;
    }

    // Verify the item exists and is in pending_deletion status
    const item = mediaItemsRepo.getById(id);
    if (!item) {
      res.status(404).json({
        success: false,
        error: `Item not found: ${id}`,
      });
      return;
    }

    if (item.status !== 'pending_deletion') {
      res.status(400).json({
        success: false,
        error: 'Item is not in the deletion queue',
      });
      return;
    }

    // Get the deletion service
    const deletionService = getDeletionService();

    // Extract deletion options from the item
    const itemAny = item as any;
    const deletionAction = normalizeDeletionAction(itemAny.deletion_action);
    const resetOverseerr = Boolean(itemAny.reset_overseerr);
    const matchedRuleId = itemAny.matched_rule_id as number | undefined;

    // Execute the deletion immediately
    const result = await deletionService.executeDelete(item as any, deletionAction, {
      resetOverseerr,
      ruleId: matchedRuleId,
    });

    if (result.success) {
      const freedSpaceGB = ((result.fileSizeFreed || 0) / (1024 * 1024 * 1024)).toFixed(2);
      logger.info(`Immediately deleted: "${item.title}" (action: ${deletionAction}, freed: ${freedSpaceGB}GB, overseerr reset: ${result.overseerrReset})`);

      res.json({
        success: true,
        data: {
          id: item.id,
          title: item.title,
          deletionAction,
          deletionActionLabel: DELETION_ACTION_LABELS[deletionAction] || deletionAction,
          fileSizeFreed: result.fileSizeFreed || 0,
          fileSizeFreedFormatted: `${freedSpaceGB} GB`,
          overseerrReset: result.overseerrReset,
          overseerrError: result.overseerrError,
        },
        message: `"${item.title}" deleted successfully`,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to delete item',
        data: {
          overseerrError: result.overseerrError,
        },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to immediately delete item: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage || 'Failed to delete item',
    });
  }
});

// POST /api/queue/:id/delete-now/stream - Delete with SSE progress streaming
router.post('/:id/delete-now/stream', async (req: Request, res: Response) => {
  const id = parseInt(req.params['id'] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: 'Invalid queue item ID' });
    return;
  }

  // Verify the item exists and is in pending_deletion status
  const item = mediaItemsRepo.getById(id);
  if (!item) {
    res.status(404).json({ success: false, error: `Item not found: ${id}` });
    return;
  }

  if (item.status !== 'pending_deletion') {
    res.status(400).json({ success: false, error: 'Item is not in the deletion queue' });
    return;
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Helper to send SSE events
  const sendProgress = (progress: DeletionProgress) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
  };

  try {
    const itemAny = item as any;
    const deletionAction = normalizeDeletionAction(itemAny.deletion_action);
    const resetOverseerr = Boolean(itemAny.reset_overseerr);
    const matchedRuleId = itemAny.matched_rule_id as number | undefined;

    sendProgress({ stage: 'starting', message: `Starting deletion of "${item.title}"...` });

    const sonarr = getSonarrService();
    const radarr = getRadarrService();
    const overseerr = getOverseerrService();

    let fileSizeFreed = 0;
    let overseerrResetSuccess = false;
    const deletesFiles = deletionAction !== DeletionAction.UNMONITOR_ONLY;

    // Track file deletion progress
    const onFileProgress = (progress: { current: number; total: number; fileName: string; status: 'deleting' | 'deleted' | 'failed' }) => {
      sendProgress({
        stage: 'deleting_files',
        message: `Deleting file ${progress.current}/${progress.total}`,
        fileProgress: progress,
      });
    };

    // Unmonitor if needed
    if (deletionAction === DeletionAction.UNMONITOR_ONLY ||
        deletionAction === DeletionAction.UNMONITOR_AND_DELETE) {
      sendProgress({ stage: 'unmonitoring', message: 'Unmonitoring in Sonarr/Radarr...' });

      if (item.sonarr_id && sonarr) {
        await sonarr.unmonitorSeries(item.sonarr_id);
      }
      if (item.radarr_id && radarr) {
        await radarr.unmonitorMovie(item.radarr_id);
      }
    }

    // Delete files if needed
    if (deletionAction === DeletionAction.DELETE_FILES_ONLY ||
        deletionAction === DeletionAction.UNMONITOR_AND_DELETE) {
      sendProgress({ stage: 'deleting_files', message: 'Deleting media files...' });

      if (item.sonarr_id && sonarr) {
        await sonarr.deleteAllEpisodeFiles(item.sonarr_id, onFileProgress);
      }
      if (item.radarr_id && radarr) {
        await radarr.deleteMovieFilesByMovieId(item.radarr_id, onFileProgress);
      }

      if (deletesFiles) {
        fileSizeFreed = item.file_size || 0;
      }
    }

    // Full removal - delete everything at once via Sonarr/Radarr
    if (deletionAction === DeletionAction.FULL_REMOVAL) {
      sendProgress({ stage: 'deleting_files', message: 'Removing from Sonarr/Radarr completely...' });

      if (item.sonarr_id && sonarr) {
        await sonarr.removeSeries(item.sonarr_id, true);
      }
      if (item.radarr_id && radarr) {
        await radarr.removeMovie(item.radarr_id, true);
      }

      fileSizeFreed = item.file_size || 0;
    }

    // Reset Overseerr if requested
    if (resetOverseerr && itemAny.tmdb_id && overseerr) {
      sendProgress({ stage: 'resetting_overseerr', message: 'Resetting in Overseerr...' });

      try {
        const mediaType = item.type === 'movie' ? 'movie' : 'tv';
        overseerrResetSuccess = await overseerr.resetMediaByTmdbId(itemAny.tmdb_id, mediaType);

        if (overseerrResetSuccess) {
          mediaItemsRepo.update(item.id, { overseerr_reset_at: new Date().toISOString() } as any);
        }
      } catch (overseerrErr) {
        logger.warn(`Failed to reset in Overseerr: ${overseerrErr}`);
      }
    }

    // Record in deletion history
    historyRepo.create({
      media_item_id: item.id,
      title: item.title,
      type: item.type,
      file_size: deletesFiles ? item.file_size : null,
      deletion_type: 'manual',
      deleted_by_rule_id: matchedRuleId || null,
    });

    // Update item status
    if (deletionAction !== DeletionAction.FULL_REMOVAL) {
      mediaItemsRepo.update(item.id, { status: 'deleted' });
    } else {
      mediaItemsRepo.delete(item.id);
    }

    const freedSpaceGB = (fileSizeFreed / (1024 * 1024 * 1024)).toFixed(2);
    logger.info(`Deleted "${item.title}" via stream (action: ${deletionAction}, freed: ${freedSpaceGB}GB, overseerr: ${overseerrResetSuccess})`);

    // Send completion
    sendProgress({
      stage: 'complete',
      message: `"${item.title}" deleted successfully`,
      result: {
        success: true,
        fileSizeFreed,
        overseerrReset: overseerrResetSuccess,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to delete item via stream: ${errorMessage}`);

    sendProgress({
      stage: 'error',
      message: `Failed to delete: ${errorMessage}`,
      result: {
        success: false,
        error: errorMessage,
      },
    });
  } finally {
    res.end();
  }
});

export default router;
