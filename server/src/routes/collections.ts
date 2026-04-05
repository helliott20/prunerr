import { Router, Request, Response } from 'express';
import { z } from 'zod';
import collectionsRepo, { type Collection } from '../db/repositories/collections';
import mediaItemsRepo from '../db/repositories/mediaItems';
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
    res.json({ success: true, data: toClient(updated) });
  } catch (error) {
    logger.error('Failed to update collection protection:', error);
    res.status(500).json({ success: false, error: 'Failed to update collection protection' });
  }
});

export default router;
