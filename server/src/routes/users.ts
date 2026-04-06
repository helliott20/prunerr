import { Router, Request, Response } from 'express';
import plexUsersRepo, { type PlexUser } from '../db/repositories/plexUsers';
import settingsRepo from '../db/repositories/settings';
import { PlexUsersService } from '../services/plexUsers';
import logger from '../utils/logger';

const router = Router();

interface PlexUserResponse {
  id: number;
  plexUserId: string;
  username: string;
  email: string | null;
  thumbUrl: string | null;
  isHomeUser: boolean;
  isOwner: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toResponse(user: PlexUser): PlexUserResponse {
  return {
    id: user.id,
    plexUserId: user.plex_user_id,
    username: user.username,
    email: user.email,
    thumbUrl: user.thumb_url,
    isHomeUser: user.is_home_user === 1,
    isOwner: user.is_owner === 1,
    lastSyncedAt: user.last_synced_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

// GET /api/users - List all known Plex users
router.get('/', (_req: Request, res: Response) => {
  try {
    const users = plexUsersRepo.findAll();
    res.json({
      success: true,
      data: users.map(toResponse),
    });
  } catch (error) {
    logger.error('Failed to list Plex users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list Plex users',
    });
  }
});

// POST /api/users/sync - Sync users from Plex
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const plexUrl = settingsRepo.getValue('plex_url');
    const plexToken = settingsRepo.getValue('plex_token');

    if (!plexUrl || !plexToken) {
      res.status(400).json({
        success: false,
        error: 'Plex is not configured',
      });
      return;
    }

    const service = new PlexUsersService(plexUrl, plexToken);
    const users = await service.syncUsers();

    res.json({
      success: true,
      data: users.map(toResponse),
      message: `Synced ${users.length} Plex user(s)`,
    });
  } catch (error) {
    logger.error('Failed to sync Plex users:', error);
    res.status(500).json({
      success: false,
      error: `Failed to sync Plex users: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
  }
});

export default router;
