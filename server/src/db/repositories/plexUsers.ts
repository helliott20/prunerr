import { getDatabase } from '../index';
import logger from '../../utils/logger';

export interface PlexUser {
  id: number;
  plex_user_id: string;
  username: string;
  email: string | null;
  thumb_url: string | null;
  is_home_user: number;
  is_owner: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlexUserInput {
  plex_user_id: string;
  username: string;
  email?: string | null;
  thumb_url?: string | null;
  is_home_user?: number;
  is_owner?: number;
}

export function findAll(): PlexUser[] {
  const db = getDatabase();
  const stmt = db.prepare<[], PlexUser>(
    'SELECT * FROM plex_users ORDER BY is_owner DESC, username ASC'
  );
  return stmt.all();
}

export function findById(id: number): PlexUser | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], PlexUser>('SELECT * FROM plex_users WHERE id = ?');
  return stmt.get(id) ?? null;
}

export function findByUsername(username: string): PlexUser | null {
  const db = getDatabase();
  const stmt = db.prepare<[string], PlexUser>('SELECT * FROM plex_users WHERE username = ?');
  return stmt.get(username) ?? null;
}

export function findByPlexUserId(plexUserId: string): PlexUser | null {
  const db = getDatabase();
  const stmt = db.prepare<[string], PlexUser>('SELECT * FROM plex_users WHERE plex_user_id = ?');
  return stmt.get(plexUserId) ?? null;
}

export function upsert(input: PlexUserInput): PlexUser {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO plex_users (plex_user_id, username, email, thumb_url, is_home_user, is_owner, last_synced_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plex_user_id) DO UPDATE SET
      username = excluded.username,
      email = excluded.email,
      thumb_url = excluded.thumb_url,
      is_home_user = excluded.is_home_user,
      is_owner = excluded.is_owner,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    input.plex_user_id,
    input.username,
    input.email ?? null,
    input.thumb_url ?? null,
    input.is_home_user ?? 0,
    input.is_owner ?? 0,
    now,
    now
  );

  const user = findByPlexUserId(input.plex_user_id);
  if (!user) {
    throw new Error(`Failed to upsert plex user: ${input.plex_user_id}`);
  }
  return user;
}

/**
 * Full-replace sync: upsert all given users, then remove rows not present in the input.
 * Runs in a transaction for atomicity.
 */
export function replace(users: PlexUserInput[]): PlexUser[] {
  const db = getDatabase();
  const now = new Date().toISOString();

  const upsertStmt = db.prepare(`
    INSERT INTO plex_users (plex_user_id, username, email, thumb_url, is_home_user, is_owner, last_synced_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plex_user_id) DO UPDATE SET
      username = excluded.username,
      email = excluded.email,
      thumb_url = excluded.thumb_url,
      is_home_user = excluded.is_home_user,
      is_owner = excluded.is_owner,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
  `);

  const deleteStaleStmt = db.prepare('DELETE FROM plex_users WHERE last_synced_at IS NULL OR last_synced_at != ?');

  const txn = db.transaction((items: PlexUserInput[]) => {
    for (const user of items) {
      upsertStmt.run(
        user.plex_user_id,
        user.username,
        user.email ?? null,
        user.thumb_url ?? null,
        user.is_home_user ?? 0,
        user.is_owner ?? 0,
        now,
        now
      );
    }
    // Remove any users that weren't touched this sync
    deleteStaleStmt.run(now);
  });

  txn(users);
  logger.info(`Replaced plex_users table with ${users.length} users`);
  return findAll();
}

export default {
  findAll,
  findById,
  findByUsername,
  findByPlexUserId,
  upsert,
  replace,
};
