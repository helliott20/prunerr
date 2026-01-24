import { getDatabase } from '../index';
import type { Profile } from '../../types';
import logger from '../../utils/logger';

interface ProfileRow {
  id: number;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    ...row,
    is_active: Boolean(row.is_active),
  };
}

export function getAll(): Profile[] {
  const db = getDatabase();
  const stmt = db.prepare<[], ProfileRow>('SELECT * FROM profiles ORDER BY name');
  return stmt.all().map(rowToProfile);
}

export function getById(id: number): Profile | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], ProfileRow>('SELECT * FROM profiles WHERE id = ?');
  const row = stmt.get(id);
  return row ? rowToProfile(row) : null;
}

export function getByName(name: string): Profile | null {
  const db = getDatabase();
  const stmt = db.prepare<[string], ProfileRow>('SELECT * FROM profiles WHERE name = ?');
  const row = stmt.get(name);
  return row ? rowToProfile(row) : null;
}

export function getActive(): Profile | null {
  const db = getDatabase();
  const stmt = db.prepare<[], ProfileRow>('SELECT * FROM profiles WHERE is_active = 1 LIMIT 1');
  const row = stmt.get();
  return row ? rowToProfile(row) : null;
}

export interface CreateProfileInput {
  name: string;
  is_active?: boolean;
}

export function create(input: CreateProfileInput): Profile {
  const db = getDatabase();
  const now = new Date().toISOString();

  // If this profile should be active, deactivate all others first
  if (input.is_active) {
    db.prepare('UPDATE profiles SET is_active = 0, updated_at = ?').run(now);
  }

  const stmt = db.prepare(`
    INSERT INTO profiles (name, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(input.name, input.is_active ? 1 : 0, now, now);
  logger.debug(`Created profile: ${input.name} (ID: ${result.lastInsertRowid})`);

  const profile = getById(Number(result.lastInsertRowid));
  if (!profile) {
    throw new Error('Failed to retrieve profile after creation');
  }
  return profile;
}

export interface UpdateProfileInput {
  name?: string;
  is_active?: boolean;
}

export function update(id: number, input: UpdateProfileInput): Profile | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = getById(id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name);
  }

  if (input.is_active !== undefined) {
    // If activating this profile, deactivate all others first
    if (input.is_active) {
      db.prepare('UPDATE profiles SET is_active = 0, updated_at = ?').run(now);
    }
    updates.push('is_active = ?');
    params.push(input.is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  params.push(now);
  params.push(id);

  const stmt = db.prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...params);

  logger.debug(`Updated profile: ${id}`);
  return getById(id);
}

export function setActive(id: number): Profile | null {
  const db = getDatabase();
  const profile = getById(id);
  if (!profile) {
    return null;
  }

  const now = new Date().toISOString();

  // Deactivate all profiles
  db.prepare('UPDATE profiles SET is_active = 0, updated_at = ?').run(now);

  // Activate the selected profile
  db.prepare('UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);

  logger.debug(`Set active profile: ${id}`);
  return getById(id);
}

export function deleteById(id: number): boolean {
  const db = getDatabase();

  // Check if this is the active profile
  const profile = getById(id);
  if (profile?.is_active) {
    logger.warn(`Cannot delete active profile: ${id}`);
    return false;
  }

  const stmt = db.prepare('DELETE FROM profiles WHERE id = ?');
  const result = stmt.run(id);
  logger.debug(`Deleted profile: ${id}, affected: ${result.changes}`);
  return result.changes > 0;
}

export function getCount(): number {
  const db = getDatabase();
  const stmt = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM profiles');
  return stmt.get()?.count ?? 0;
}

export default {
  getAll,
  getById,
  getByName,
  getActive,
  create,
  update,
  setActive,
  delete: deleteById,
  getCount,
};
