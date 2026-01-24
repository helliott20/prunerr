import { getDatabase } from '../index';
import type { Setting, SettingInput } from '../../types';
import logger from '../../utils/logger';

interface SettingRow {
  id: number;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export function getAllSettings(): Setting[] {
  const db = getDatabase();
  const stmt = db.prepare<[], SettingRow>('SELECT * FROM settings ORDER BY key');
  return stmt.all();
}

export function getSettingByKey(key: string): Setting | null {
  const db = getDatabase();
  const stmt = db.prepare<[string], SettingRow>('SELECT * FROM settings WHERE key = ?');
  const result = stmt.get(key);
  return result ?? null;
}

export function getSettingValue(key: string, defaultValue?: string): string | null {
  const setting = getSettingByKey(key);
  if (setting) {
    return setting.value;
  }
  return defaultValue ?? null;
}

export function setSetting(input: SettingInput): Setting {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existingSetting = getSettingByKey(input.key);

  if (existingSetting) {
    // Update existing setting
    const updateStmt = db.prepare<[string, string, string]>(
      'UPDATE settings SET value = ?, updated_at = ? WHERE key = ?'
    );
    updateStmt.run(input.value, now, input.key);
    logger.debug(`Updated setting: ${input.key}`);
  } else {
    // Insert new setting
    const insertStmt = db.prepare<[string, string, string, string]>(
      'INSERT INTO settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)'
    );
    insertStmt.run(input.key, input.value, now, now);
    logger.debug(`Created setting: ${input.key}`);
  }

  const result = getSettingByKey(input.key);
  if (!result) {
    throw new Error(`Failed to retrieve setting after upsert: ${input.key}`);
  }
  return result;
}

export function deleteSetting(key: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare<[string]>('DELETE FROM settings WHERE key = ?');
  const result = stmt.run(key);
  logger.debug(`Deleted setting: ${key}, affected: ${result.changes}`);
  return result.changes > 0;
}

export function setMultipleSettings(settings: SettingInput[]): Setting[] {
  const db = getDatabase();
  const results: Setting[] = [];

  const transaction = db.transaction(() => {
    for (const setting of settings) {
      const result = setSetting(setting);
      results.push(result);
    }
  });

  transaction();
  return results;
}

export function getSettingsStartingWith(prefix: string): Setting[] {
  const db = getDatabase();
  const stmt = db.prepare<[string], SettingRow>(
    'SELECT * FROM settings WHERE key LIKE ? ORDER BY key'
  );
  return stmt.all(`${prefix}%`);
}

// Helper functions for typed settings
export function getBooleanSetting(key: string, defaultValue: boolean = false): boolean {
  const value = getSettingValue(key);
  if (value === null) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

export function getNumberSetting(key: string, defaultValue: number = 0): number {
  const value = getSettingValue(key);
  if (value === null) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function getJsonSetting<T>(key: string, defaultValue: T): T {
  const value = getSettingValue(key);
  if (value === null) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    logger.warn(`Failed to parse JSON setting: ${key}`);
    return defaultValue;
  }
}

export function setJsonSetting<T>(key: string, value: T): Setting {
  return setSetting({ key, value: JSON.stringify(value) });
}

export default {
  getAll: getAllSettings,
  getByKey: getSettingByKey,
  getValue: getSettingValue,
  set: setSetting,
  delete: deleteSetting,
  setMultiple: setMultipleSettings,
  getStartingWith: getSettingsStartingWith,
  getBoolean: getBooleanSetting,
  getNumber: getNumberSetting,
  getJson: getJsonSetting,
  setJson: setJsonSetting,
};
