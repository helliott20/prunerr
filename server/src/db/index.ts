import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from '../config';
import logger from '../utils/logger';
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

    logger.info('Database initialized successfully');

    return db;
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
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
