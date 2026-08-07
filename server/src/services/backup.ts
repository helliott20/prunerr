import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from '../config';
import logger from '../utils/logger';
import { getDatabase } from '../db';
import { refreshServices } from './init';

/**
 * Full-database backup and restore.
 *
 * The settings export covers only the `settings` table, which leaves out the
 * library, rules, queue and history — everything that actually takes time to
 * rebuild. These helpers move the whole database instead.
 */

/**
 * The 16-byte header every SQLite file starts with: "SQLite format 3"
 * followed by a NUL. Built by concatenation rather than written as a string
 * escape, so this source file stays plain ASCII.
 */
const SQLITE_MAGIC = Buffer.concat([Buffer.from('SQLite format 3', 'latin1'), Buffer.from([0])]);

/**
 * Tables a file must have to be a plausible Prunerr backup. Deliberately a
 * core subset rather than the full list, so a backup taken before a later
 * migration added a table still restores (migrations run afterwards).
 */
export const REQUIRED_TABLES = [
  'settings',
  'media_items',
  'rules',
  'deletion_history',
] as const;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Write a consistent standalone copy of an open database.
 *
 * VACUUM INTO rather than a file copy: the live database runs in WAL mode, so
 * recent commits can still be sitting in the -wal sidecar and a plain copy of
 * the .db would silently lose them.
 */
export function snapshotDatabase(db: Database.Database, destination: string): void {
  // VACUUM INTO refuses to overwrite, so clear any stale file first.
  if (fs.existsSync(destination)) {
    fs.rmSync(destination);
  }

  const dir = path.dirname(destination);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db.prepare('VACUUM INTO ?').run(destination);
}

/** Snapshot the running database to `destination`. */
export function createBackup(destination: string): void {
  snapshotDatabase(getDatabase(), destination);
}

/**
 * Check that a file is a SQLite database that looks like Prunerr's, before it
 * is allowed anywhere near the live one.
 */
export function validateBackupFile(filePath: string): ValidationResult {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: 'Backup file not found' };
  }

  const { size } = fs.statSync(filePath);
  if (size < SQLITE_MAGIC.length) {
    return { valid: false, error: 'File is not a SQLite database' };
  }

  const header = Buffer.alloc(SQLITE_MAGIC.length);
  const handle = fs.openSync(filePath, 'r');
  try {
    fs.readSync(handle, header, 0, SQLITE_MAGIC.length, 0);
  } finally {
    fs.closeSync(handle);
  }

  if (!header.equals(SQLITE_MAGIC)) {
    return {
      valid: false,
      error:
        'File is not a SQLite database. Note this is not the settings JSON export — it must be a full backup.',
    };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });

    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      return { valid: false, error: `Backup failed its integrity check: ${String(integrity)}` };
    }

    const present = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name)
    );

    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Backup is missing expected tables: ${missing.join(', ')}. It does not look like a Prunerr backup.`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Backup could not be read',
    };
  } finally {
    db?.close();
  }
}

export interface RestoreResult {
  /** Where the pre-restore copy of the previous database was kept. */
  previousDatabasePath: string;
}

export interface CopyResult {
  tables: string[];
  rows: number;
}

/**
 * Replace the contents of `db` with the contents of the backup at
 * `backupPath`, in a single transaction.
 *
 * This attaches the backup and copies table by table rather than swapping the
 * database file. Swapping means closing the connection and deleting the -wal
 * and -shm sidecars, which the OS may still hold open — on Windows that fails
 * outright, and a stale sidecar against a fresh database risks corruption.
 * Copying keeps one connection open the whole time and, being a transaction,
 * either fully applies or leaves the database exactly as it was.
 */
export function copyDatabaseContents(db: Database.Database, backupPath: string): CopyResult {
  const columnsOf = (schema: string, table: string): string[] =>
    (db.pragma(`${schema}.table_info(${JSON.stringify(table)})`) as Array<{ name: string }>).map(
      (column) => column.name
    );

  db.prepare('ATTACH DATABASE ? AS backup').run(backupPath);

  try {
    const backupTables = (
      db
        .prepare(
          "SELECT name FROM backup.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    const liveTables = new Set(
      (
        db
          .prepare(
            "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name)
    );

    const shared = backupTables.filter((table) => liveTables.has(table));
    const copied: string[] = [];
    let rows = 0;

    const apply = db.transaction(() => {
      // Foreign keys are enforced per-row, and the copy order is not
      // dependency-ordered; the whole thing is one transaction, so integrity is
      // still guaranteed at commit.
      for (const table of shared) {
        const liveColumns = new Set(columnsOf('main', table));
        // Only columns both sides have: an older backup lacks columns a later
        // migration added, and those keep their defaults.
        const columns = columnsOf('backup', table).filter((column) => liveColumns.has(column));
        if (columns.length === 0) continue;

        const list = columns.map((column) => `"${column}"`).join(', ');
        db.prepare(`DELETE FROM main."${table}"`).run();
        const result = db
          .prepare(`INSERT INTO main."${table}" (${list}) SELECT ${list} FROM backup."${table}"`)
          .run();

        rows += result.changes;
        copied.push(table);
      }
    });

    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    db.pragma('foreign_keys = OFF');
    try {
      apply();
    } finally {
      db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }

    const skipped = backupTables.filter((table) => !liveTables.has(table));
    if (skipped.length > 0) {
      logger.warn(`Backup contained tables this build does not have, skipped: ${skipped.join(', ')}`);
    }

    return { tables: copied, rows };
  } finally {
    db.prepare('DETACH DATABASE backup').run();
  }
}

/**
 * Replace the live database with an uploaded backup.
 *
 * The previous database is snapshotted first and left on disk, so a restore of
 * the wrong file is recoverable. Migrations run afterwards, which is what lets
 * an older backup be restored into a newer build.
 */
export function restoreFromFile(uploadedPath: string): RestoreResult {
  const validation = validateBackupFile(uploadedPath);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Backup file is not valid');
  }

  const dbPath = path.resolve(config.dbPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const previousDatabasePath = path.join(path.dirname(dbPath), `prunerr.pre-restore-${stamp}.db`);

  logger.info(`Restoring database from backup; keeping previous database at ${previousDatabasePath}`);

  // Snapshot the current database before touching anything, so a restore of
  // the wrong file is recoverable from the data folder.
  const live = getDatabase();
  snapshotDatabase(live, previousDatabasePath);

  const { tables, rows } = copyDatabaseContents(live, uploadedPath);

  // Cached service clients were built from the old settings rows.
  refreshServices();

  logger.info(`Database restore complete: ${rows} rows across ${tables.length} tables`);

  return { previousDatabasePath };
}
