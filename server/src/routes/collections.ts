import { Router, Request, Response } from 'express';
import { z } from 'zod';
import collectionsRepo, { type Collection } from '../db/repositories/collections';
import mediaItemsRepo from '../db/repositories/mediaItems';
import settingsRepo from '../db/repositories/settings';
import { logActivity } from '../db/repositories/activity';
import { getRadarrService } from '../services/init';
import logger from '../utils/logger';

const router = Router();

/**
 * Convert a Collection DB row to camelCase client payload.
 */
function toClient(col: Collection): Record<string, unknown> {
  return {
    id: col.id,
    tmdbId: col.tmdb_id,
    title: col.title,
    overview: col.overview,
    posterUrl: col.poster_url,
    itemCount: col.item_count,
    isProtected: col.is_protected,
    protectionReason: col.protection_reason,
    protectedAt: col.protected_at,
    lastSyncedAt: col.last_synced_at,
    createdAt: col.created_at,
    updatedAt: col.updated_at,
  };
}

// GET /api/collections
router.get('/', (_req: Request, res: Response) => {
  try {
    const collections = collectionsRepo.findAll();
    res.json({
      success: true,
      data: collections.map(toClient),
    });
  } catch (error) {
    logger.error('Failed to list collections:', error);
    res.status(500).json({ success: false, error: 'Failed to list collections' });
  }
});

// GET /api/collections/:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid ID parameter' });
      return;
    }
    const col = collectionsRepo.findById(id);
    if (!col) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }
    res.json({ success: true, data: toClient(col) });
  } catch (error) {
    logger.error('Failed to get collection:', error);
    res.status(500).json({ success: false, error: 'Failed to get collection' });
  }
});

// GET /api/collections/:id/items
router.get('/:id/items', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid ID parameter' });
      return;
    }
    const col = collectionsRepo.findById(id);
    if (!col) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }
    const mediaItemIds = collectionsRepo.getMediaItemIds(id);
    const items = mediaItemIds
      .map((mid) => mediaItemsRepo.getById(mid))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type === 'show' ? 'tv' : item.type,
        year: item.year,
        size: item.file_size || 0,
        posterUrl: item.poster_url,
        status: item.status,
        isProtected: item.is_protected || false,
        radarrId: item.radarr_id,
        tmdbId: item.tmdb_id,
        imdbId: item.imdb_id,
      }));

    res.json({ success: true, data: items });
  } catch (error) {
    logger.error('Failed to get collection items:', error);
    res.status(500).json({ success: false, error: 'Failed to get collection items' });
  }
});

// POST /api/collections/sync
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const radarr = getRadarrService();
    if (!radarr) {
      res.status(400).json({ success: false, error: 'Radarr is not configured' });
      return;
    }
    const result = await radarr.syncCollections();
    res.json({
      success: true,
      data: {
        collectionsSynced: result.collectionsSynced,
        itemsMatched: result.itemsMatched,
      },
      message: `Synced ${result.collectionsSynced} collections, matched ${result.itemsMatched} items`,
    });
  } catch (error) {
    logger.error('Failed to sync collections:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync collections',
    });
  }
});

const ProtectionSchema = z.object({
  isProtected: z.boolean(),
  reason: z.string().optional().nullable(),
});

// PATCH /api/collections/:id/protection
router.patch('/:id/protection', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid ID parameter' });
      return;
    }

    const parsed = ProtectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.issues,
      });
      return;
    }

    const existing = collectionsRepo.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    const updated = collectionsRepo.setProtection(
      id,
      parsed.data.isProtected,
      parsed.data.reason ?? null
    );
    if (!updated) {
      res.status(500).json({ success: false, error: 'Failed to update protection' });
      return;
    }

    logger.info(
      `Collection ${id} (${existing.title}) protection set to ${parsed.data.isProtected}`
    );

    const itemCount = collectionsRepo.getMediaItemIds(id).length;
    const metaObj = {
      collectionId: id,
      itemCount,
      isProtected: parsed.data.isProtected,
      reason: parsed.data.reason ?? null,
    };
    logActivity({
      eventType: 'protection',
      action: parsed.data.isProtected ? 'collection_protected' : 'collection_unprotected',
      actorType: 'user',
      targetType: 'collection',
      targetId: id,
      targetTitle: existing.title,
      metadata: JSON.stringify(metaObj),
    });

    res.json({ success: true, data: toClient(updated) });
  } catch (error) {
    logger.error('Failed to update collection protection:', error);
    res.status(500).json({ success: false, error: 'Failed to update collection protection' });
  }
});

const QueueCollectionSchema = z.object({
  deletionAction: z.enum(['unmonitor_only', 'delete_files_only', 'unmonitor_and_delete', 'full_removal']),
  gracePeriodDays: z.number().optional(),
  resetOverseerr: z.boolean().optional(),
});

// POST /api/collections/:id/queue - Queue all items in a collection for deletion
router.post('/:id/queue', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid ID parameter' });
      return;
    }

    const col = collectionsRepo.findById(id);
    if (!col) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    const parsed = QueueCollectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.issues,
      });
      return;
    }

    const { deletionAction, resetOverseerr: requestedResetOverseerr } = parsed.data;

    // Get grace period from request or settings
    const defaultGracePeriod = settingsRepo.getNumber('default_grace_period_days', 7);
    const gracePeriodDays = parsed.data.gracePeriodDays ?? defaultGracePeriod;

    const resetOverseerr = requestedResetOverseerr === true ? 1 : 0;

    const now = new Date();
    const deleteAfter = new Date(now.getTime() + gracePeriodDays * 86400000);

    const mediaItemIds = collectionsRepo.getMediaItemIds(id);

    let queued = 0;
    let totalSize = 0;
    const skippedReasons: Record<string, number> = {};

    for (const itemId of mediaItemIds) {
      const item = mediaItemsRepo.getById(itemId);
      if (!item) {
        continue;
      }

      // Skip already queued items
      if (item.status === 'pending_deletion') {
        skippedReasons['already_queued'] = (skippedReasons['already_queued'] || 0) + 1;
        continue;
      }

      // Skip protected items
      if (item.is_protected) {
        skippedReasons['protected'] = (skippedReasons['protected'] || 0) + 1;
        continue;
      }

      const updated = mediaItemsRepo.update(itemId, {
        status: 'pending_deletion',
        marked_at: now.toISOString(),
        delete_after: deleteAfter.toISOString(),
        deletion_action: deletionAction,
        reset_overseerr: resetOverseerr,
      });

      if (updated) {
        queued++;
        totalSize += item.file_size || 0;

        logActivity({
          eventType: 'manual_action',
          action: 'item_queued',
          actorType: 'user',
          targetType: 'media_item',
          targetId: itemId,
          targetTitle: item.title,
        });
      }
    }

    const skipped = Object.values(skippedReasons).reduce((sum, n) => sum + n, 0);

    logger.info(
      `Collection ${id} (${col.title}) queued for deletion: ${queued} queued, ${skipped} skipped`
    );

    res.json({
      success: true,
      data: {
        queued,
        skipped,
        skippedReasons,
        totalSize,
      },
    });
  } catch (error) {
    logger.error('Failed to queue collection for deletion:', error);
    res.status(500).json({ success: false, error: 'Failed to queue collection for deletion' });
  }
});

export default router;
