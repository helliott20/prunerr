import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mediaItemsRepo from '../db/repositories/mediaItems';
import settingsRepo from '../db/repositories/settings';
import { ScannerService } from '../services/scanner';
import logger from '../utils/logger';
import { formatBytes } from '../utils/format';

const router = Router();

// Scanner service instance for library sync
let scannerService: ScannerService | null = null;

// Get or create scanner service
function getScanner(): ScannerService {
  if (!scannerService) {
    scannerService = new ScannerService();
    // Set up database callback for syncing
    scannerService.setDatabaseCallback(async (items) => {
      for (const item of items) {
        const input = scannerService!.convertToMediaItemInput(item);
        const existingItem = input.plex_id ? mediaItemsRepo.getByPlexId(input.plex_id) : null;
        if (existingItem) {
          mediaItemsRepo.update(existingItem.id, input);
        } else {
          mediaItemsRepo.create(input);
        }
      }
    });
  }
  return scannerService;
}

// In-memory flag to prevent concurrent syncs
let syncInProgress = false;

// Query parameter schema for library filtering
const LibraryFiltersSchema = z.object({
  type: z.enum(['movie', 'show', 'episode']).optional(),
  status: z.enum(['monitored', 'flagged', 'pending_deletion', 'protected', 'deleted', 'watched', 'unwatched', 'queued']).optional(),
  search: z.string().optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  minSize: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
  maxSize: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
  unwatchedDays: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined)),
  protected: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
});

// GET /api/library - Get library items with filters
router.get('/', (req: Request, res: Response) => {
  try {
    const parseResult = LibraryFiltersSchema.safeParse(req.query);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
      return;
    }

    const filters = parseResult.data;

    // Calculate offset from page if not provided directly
    const offset = filters.offset ?? (filters.page - 1) * filters.limit;

    // Map client status values to server status values
    let serverStatus: 'monitored' | 'flagged' | 'pending_deletion' | 'protected' | 'deleted' | undefined;
    let watchedFilter: boolean | undefined;

    if (filters.status === 'queued') {
      serverStatus = 'pending_deletion';
    } else if (filters.status === 'watched') {
      watchedFilter = true;
    } else if (filters.status === 'unwatched') {
      watchedFilter = false;
    } else if (filters.status && ['monitored', 'flagged', 'pending_deletion', 'protected', 'deleted'].includes(filters.status)) {
      serverStatus = filters.status as 'monitored' | 'flagged' | 'pending_deletion' | 'protected' | 'deleted';
    }

    // Build filters for mediaItemsRepo - ALL filtering happens at DB level now
    const repoFilters = {
      type: filters.type as 'movie' | 'show' | 'episode' | undefined,
      status: serverStatus,
      search: filters.search,
      limit: filters.limit,
      offset: offset,
      minSize: filters.minSize,
      maxSize: filters.maxSize,
      watched: watchedFilter,
      unwatchedDays: filters.unwatchedDays,
      isProtected: filters.protected,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    };

    // Get items from repository - filtering, sorting, and pagination all happen at DB level
    const result = mediaItemsRepo.getAll(repoFilters);
    const items = result.data;

    // Calculate summary stats
    const totalSize = items.reduce((sum, item) => sum + (item.file_size || 0), 0);
    const movieCount = items.filter((i) => i.type === 'movie').length;
    const showCount = items.filter((i) => i.type === 'show').length;
    const episodeCount = items.filter((i) => i.type === 'episode').length;

    // Calculate pagination
    const totalPages = Math.ceil(result.total / filters.limit);

    // Transform items to match client expected format
    const transformedItems = items.map((item) => ({
      id: String(item.id),
      title: item.title,
      type: item.type === 'show' ? 'tv' : item.type, // Map 'show' to 'tv' for client
      year: item.year,
      size: item.file_size || 0,
      posterUrl: item.poster_url,
      watched: (item.play_count || 0) > 0,
      lastWatched: item.last_watched_at,
      addedAt: item.added_at || item.created_at,
      status: item.status === 'pending_deletion' ? 'queued' : item.status === 'monitored' ? 'active' : item.status,
      isProtected: item.is_protected || false,
      plexId: item.plex_id,
      sonarrId: item.sonarr_id,
      radarrId: item.radarr_id,
      tvdbId: item.tvdb_id,
      tmdbId: item.tmdb_id,
      imdbId: item.imdb_id,
      playCount: item.play_count,
      watchedBy: item.watched_by,
      resolution: item.resolution,
      codec: item.codec,
    }));

    res.json({
      success: true,
      data: {
        items: transformedItems,
        total: result.total,
        page: filters.page,
        totalPages,
        summary: {
          totalSize,
          movieCount,
          showCount,
          episodeCount,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to get library items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve library items',
    });
  }
});

// GET /api/library/summary - Get library summary statistics
router.get('/summary', (_req: Request, res: Response) => {
  try {
    const stats = mediaItemsRepo.getStats();

    res.json({
      success: true,
      data: {
        total: stats.total,
        byType: stats.byType,
        byStatus: stats.byStatus,
        totalSize: stats.totalSize,
        totalSizeFormatted: formatBytes(stats.totalSize),
      },
    });
  } catch (error) {
    logger.error('Failed to get library summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve library summary',
    });
  }
});

// Schema for bulk mark-deletion request body
const BulkMarkDeletionSchema = z.object({
  ids: z.array(z.number()).min(1, 'At least one ID is required'),
  gracePeriodDays: z.number().optional(),
  deletionAction: z.enum(['unmonitor_only', 'delete_files_only', 'unmonitor_and_delete', 'full_removal']).optional(),
  resetOverseerr: z.boolean().optional(),
});

// POST /api/library/bulk/mark-deletion - Mark multiple items for deletion
// NOTE: This route MUST be defined before /:id routes to avoid matching 'bulk' as an ID
router.post('/bulk/mark-deletion', (req: Request, res: Response) => {
  try {
    const parseResult = BulkMarkDeletionSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parseResult.error.issues,
      });
      return;
    }

    const { ids, gracePeriodDays, deletionAction: requestedDeletionAction, resetOverseerr: requestedResetOverseerr } = parseResult.data;

    // Get default grace period from settings if not provided
    const defaultGracePeriod = settingsRepo.getNumber('default_grace_period_days', 7);
    const actualGracePeriod = gracePeriodDays ?? defaultGracePeriod;

    // Get deletion action (from request or settings)
    const deletionAction = requestedDeletionAction || settingsRepo.getValue('default_deletion_action') || 'unmonitor_and_delete';

    // Get reset overseerr flag
    const resetOverseerr = requestedResetOverseerr === true ? 1 : 0;

    const results = {
      success: [] as { id: number; title: string }[],
      failed: [] as { id: number; error: string }[],
      skipped: [] as { id: number; title: string; reason: string }[],
    };

    const now = new Date();
    const deleteAfter = new Date(now);
    deleteAfter.setDate(deleteAfter.getDate() + actualGracePeriod);

    for (const id of ids) {
      const item = mediaItemsRepo.getById(id);

      if (!item) {
        results.failed.push({ id, error: 'Item not found' });
        continue;
      }

      // Skip protected items
      if (item.is_protected) {
        results.skipped.push({ id, title: item.title, reason: 'Item is protected' });
        continue;
      }

      // For already queued items, update with new options (don't reset marked_at)
      const isAlreadyQueued = item.status === 'pending_deletion';

      // Mark for deletion with all options (or update existing)
      const updatedItem = mediaItemsRepo.update(id, {
        status: 'pending_deletion',
        marked_at: isAlreadyQueued ? (item.marked_at ?? undefined) : now.toISOString(),
        delete_after: deleteAfter.toISOString(),
        deletion_action: deletionAction,
        reset_overseerr: resetOverseerr,
      });

      if (updatedItem) {
        results.success.push({ id, title: item.title });
      } else {
        results.failed.push({ id, error: 'Failed to update' });
      }
    }

    logger.info(`Bulk mark for deletion: ${results.success.length} marked, ${results.skipped.length} skipped, ${results.failed.length} failed`);

    res.json({
      success: true,
      data: results,
      message: `${results.success.length} item(s) marked for deletion`,
    });
  } catch (error) {
    logger.error('Failed to bulk mark items for deletion:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk mark items for deletion',
    });
  }
});

// Schema for bulk protect request body
const BulkProtectSchema = z.object({
  ids: z.array(z.number()).min(1, 'At least one ID is required'),
  reason: z.string().optional(),
});

// POST /api/library/bulk/protect - Protect multiple items from deletion
// NOTE: This route MUST be defined before /:id routes to avoid matching 'bulk' as an ID
router.post('/bulk/protect', (req: Request, res: Response) => {
  try {
    const parseResult = BulkProtectSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parseResult.error.issues,
      });
      return;
    }

    const { ids, reason } = parseResult.data;
    const protectReason = reason || 'Bulk protected';

    const results = {
      success: [] as { id: number; title: string }[],
      failed: [] as { id: number; error: string }[],
      skipped: [] as { id: number; title: string; reason: string }[],
    };

    for (const id of ids) {
      const item = mediaItemsRepo.getById(id);

      if (!item) {
        results.failed.push({ id, error: 'Item not found' });
        continue;
      }

      // Skip already protected items
      if (item.is_protected) {
        results.skipped.push({ id, title: item.title, reason: 'Already protected' });
        continue;
      }

      // Protect the item
      const updatedItem = mediaItemsRepo.protect(id, protectReason);

      if (updatedItem) {
        results.success.push({ id, title: item.title });
      } else {
        results.failed.push({ id, error: 'Failed to protect' });
      }
    }

    logger.info(`Bulk protect: ${results.success.length} protected, ${results.skipped.length} skipped, ${results.failed.length} failed`);

    res.json({
      success: true,
      data: results,
      message: `${results.success.length} item(s) protected`,
    });
  } catch (error) {
    logger.error('Failed to bulk protect items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk protect items',
    });
  }
});

// GET /api/library/:id - Get a single media item by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid ID parameter',
      });
      return;
    }

    const item = mediaItemsRepo.getById(id);

    if (!item) {
      res.status(404).json({
        success: false,
        error: 'Media item not found',
      });
      return;
    }

    res.json({
      success: true,
      data: item,
    });
  } catch (error) {
    logger.error('Failed to get media item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve media item',
    });
  }
});

// POST /api/library/sync - Sync library from Plex (trigger a scan)
router.post('/sync', async (_req: Request, res: Response) => {
  // Check if sync is already in progress
  if (syncInProgress) {
    res.status(409).json({
      success: false,
      error: 'A sync is already in progress',
    });
    return;
  }

  syncInProgress = true;

  // Return immediately - sync runs asynchronously
  res.status(202).json({
    success: true,
    message: 'Library sync started',
  });

  // Execute sync asynchronously
  try {
    const scanner = getScanner();
    // Reinitialize to pick up any settings changes
    scanner.reinitialize();
    const result = await scanner.scanAll();
    logger.info('Library sync completed', {
      itemsScanned: result.itemsScanned,
      itemsAdded: result.itemsAdded,
      itemsUpdated: result.itemsUpdated,
      errors: result.errors.length,
    });
  } catch (error) {
    logger.error('Library sync failed:', error);
  } finally {
    syncInProgress = false;
  }
});

// Schema for mark-deletion request body
const MarkDeletionSchema = z.object({
  gracePeriodDays: z.number().optional(),
  deletionAction: z.enum(['unmonitor_only', 'delete_files_only', 'unmonitor_and_delete', 'full_removal']).optional(),
  resetOverseerr: z.boolean().optional(),
});

// POST /api/library/:id/mark-deletion - Mark an item for deletion (add to queue)
router.post('/:id/mark-deletion', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid ID parameter',
      });
      return;
    }

    const item = mediaItemsRepo.getById(id);

    if (!item) {
      res.status(404).json({
        success: false,
        error: 'Media item not found',
      });
      return;
    }

    // Check if item is protected
    if (item.is_protected) {
      res.status(409).json({
        success: false,
        error: 'Cannot mark a protected item for deletion',
      });
      return;
    }

    // Parse optional deletion options from request body
    const parseResult = MarkDeletionSchema.safeParse(req.body);

    // Get grace period (from request or settings)
    let gracePeriodDays: number;
    if (parseResult.success && parseResult.data.gracePeriodDays !== undefined) {
      gracePeriodDays = parseResult.data.gracePeriodDays;
    } else {
      // Get default grace period from settings (default to 7 days)
      gracePeriodDays = settingsRepo.getNumber('deletion_grace_period_days', 7);
    }

    // Get deletion action (from request or settings)
    const deletionAction = parseResult.success && parseResult.data.deletionAction
      ? parseResult.data.deletionAction
      : settingsRepo.getValue('default_deletion_action') || 'unmonitor_and_delete';

    // Get reset overseerr flag
    const resetOverseerr = parseResult.success && parseResult.data.resetOverseerr === true ? 1 : 0;

    // Calculate delete_after date
    const now = new Date();
    const deleteAfter = new Date(now);
    deleteAfter.setDate(deleteAfter.getDate() + gracePeriodDays);

    // For already queued items, preserve the original marked_at date
    const isAlreadyQueued = item.status === 'pending_deletion';

    // Update the item status with all options
    const updatedItem = mediaItemsRepo.update(id, {
      status: 'pending_deletion',
      marked_at: isAlreadyQueued ? (item.marked_at ?? undefined) : now.toISOString(),
      delete_after: deleteAfter.toISOString(),
      deletion_action: deletionAction,
      reset_overseerr: resetOverseerr,
    });

    if (!updatedItem) {
      res.status(500).json({
        success: false,
        error: 'Failed to update media item',
      });
      return;
    }

    logger.info(`Marked item for deletion: ${item.title} (ID: ${id}), delete after: ${deleteAfter.toISOString()}`);

    res.json({
      success: true,
      data: updatedItem,
      message: `Item marked for deletion. Will be deleted after ${deleteAfter.toISOString()}`,
    });
  } catch (error) {
    logger.error('Failed to mark item for deletion:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark item for deletion',
    });
  }
});

// Schema for protect request body
const ProtectSchema = z.object({
  reason: z.string().optional(),
});

// POST /api/library/:id/protect - Protect an item from deletion
router.post('/:id/protect', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid ID parameter',
      });
      return;
    }

    const item = mediaItemsRepo.getById(id);

    if (!item) {
      res.status(404).json({
        success: false,
        error: 'Media item not found',
      });
      return;
    }

    // Parse optional reason from request body
    const parseResult = ProtectSchema.safeParse(req.body);
    const reason = parseResult.success && parseResult.data.reason ? parseResult.data.reason : 'Manually protected';

    // Protect the item
    const updatedItem = mediaItemsRepo.protect(id, reason);

    if (!updatedItem) {
      res.status(500).json({
        success: false,
        error: 'Failed to protect media item',
      });
      return;
    }

    logger.info(`Protected item: ${item.title} (ID: ${id}), reason: ${reason}`);

    res.json({
      success: true,
      data: updatedItem,
      message: 'Item protected from deletion',
    });
  } catch (error) {
    logger.error('Failed to protect item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to protect item',
    });
  }
});

// DELETE /api/library/:id/protect - Remove protection from an item
router.delete('/:id/protect', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);

    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid ID parameter',
      });
      return;
    }

    const item = mediaItemsRepo.getById(id);

    if (!item) {
      res.status(404).json({
        success: false,
        error: 'Media item not found',
      });
      return;
    }

    // Check if item is actually protected
    if (!item.is_protected) {
      res.status(409).json({
        success: false,
        error: 'Item is not protected',
      });
      return;
    }

    // Remove protection
    const updatedItem = mediaItemsRepo.unprotect(id);

    if (!updatedItem) {
      res.status(500).json({
        success: false,
        error: 'Failed to remove protection from media item',
      });
      return;
    }

    logger.info(`Removed protection from item: ${item.title} (ID: ${id})`);

    res.json({
      success: true,
      data: updatedItem,
      message: 'Protection removed from item',
    });
  } catch (error) {
    logger.error('Failed to remove protection from item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove protection from item',
    });
  }
});

export default router;
