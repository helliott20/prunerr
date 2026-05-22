import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from '../config';
import logger from '../utils/logger';
import { decodeHtmlEntities } from '../utils/text';
import { runMigrations } from './schema';

let db: Database.Database | null = null;

export function initializeDatabase(): Database.Database {
  if (db) {
    return db;
  }

  // Ensure the data directory exists
  const dbPath = path.resolve(config.dbPath);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    logger.info(`Creating database directory: ${dbDir}`);
    fs.mkdirSync(dbDir, { recursive: true });
  }

  logger.info(`Initializing SQLite database at: ${dbPath}`);

  try {
    db = new Database(dbPath, {
      verbose: config.nodeEnv === 'development' ? (message) => logger.debug(message as string) : undefined,
    });

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Enable WAL mode for better concurrent access
    db.pragma('journal_mode = WAL');

    // Run migrations
    runMigrations(db);

    // One-time fix for titles stored with HTML entities still encoded
    // (e.g. `&#34;Wuthering Heights&#34;`). The ingestion path now decodes
    // these, so this only touches pre-existing rows.
    backfillEncodedTitles(db);

    logger.info('Database initialized successfully');

    return db;
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

function backfillEncodedTitles(database: Database.Database): void {
  const rows = database
    .prepare<[], { id: number; title: string }>(
      "SELECT id, title FROM media_items WHERE title LIKE '%&#%' OR title LIKE '%&amp;%' OR title LIKE '%&quot;%' OR title LIKE '%&apos;%'"
    )
    .all();

  if (rows.length === 0) return;

  const update = database.prepare<[string, number]>('UPDATE media_items SET title = ? WHERE id = ?');
  let fixed = 0;
  const tx = database.transaction(() => {
    for (const row of rows) {
      const decoded = decodeHtmlEntities(row.title);
      if (decoded !== row.title) {
        update.run(decoded, row.id);
        fixed++;
      }
    }
  });
  tx();

  if (fixed > 0) {
    logger.info(`Backfilled ${fixed} media item title(s) with decoded HTML entities`);
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    logger.info('Closing database connection');
    db.close();
    db = null;
  }
}

// Graceful shutdown handlers
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});

export default {
  initialize: initializeDatabase,
  get: getDatabase,
  close: closeDatabase,
};
