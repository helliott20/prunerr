import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mediaItemsRepo from '../db/repositories/mediaItems';
import collectionsRepo from '../db/repositories/collections';
import settingsRepo from '../db/repositories/settings';
import { logActivity } from '../db/repositories/activity';
import { ScannerService } from '../services/scanner';
import { getPlexService } from '../services/init';
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

    // Batch-fetch protected collections for all items on this page (single query).
    const itemIds = items.map((item) => item.id);
    const protectedCollectionsMap = collectionsRepo.findProtectedForItems(itemIds);

    // Transform items to match client expected format.
    // Derive protection status from both the item flag and collection membership.
    const transformedItems = items.map((item) => {
      const protectedCollections = protectedCollectionsMap.get(item.id) ?? [];
      const collectionProtected = protectedCollections.length > 0;
      return {
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
        isProtected: item.is_protected || collectionProtected,
        protectedByCollection: collectionProtected
          ? { id: protectedCollections[0]!.id, title: protectedCollections[0]!.title }
          : null,
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
      };
    });

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

    // Batch-fetch collection protection for all IDs (single query)
    const protectedMap = collectionsRepo.findProtectedForItems(ids);

    for (const id of ids) {
      const item = mediaItemsRepo.getById(id);

      if (!item) {
        results.failed.push({ id, error: 'Item not found' });
        continue;
      }

      // Skip protected items (item-level or collection-level)
      const protectedColls = protectedMap.get(id) ?? [];
      if (item.is_protected || protectedColls.length > 0) {
        const reason = item.is_protected
          ? 'Item is protected'
          : `Protected via collection "${protectedColls[0]!.title}"`;
        results.skipped.push({ id, title: item.title, reason });
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

    for (const item of results.success) {
      logActivity({
        eventType: 'manual_action',
        action: 'item_queued',
        actorType: 'user',
        targetType: 'media_item',
        targetId: item.id,
        targetTitle: item.title,
      });
    }

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

    for (const item of results.success) {
      logActivity({
        eventType: 'protection',
        action: 'protected',
        actorType: 'user',
        targetType: 'media_item',
        targetId: item.id,
        targetTitle: item.title,
      });
    }

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

// GET /api/library/plex-libraries - Get available Plex libraries for exclusion config
router.get('/plex-libraries', async (_req: Request, res: Response) => {
  try {
    const plex = getPlexService();
    if (!plex) {
      res.status(400).json({
        success: false,
        error: 'Plex is not configured',
      });
      return;
    }

    const libraries = await plex.getLibraries();
    const excludedKeysRaw = settingsRepo.getValue('excluded_library_keys');
    let excludedKeys: string[] = [];
    try {
      excludedKeys = excludedKeysRaw ? JSON.parse(excludedKeysRaw) : [];
    } catch {
      logger.warn('Failed to parse excluded_library_keys setting, ignoring');
    }

    res.json({
      success: true,
      data: libraries.map((lib) => ({
        key: lib.key,
        title: lib.title,
        type: lib.type,
        excluded: excludedKeys.includes(lib.key),
      })),
    });
  } catch (error) {
    logger.error('Failed to get Plex libraries:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve Plex libraries',
    });
  }
});

// PUT /api/library/plex-libraries/exclusions - Save library exclusions and purge items from newly-excluded libraries
router.put('/plex-libraries/exclusions', async (req: Request, res: Response) => {
  try {
    const { excludedKeys } = req.body as { excludedKeys: string[] };
    if (!Array.isArray(excludedKeys) || excludedKeys.some((k) => typeof k !== 'string' || k.trim() === '')) {
      res.status(400).json({ success: false, error: 'excludedKeys must be an array of non-empty strings' });
      return;
    }

    // Save the new exclusion list
    settingsRepo.set({ key: 'excluded_library_keys', value: JSON.stringify(excludedKeys) });

    // Purge items from ALL excluded libraries (catches stragglers from previous exclusions too)
    let totalRemoved = 0;
    const plex = getPlexService();
    for (const key of excludedKeys) {
      // Try by library_key column (items scanned after migration 9)
      const removed = mediaItemsRepo.deleteByLibraryKey(key);
      totalRemoved += removed;

      // Fetch Plex library items and delete by plex_id, then by title as fallback
      if (plex) {
        try {
          const items = await plex.getLibraryItems(key);

          // Delete by plex_id (legacy items without library_key)
          const plexIds = items.map((item) => item.ratingKey).filter(Boolean);
          if (plexIds.length > 0) {
            const removedByPlex = mediaItemsRepo.deleteByPlexIds(plexIds);
            totalRemoved += removedByPlex;
            if (removedByPlex > 0) {
              logger.info(`Removed ${removedByPlex} items from library ${key} by plex_id`);
            }
          }

          // Final fallback: delete by title match for any remaining stragglers
          const titles = items.map((item) => item.title).filter(Boolean);
          if (titles.length > 0) {
            const removedByTitle = mediaItemsRepo.deleteByTitles(titles);
            totalRemoved += removedByTitle;
            if (removedByTitle > 0) {
              logger.info(`Removed ${removedByTitle} stragglers from library ${key} by title match`);
            }
          }
        } catch (plexError) {
          logger.warn(`Failed to fetch Plex library ${key} for purge:`, plexError);
        }
      }
    }

    // Clean up orphaned items not found in any included library
    if (plex) {
      try {
        const allLibraries = await plex.getLibraries();
        const includedKeys = allLibraries
          .filter((lib) => !excludedKeys.includes(lib.key))
          .filter((lib) => lib.type === 'movie' || lib.type === 'show');

        if (includedKeys.length === 0) {
          // All libraries excluded — delete everything remaining
          const { getDatabase } = await import('../db');
          const db = getDatabase();
          const result = db.prepare('DELETE FROM media_items').run();
          totalRemoved += result.changes;
          if (result.changes > 0) {
            logger.info(`Removed ${result.changes} orphaned items (all libraries excluded)`);
          }
        } else {
          // Collect all valid plex_ids from included libraries
          const includedPlexIds = new Set<string>();
          for (const lib of includedKeys) {
            try {
              const items = await plex.getLibraryItems(lib.key);
              for (const item of items) {
                if (item.ratingKey) includedPlexIds.add(item.ratingKey);
              }
            } catch { /* skip failed library fetches */ }
          }

          // Delete any items whose plex_id is not in any included library
          if (includedPlexIds.size > 0) {
            const { getDatabase } = await import('../db');
            const db = getDatabase();
            const allItems = db.prepare<[], { id: number; plex_id: string | null }>('SELECT id, plex_id FROM media_items').all();
            const orphanIds = allItems
              .filter((item) => !item.plex_id || !includedPlexIds.has(item.plex_id))
              .map((item) => item.id);

            if (orphanIds.length > 0) {
              const CHUNK = 500;
              for (let i = 0; i < orphanIds.length; i += CHUNK) {
                const chunk = orphanIds.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '?').join(',');
                db.prepare(`DELETE FROM media_items WHERE id IN (${placeholders})`).run(...chunk);
              }
              totalRemoved += orphanIds.length;
              logger.info(`Removed ${orphanIds.length} orphaned items not in any included library`);
            }
          }
        }
      } catch (orphanError) {
        logger.warn('Failed to clean up orphaned items:', orphanError);
      }
    }

    if (totalRemoved > 0) {
      logger.info(`Removed ${totalRemoved} items total from excluded/orphaned libraries`);
    }

    res.json({
      success: true,
      data: { removedItems: totalRemoved, excludedKeys },
      message: totalRemoved > 0
        ? `Saved. Removed ${totalRemoved} items from excluded libraries.`
        : 'Library exclusions saved.',
    });
  } catch (error) {
    logger.error('Failed to save library exclusions:', error);
    res.status(500).json({ success: false, error: 'Failed to save library exclusions' });
  }
});

// GET /api/library/sync/status - Check if sync is in progress
router.get('/sync/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      inProgress: syncInProgress,
    },
  });
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

    // Enrich with collection-derived protection
    const protectedCollections = collectionsRepo.findProtectedContainingItem(id);
    const enriched = {
      ...item,
      is_protected: item.is_protected || protectedCollections.length > 0,
      protected_by_collection: protectedCollections.length > 0
        ? { id: protectedCollections[0]!.id, title: protectedCollections[0]!.title }
        : null,
    };

    res.json({
      success: true,
      data: enriched,
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

// Sync progress broadcasting — allows multiple clients to receive progress from a single sync
const syncProgressLog: unknown[] = [];
const syncListeners = new Set<(data: unknown) => void>();

function broadcastProgress(data: unknown): void {
  syncProgressLog.push(data);
  for (const listener of syncListeners) {
    try { listener(data); } catch { /* client disconnected */ }
  }
}

// GET /api/library/sync/stream - Subscribe to in-progress sync events (reconnect-safe)
router.get('/sync/stream', (_req: Request, res: Response) => {
  if (!syncInProgress) {
    res.status(204).end();
    return;
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay buffered events so the client catches up
  for (const event of syncProgressLog) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Listen for new events
  const listener = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  syncListeners.add(listener);

  // Clean up on disconnect
  _req.on('close', () => {
    syncListeners.delete(listener);
  });
});

// POST /api/library/sync/stream - Start sync with SSE progress streaming
router.post('/sync/stream', async (_req: Request, res: Response) => {
  if (syncInProgress) {
    res.status(409).json({
      success: false,
      error: 'A sync is already in progress',
    });
    return;
  }

  syncInProgress = true;
  syncProgressLog.length = 0; // Clear previous log

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // This client is also a listener
  const sendToSelf = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  syncListeners.add(sendToSelf);

  try {
    const scanner = getScanner();
    scanner.reinitialize();

    const result = await scanner.scanAll((progress) => {
      broadcastProgress(progress);
    });

    logger.info('Library sync completed (streamed)', {
      itemsScanned: result.itemsScanned,
      itemsAdded: result.itemsAdded,
      itemsUpdated: result.itemsUpdated,
      errors: result.errors.length,
    });
  } catch (error) {
    logger.error('Library sync failed:', error);
    broadcastProgress({
      stage: 'error',
      message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
      result: { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, errors: 1 },
    });
  } finally {
    syncInProgress = false;
    syncListeners.delete(sendToSelf);
    // Close all remaining listeners
    for (const listener of syncListeners) {
      try { listener({ stage: 'complete', message: 'Sync stream ended' }); } catch { /* ignore */ }
    }
    syncListeners.clear();
    res.end();
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

    // Check if item is protected (item-level or collection-level)
    if (item.is_protected) {
      res.status(409).json({
        success: false,
        error: 'Cannot mark a protected item for deletion',
      });
      return;
    }

    const protectedCollections = collectionsRepo.findProtectedContainingItem(id);
    if (protectedCollections.length > 0) {
      res.status(409).json({
        success: false,
        error: `Item is protected via collection "${protectedCollections[0]!.title}"`,
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

    logActivity({
      eventType: 'manual_action',
      action: 'item_queued',
      actorType: 'user',
      targetType: 'media_item',
      targetId: id,
      targetTitle: item.title,
    });

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

    logActivity({
      eventType: 'protection',
      action: 'protected',
      actorType: 'user',
      targetType: 'media_item',
      targetId: id,
      targetTitle: item.title,
    });

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

    logActivity({
      eventType: 'protection',
      action: 'unprotected',
      actorType: 'user',
      targetType: 'media_item',
      targetId: id,
      targetTitle: item.title,
    });

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
