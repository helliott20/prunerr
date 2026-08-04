import logger from '../utils/logger';
import plexUsersRepo, { type PlexUser } from '../db/repositories/plexUsers';
import type { MediaServerUser, MediaServerUsersService } from './mediaServer/types';

/**
 * Persist a media server's accounts into the local users table (full replace).
 *
 * The table is still named `plex_users` for historical reasons; its
 * `plex_user_id` column is TEXT, so Jellyfin/Emby GUID account ids store
 * cleanly alongside Plex's numeric ones. Everything downstream matches on
 * `username`, which is backend-neutral.
 */
export async function syncMediaServerUsers(
  provider: MediaServerUsersService,
  label = 'media server'
): Promise<PlexUser[]> {
  logger.info(`Starting ${label} users sync`);

  const users = await provider.fetchUsers();
  if (users.length === 0) {
    logger.warn(`No ${label} users returned from sync`);
    return [];
  }

  const synced = plexUsersRepo.replace(
    users.map((user) => ({
      plex_user_id: user.id,
      username: user.username,
      email: user.email ?? null,
      thumb_url: user.thumbUrl ?? null,
      is_home_user: user.isHomeUser ? 1 : 0,
      is_owner: user.isOwner ? 1 : 0,
    }))
  );

  logger.info(`${label} users sync completed: ${synced.length} users`);
  return synced;
}

/** Normalise a stored row back into the provider-neutral shape. */
export function toMediaServerUser(row: PlexUser): MediaServerUser {
  return {
    id: row.plex_user_id,
    username: row.username,
    email: row.email,
    thumbUrl: row.thumb_url,
    isOwner: row.is_owner === 1,
    isHomeUser: row.is_home_user === 1,
  };
}
