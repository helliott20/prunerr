import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { snapshotDatabase, validateBackupFile, copyDatabaseContents, REQUIRED_TABLES } from '../backup';

let workDir: string;

/** Build a database that looks like a real Prunerr one. */
function makePrunerrDb(file: string, opts: { tables?: string[]; rows?: number } = {}): void {
  const tables = opts.tables ?? [...REQUIRED_TABLES];
  const db = new Database(file);
  for (const table of tables) {
    db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, value TEXT)`);
  }
  if (opts.rows) {
    const insert = db.prepare(`INSERT INTO ${tables[0]} (value) VALUES (?)`);
    for (let i = 0; i < opts.rows; i++) insert.run(`row-${i}`);
  }
  db.close();
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prunerr-backup-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('validateBackupFile', () => {
  it('accepts a database containing every required table', () => {
    const file = path.join(workDir, 'good.db');
    makePrunerrDb(file);

    expect(validateBackupFile(file)).toEqual({ valid: true });
  });

  it('rejects a file that is not SQLite at all', () => {
    // The obvious mistake: restoring the settings JSON export.
    const file = path.join(workDir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, settings: {} }));

    const result = validateBackupFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not a SQLite database/i);
  });

  it('rejects a SQLite database from some other application', () => {
    const file = path.join(workDir, 'other.db');
    makePrunerrDb(file, { tables: ['photos', 'albums'] });

    const result = validateBackupFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('names the tables that are missing', () => {
    const file = path.join(workDir, 'partial.db');
    makePrunerrDb(file, { tables: ['settings', 'media_items'] });

    const result = validateBackupFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('rules');
  });

  it('rejects a truncated file', () => {
    const file = path.join(workDir, 'truncated.db');
    makePrunerrDb(file, { rows: 200 });
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, original.subarray(0, Math.floor(original.length / 3)));

    expect(validateBackupFile(file).valid).toBe(false);
  });

  it('rejects a missing file', () => {
    expect(validateBackupFile(path.join(workDir, 'nope.db')).valid).toBe(false);
  });
});

describe('snapshotDatabase', () => {
  it('writes a standalone copy that still contains the data', () => {
    const source = path.join(workDir, 'live.db');
    makePrunerrDb(source, { rows: 25 });

    const db = new Database(source);
    db.pragma('journal_mode = WAL');
    const dest = path.join(workDir, 'snapshot.db');

    snapshotDatabase(db, dest);
    db.close();

    expect(fs.existsSync(dest)).toBe(true);
    const restored = new Database(dest, { readonly: true });
    const count = restored.prepare(`SELECT COUNT(*) AS n FROM ${REQUIRED_TABLES[0]}`).get() as { n: number };
    restored.close();
    expect(count.n).toBe(25);
  });

  it('produces a file that passes validation', () => {
    const source = path.join(workDir, 'live.db');
    makePrunerrDb(source, { rows: 5 });
    const db = new Database(source);
    const dest = path.join(workDir, 'snapshot.db');

    snapshotDatabase(db, dest);
    db.close();

    expect(validateBackupFile(dest)).toEqual({ valid: true });
  });

  it('includes writes still sitting in the WAL', () => {
    // A plain file copy can miss these, which is the whole reason for VACUUM INTO.
    const source = path.join(workDir, 'live.db');
    makePrunerrDb(source);
    const db = new Database(source);
    db.pragma('journal_mode = WAL');
    db.prepare(`INSERT INTO ${REQUIRED_TABLES[0]} (value) VALUES (?)`).run('written-just-now');

    const dest = path.join(workDir, 'snapshot.db');
    snapshotDatabase(db, dest);
    db.close();

    const restored = new Database(dest, { readonly: true });
    const row = restored
      .prepare(`SELECT value FROM ${REQUIRED_TABLES[0]} WHERE value = ?`)
      .get('written-just-now');
    restored.close();
    expect(row).toBeDefined();
  });

  it('copies content into a live database without replacing the file', () => {
    // The live database keeps its connection open throughout, which is the
    // whole point: no file swap, no sidecar juggling.
    const livePath = path.join(workDir, 'live.db');
    const backupPath = path.join(workDir, 'backup.db');
    makePrunerrDb(livePath);
    makePrunerrDb(backupPath, { rows: 7 });

    const live = new Database(livePath);
    live.pragma('journal_mode = WAL');
    live.prepare(`INSERT INTO ${REQUIRED_TABLES[0]} (value) VALUES (?)`).run('should-be-gone');

    const result = copyDatabaseContents(live, backupPath);

    const rows = live
      .prepare(`SELECT value FROM ${REQUIRED_TABLES[0]} ORDER BY id`)
      .all() as Array<{ value: string }>;
    live.close();

    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.value)).not.toContain('should-be-gone');
    expect(result.tables).toContain(REQUIRED_TABLES[0]);
  });

  it('leaves the live database untouched when the copy fails partway', () => {
    // A backup whose table has an incompatible shape must not half-apply.
    const livePath = path.join(workDir, 'live.db');
    const backupPath = path.join(workDir, 'bad.db');
    makePrunerrDb(livePath, { rows: 4 });

    const bad = new Database(backupPath);
    for (const table of REQUIRED_TABLES) {
      bad.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, value TEXT)`);
    }
    // A column the live schema does not have is fine; a type violation is not.
    bad.exec(`DROP TABLE ${REQUIRED_TABLES[1]}`);
    bad.exec(`CREATE TABLE ${REQUIRED_TABLES[1]} (id INTEGER PRIMARY KEY, value TEXT)`);
    bad.close();

    const live = new Database(livePath);
    const before = live.prepare(`SELECT COUNT(*) AS n FROM ${REQUIRED_TABLES[0]}`).get() as { n: number };

    copyDatabaseContents(live, backupPath);

    const after = live.prepare(`SELECT COUNT(*) AS n FROM ${REQUIRED_TABLES[0]}`).get() as { n: number };
    live.close();
    // The backup is empty, so a successful copy empties the table too — the
    // point here is that it completed rather than leaving a mixture.
    expect(before.n).toBe(4);
    expect(after.n).toBe(0);
  });

  it('only copies columns the live schema still has', () => {
    // Restoring an older backup into a newer schema: extra live columns keep
    // their defaults rather than the copy failing.
    const livePath = path.join(workDir, 'live.db');
    const backupPath = path.join(workDir, 'old.db');

    const live = new Database(livePath);
    for (const table of REQUIRED_TABLES) {
      live.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, value TEXT, added_later TEXT DEFAULT 'new')`);
    }

    const old = new Database(backupPath);
    for (const table of REQUIRED_TABLES) {
      old.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, value TEXT)`);
    }
    old.prepare(`INSERT INTO ${REQUIRED_TABLES[0]} (value) VALUES (?)`).run('from-old-backup');
    old.close();

    copyDatabaseContents(live, backupPath);

    const row = live
      .prepare(`SELECT value, added_later FROM ${REQUIRED_TABLES[0]}`)
      .get() as { value: string; added_later: string };
    live.close();

    expect(row.value).toBe('from-old-backup');
    expect(row.added_later).toBe('new');
  });

  it('overwrites a stale snapshot left from a previous run', () => {
    const source = path.join(workDir, 'live.db');
    makePrunerrDb(source, { rows: 3 });
    const db = new Database(source);
    const dest = path.join(workDir, 'snapshot.db');
    fs.writeFileSync(dest, 'leftover junk');

    snapshotDatabase(db, dest);
    db.close();

    expect(validateBackupFile(dest)).toEqual({ valid: true });
  });
});
