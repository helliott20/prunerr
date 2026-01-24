import { getDatabase } from '../index';
import type {
  Rule,
  CreateRuleInput,
  UpdateRuleInput,
  RuleCondition,
  Profile,
  DeletionHistory,
  ScanHistory,
  MediaType,
  DeletionType,
  ScanStatus,
  RuleType,
  RuleAction,
} from '../../types';
import logger from '../../utils/logger';

// ============================================================================
// Rules Repository
// ============================================================================

interface RuleRow {
  id: number;
  name: string;
  profile_id: number | null;
  type: string;
  conditions: string;
  action: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToRule(row: RuleRow): Rule {
  return {
    ...row,
    type: row.type as RuleType,
    action: row.action as RuleAction,
    enabled: Boolean(row.enabled),
  };
}

export function getAllRules(): Rule[] {
  const db = getDatabase();
  const stmt = db.prepare<[], RuleRow>('SELECT * FROM rules ORDER BY name');
  return stmt.all().map(rowToRule);
}

export function getEnabledRules(): Rule[] {
  const db = getDatabase();
  const stmt = db.prepare<[], RuleRow>('SELECT * FROM rules WHERE enabled = 1 ORDER BY name');
  return stmt.all().map(rowToRule);
}

export function getRuleById(id: number): Rule | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], RuleRow>('SELECT * FROM rules WHERE id = ?');
  const row = stmt.get(id);
  return row ? rowToRule(row) : null;
}

export function getRulesByProfileId(profileId: number): Rule[] {
  const db = getDatabase();
  const stmt = db.prepare<[number], RuleRow>(
    'SELECT * FROM rules WHERE profile_id = ? ORDER BY name'
  );
  return stmt.all(profileId).map(rowToRule);
}

export function createRule(input: CreateRuleInput): Rule {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO rules (name, profile_id, type, conditions, action, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.name,
    input.profile_id ?? null,
    input.type,
    JSON.stringify(input.conditions),
    input.action,
    input.enabled !== false ? 1 : 0,
    now,
    now
  );

  logger.debug(`Created rule: ${input.name} (ID: ${result.lastInsertRowid})`);

  const rule = getRuleById(Number(result.lastInsertRowid));
  if (!rule) {
    throw new Error('Failed to retrieve rule after creation');
  }
  return rule;
}

export function updateRule(id: number, input: UpdateRuleInput): Rule | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = getRuleById(id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name);
  }
  if (input.profile_id !== undefined) {
    updates.push('profile_id = ?');
    params.push(input.profile_id);
  }
  if (input.type !== undefined) {
    updates.push('type = ?');
    params.push(input.type);
  }
  if (input.conditions !== undefined) {
    updates.push('conditions = ?');
    params.push(JSON.stringify(input.conditions));
  }
  if (input.action !== undefined) {
    updates.push('action = ?');
    params.push(input.action);
  }
  if (input.enabled !== undefined) {
    updates.push('enabled = ?');
    params.push(input.enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  params.push(now);
  params.push(id);

  const stmt = db.prepare(`UPDATE rules SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...params);

  logger.debug(`Updated rule: ${id}`);
  return getRuleById(id);
}

export function deleteRule(id: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM rules WHERE id = ?');
  const result = stmt.run(id);
  logger.debug(`Deleted rule: ${id}, affected: ${result.changes}`);
  return result.changes > 0;
}

export function toggleRuleEnabled(id: number): Rule | null {
  const existing = getRuleById(id);
  if (!existing) {
    return null;
  }
  return updateRule(id, { enabled: !existing.enabled });
}

export function getRuleConditions(id: number): RuleCondition[] {
  const rule = getRuleById(id);
  if (!rule) {
    return [];
  }
  try {
    return JSON.parse(rule.conditions) as RuleCondition[];
  } catch {
    logger.warn(`Failed to parse conditions for rule ${id}`);
    return [];
  }
}

// ============================================================================
// Profiles Repository
// ============================================================================

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

export function getAllProfiles(): Profile[] {
  const db = getDatabase();
  const stmt = db.prepare<[], ProfileRow>('SELECT * FROM profiles ORDER BY name');
  return stmt.all().map(rowToProfile);
}

export function getProfileById(id: number): Profile | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], ProfileRow>('SELECT * FROM profiles WHERE id = ?');
  const row = stmt.get(id);
  return row ? rowToProfile(row) : null;
}

export function getActiveProfile(): Profile | null {
  const db = getDatabase();
  const stmt = db.prepare<[], ProfileRow>('SELECT * FROM profiles WHERE is_active = 1 LIMIT 1');
  const row = stmt.get();
  return row ? rowToProfile(row) : null;
}

export function createProfile(name: string): Profile {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO profiles (name, is_active, created_at, updated_at)
    VALUES (?, 0, ?, ?)
  `);

  const result = stmt.run(name, now, now);
  logger.debug(`Created profile: ${name} (ID: ${result.lastInsertRowid})`);

  const profile = getProfileById(Number(result.lastInsertRowid));
  if (!profile) {
    throw new Error('Failed to retrieve profile after creation');
  }
  return profile;
}

export function setActiveProfile(id: number): Profile | null {
  const db = getDatabase();
  const profile = getProfileById(id);
  if (!profile) {
    return null;
  }

  const now = new Date().toISOString();

  // Deactivate all profiles
  db.prepare('UPDATE profiles SET is_active = 0, updated_at = ?').run(now);

  // Activate the selected profile
  db.prepare('UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);

  logger.debug(`Set active profile: ${id}`);
  return getProfileById(id);
}

export function deleteProfile(id: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM profiles WHERE id = ?');
  const result = stmt.run(id);
  logger.debug(`Deleted profile: ${id}, affected: ${result.changes}`);
  return result.changes > 0;
}

// ============================================================================
// Deletion History Repository
// ============================================================================

interface DeletionHistoryRow {
  id: number;
  media_item_id: number | null;
  title: string;
  type: string;
  file_size: number | null;
  deleted_at: string;
  deletion_type: string;
  deleted_by_rule_id: number | null;
}

function rowToDeletionHistory(row: DeletionHistoryRow): DeletionHistory {
  return {
    ...row,
    type: row.type as MediaType,
    deletion_type: row.deletion_type as DeletionType,
  };
}

export function getDeletionHistory(limit: number = 100, offset: number = 0): DeletionHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[number, number], DeletionHistoryRow>(
    'SELECT * FROM deletion_history ORDER BY deleted_at DESC LIMIT ? OFFSET ?'
  );
  return stmt.all(limit, offset).map(rowToDeletionHistory);
}

export function addDeletionHistory(
  mediaItemId: number | null,
  title: string,
  type: MediaType,
  fileSize: number | null,
  deletionType: DeletionType,
  ruleId?: number
): DeletionHistory {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO deletion_history (media_item_id, title, type, file_size, deleted_at, deletion_type, deleted_by_rule_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(mediaItemId, title, type, fileSize, now, deletionType, ruleId ?? null);
  logger.debug(`Added deletion history for: ${title}`);

  const historyStmt = db.prepare<[number], DeletionHistoryRow>(
    'SELECT * FROM deletion_history WHERE id = ?'
  );
  const row = historyStmt.get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to retrieve deletion history after creation');
  }
  return rowToDeletionHistory(row);
}

export function getDeletionStats(): { totalDeleted: number; totalSizeReclaimed: number; deletionsByType: Record<string, number> } {
  const db = getDatabase();

  const totalStmt = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM deletion_history');
  const totalDeleted = totalStmt.get()?.count ?? 0;

  const sizeStmt = db.prepare<[], { total_size: number | null }>(
    'SELECT SUM(file_size) as total_size FROM deletion_history'
  );
  const totalSizeReclaimed = sizeStmt.get()?.total_size ?? 0;

  const byTypeStmt = db.prepare<[], { type: string; count: number }>(
    'SELECT type, COUNT(*) as count FROM deletion_history GROUP BY type'
  );
  const byTypeRows = byTypeStmt.all();
  const deletionsByType: Record<string, number> = {};
  for (const row of byTypeRows) {
    deletionsByType[row.type] = row.count;
  }

  return { totalDeleted, totalSizeReclaimed, deletionsByType };
}

// ============================================================================
// Scan History Repository
// ============================================================================

interface ScanHistoryRow {
  id: number;
  started_at: string;
  completed_at: string | null;
  items_scanned: number;
  items_flagged: number;
  status: string;
}

function rowToScanHistory(row: ScanHistoryRow): ScanHistory {
  return {
    ...row,
    status: row.status as ScanStatus,
  };
}

export function getScanHistory(limit: number = 50): ScanHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[number], ScanHistoryRow>(
    'SELECT * FROM scan_history ORDER BY started_at DESC LIMIT ?'
  );
  return stmt.all(limit).map(rowToScanHistory);
}

export function getLatestScan(): ScanHistory | null {
  const db = getDatabase();
  const stmt = db.prepare<[], ScanHistoryRow>(
    'SELECT * FROM scan_history ORDER BY started_at DESC LIMIT 1'
  );
  const row = stmt.get();
  return row ? rowToScanHistory(row) : null;
}

export function startScan(): ScanHistory {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO scan_history (started_at, status)
    VALUES (?, 'running')
  `);

  const result = stmt.run(now);
  logger.debug(`Started scan (ID: ${result.lastInsertRowid})`);

  const scanStmt = db.prepare<[number], ScanHistoryRow>('SELECT * FROM scan_history WHERE id = ?');
  const row = scanStmt.get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to retrieve scan history after creation');
  }
  return rowToScanHistory(row);
}

export function completeScan(id: number, itemsScanned: number, itemsFlagged: number): ScanHistory | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE scan_history
    SET completed_at = ?, items_scanned = ?, items_flagged = ?, status = 'completed'
    WHERE id = ?
  `);

  stmt.run(now, itemsScanned, itemsFlagged, id);
  logger.debug(`Completed scan ${id}: scanned=${itemsScanned}, flagged=${itemsFlagged}`);

  const scanStmt = db.prepare<[number], ScanHistoryRow>('SELECT * FROM scan_history WHERE id = ?');
  const row = scanStmt.get(id);
  return row ? rowToScanHistory(row) : null;
}

export function failScan(id: number): ScanHistory | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE scan_history
    SET completed_at = ?, status = 'failed'
    WHERE id = ?
  `);

  stmt.run(now, id);
  logger.warn(`Scan ${id} failed`);

  const scanStmt = db.prepare<[number], ScanHistoryRow>('SELECT * FROM scan_history WHERE id = ?');
  const row = scanStmt.get(id);
  return row ? rowToScanHistory(row) : null;
}

export function getRunningScan(): ScanHistory | null {
  const db = getDatabase();
  const stmt = db.prepare<[], ScanHistoryRow>(
    "SELECT * FROM scan_history WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
  );
  const row = stmt.get();
  return row ? rowToScanHistory(row) : null;
}

export default {
  // Rules
  rules: {
    getAll: getAllRules,
    getEnabled: getEnabledRules,
    getById: getRuleById,
    getByProfileId: getRulesByProfileId,
    create: createRule,
    update: updateRule,
    delete: deleteRule,
    toggle: toggleRuleEnabled,
    getConditions: getRuleConditions,
  },
  // Profiles
  profiles: {
    getAll: getAllProfiles,
    getById: getProfileById,
    getActive: getActiveProfile,
    create: createProfile,
    setActive: setActiveProfile,
    delete: deleteProfile,
  },
  // Deletion History
  deletionHistory: {
    getAll: getDeletionHistory,
    add: addDeletionHistory,
    getStats: getDeletionStats,
  },
  // Scan History
  scanHistory: {
    getAll: getScanHistory,
    getLatest: getLatestScan,
    start: startScan,
    complete: completeScan,
    fail: failScan,
    getRunning: getRunningScan,
  },
};
