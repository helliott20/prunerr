import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import mediaItemsRepo from '../db/repositories/mediaItems';
import {
  CreateMediaItemSchema,
  UpdateMediaItemSchema,
  MediaItemFiltersSchema,
  MediaStatusSchema,
} from '../types';
import logger from '../utils/logger';

const router = Router();

// Validation middleware
function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.issues,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

function validateQuery<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: result.error.issues,
      });
      return;
    }
    req.query = result.data as any;
    next();
  };
}

// GET /api/media - Get all media items with pagination and filters
router.get('/', validateQuery(MediaItemFiltersSchema), (req: Request, res: Response) => {
  try {
    const filters = req.query as unknown as z.infer<typeof MediaItemFiltersSchema>;
    const result = mediaItemsRepo.getAll(filters);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Failed to get media items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve media items',
    });
  }
});

// GET /api/media/stats - Get media statistics
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = mediaItemsRepo.getStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to get media stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics',
    });
  }
});

// GET /api/media/flagged - Get flagged media items
router.get('/flagged', (_req: Request, res: Response) => {
  try {
    const items = mediaItemsRepo.getFlagged();
    res.json({
      success: true,
      data: items,
      total: items.length,
    });
  } catch (error) {
    logger.error('Failed to get flagged media:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve flagged media',
    });
  }
});

// GET /api/media/protected - Get protected media items
router.get('/protected', (_req: Request, res: Response) => {
  try {
    const items = mediaItemsRepo.getProtected();
    res.json({
      success: true,
      data: items,
      total: items.length,
    });
  } catch (error) {
    logger.error('Failed to get protected media:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve protected media',
    });
  }
});

// GET /api/media/pending - Get pending deletion items
router.get('/pending', (_req: Request, res: Response) => {
  try {
    const items = mediaItemsRepo.getPendingDeletion();
    res.json({
      success: true,
      data: items,
      total: items.length,
    });
  } catch (error) {
    logger.error('Failed to get pending deletion media:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve pending media',
    });
  }
});

// GET /api/media/:id - Get a specific media item
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid media item ID',
      });
      return;
    }

    const item = mediaItemsRepo.getById(id);
    if (!item) {
      res.status(404).json({
        success: false,
        error: `Media item not found: ${id}`,
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

// POST /api/media - Create a new media item
router.post('/', validateBody(CreateMediaItemSchema), (req: Request, res: Response) => {
  try {
    const item = mediaItemsRepo.create(req.body);
    res.status(201).json({
      success: true,
      data: item,
      message: 'Media item created successfully',
    });
  } catch (error) {
    logger.error('Failed to create media item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create media item',
    });
  }
});

// PUT /api/media/:id - Update a media item
router.put('/:id', validateBody(UpdateMediaItemSchema), (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid media item ID',
      });
      return;
    }

    const item = mediaItemsRepo.update(id, req.body);
    if (!item) {
      res.status(404).json({
        success: false,
        error: `Media item not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: item,
      message: 'Media item updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update media item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update media item',
    });
  }
});

// DELETE /api/media/:id - Delete a media item
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid media item ID',
      });
      return;
    }

    const deleted = mediaItemsRepo.delete(id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: `Media item not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Media item deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete media item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete media item',
    });
  }
});

// PATCH /api/media/:id/status - Update media item status
const UpdateStatusSchema = z.object({
  status: MediaStatusSchema,
});

router.patch('/:id/status', validateBody(UpdateStatusSchema), (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid media item ID',
      });
      return;
    }

    const item = mediaItemsRepo.updateStatus(id, req.body.status);
    if (!item) {
      res.status(404).json({
        success: false,
        error: `Media item not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: item,
      message: `Status updated to ${req.body.status}`,
    });
  } catch (error) {
    logger.error('Failed to update media status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update status',
    });
  }
});

// POST /api/media/:id/protect - Protect a media item from deletion
const ProtectSchema = z.object({
  reason: z.string().min(1),
});

router.post('/:id/protect', validateBody(ProtectSchema), (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid media item ID',
      });
      return;
    }

    const item = mediaItemsRepo.protect(id, req.body.reason);
    if (!item) {
      res.status(404).json({
        success: false,
        error: `Media item not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: item,
      message: 'Media item protected successfully',
    });
  } catch (error) {
    logger.error('Failed to protect media item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to protect media item',
    });
  }
});

// POST /api/media/:id/unprotect - Remove protection from a media item
router.post('/:id/unprotect', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid media item ID',
      });
      return;
    }

    const item = mediaItemsRepo.unprotect(id);
    if (!item) {
      res.status(404).json({
        success: false,
        error: `Media item not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: item,
      message: 'Media item protection removed',
    });
  } catch (error) {
    logger.error('Failed to unprotect media item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unprotect media item',
    });
  }
});

// POST /api/media/bulk/status - Bulk update media status
const BulkStatusSchema = z.object({
  ids: z.array(z.number()),
  status: MediaStatusSchema,
});

router.post('/bulk/status', validateBody(BulkStatusSchema), (req: Request, res: Response) => {
  try {
    const { ids, status } = req.body;
    const updated: number[] = [];
    const failed: number[] = [];

    for (const id of ids) {
      const item = mediaItemsRepo.updateStatus(id, status);
      if (item) {
        updated.push(id);
      } else {
        failed.push(id);
      }
    }

    res.json({
      success: true,
      data: { updated, failed },
      message: `${updated.length} item(s) updated, ${failed.length} failed`,
    });
  } catch (error) {
    logger.error('Failed to bulk update media status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk update status',
    });
  }
});

export default router;
