import type Database from 'better-sqlite3';
import logger from '../utils/logger';

interface Migration {
  version: number;
  name: string;
  up: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Settings table for application configuration
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Profiles table for rule grouping
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Media items table for tracking all media
      CREATE TABLE IF NOT EXISTS media_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('movie', 'show', 'episode')),
        title TEXT NOT NULL,
        plex_id TEXT,
        sonarr_id INTEGER,
        radarr_id INTEGER,
        poster_url TEXT,
        file_path TEXT,
        file_size INTEGER,
        resolution TEXT,
        codec TEXT,
        added_at TEXT,
        last_watched_at TEXT,
        play_count INTEGER NOT NULL DEFAULT 0,
        watched_by TEXT,
        status TEXT NOT NULL DEFAULT 'monitored' CHECK (status IN ('monitored', 'flagged', 'pending_deletion', 'deleted', 'protected')),
        marked_at TEXT,
        delete_after TEXT,
        is_protected INTEGER NOT NULL DEFAULT 0,
        protection_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Rules table for automation rules
      CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        profile_id INTEGER,
        type TEXT NOT NULL CHECK (type IN ('age', 'watch_status', 'size', 'quality', 'custom')),
        conditions TEXT NOT NULL DEFAULT '[]',
        action TEXT NOT NULL CHECK (action IN ('flag', 'delete', 'notify')),
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
      );

      -- Deletion history table for audit trail
      CREATE TABLE IF NOT EXISTS deletion_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_item_id INTEGER,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('movie', 'show', 'episode')),
        file_size INTEGER,
        deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
        deletion_type TEXT NOT NULL CHECK (deletion_type IN ('automatic', 'manual')),
        deleted_by_rule_id INTEGER,
        FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE SET NULL,
        FOREIGN KEY (deleted_by_rule_id) REFERENCES rules(id) ON DELETE SET NULL
      );

      -- Scan history table for tracking scans
      CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        items_scanned INTEGER NOT NULL DEFAULT 0,
        items_flagged INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed'))
      );

      -- Create indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type);
      CREATE INDEX IF NOT EXISTS idx_media_items_status ON media_items(status);
      CREATE INDEX IF NOT EXISTS idx_media_items_plex_id ON media_items(plex_id);
      CREATE INDEX IF NOT EXISTS idx_media_items_sonarr_id ON media_items(sonarr_id);
      CREATE INDEX IF NOT EXISTS idx_media_items_radarr_id ON media_items(radarr_id);
      CREATE INDEX IF NOT EXISTS idx_media_items_last_watched ON media_items(last_watched_at);
      CREATE INDEX IF NOT EXISTS idx_rules_profile_id ON rules(profile_id);
      CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_deletion_history_deleted_at ON deletion_history(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_scan_history_started_at ON scan_history(started_at);
      CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

      -- Insert default profile
      INSERT OR IGNORE INTO profiles (name, is_active) VALUES ('Default', 1);
    `,
  },
  {
    version: 2,
    name: 'add_year_and_imdb',
    up: `
      -- Add year and IMDB ID columns to media_items
      ALTER TABLE media_items ADD COLUMN year INTEGER;
      ALTER TABLE media_items ADD COLUMN imdb_id TEXT;
      ALTER TABLE media_items ADD COLUMN tmdb_id INTEGER;
      ALTER TABLE media_items ADD COLUMN tvdb_id INTEGER;

      -- Create indexes for new columns
      CREATE INDEX IF NOT EXISTS idx_media_items_imdb_id ON media_items(imdb_id);
      CREATE INDEX IF NOT EXISTS idx_media_items_tmdb_id ON media_items(tmdb_id);
    `,
  },
  {
    version: 3,
    name: 'add_deletion_options',
    up: `
      -- Add deletion_action column to rules for specifying how to delete
      -- Options: unmonitor_only, delete_files, full_removal
      ALTER TABLE rules ADD COLUMN deletion_action TEXT DEFAULT 'delete_files';

      -- Add reset_overseerr flag to rules to control whether to reset in Overseerr
      ALTER TABLE rules ADD COLUMN reset_overseerr INTEGER DEFAULT 0;

      -- Add grace_period_days to rules for configurable grace periods per rule
      ALTER TABLE rules ADD COLUMN grace_period_days INTEGER DEFAULT 7;

      -- Add requested_by column to media_items to track who requested the content
      ALTER TABLE media_items ADD COLUMN requested_by TEXT;

      -- Add deletion_action column to media_items to track what action to take
      ALTER TABLE media_items ADD COLUMN deletion_action TEXT DEFAULT 'delete_files';

      -- Add reset_overseerr flag to media_items
      ALTER TABLE media_items ADD COLUMN reset_overseerr INTEGER DEFAULT 0;

      -- Add matched_rule_id to track which rule flagged the item
      ALTER TABLE media_items ADD COLUMN matched_rule_id INTEGER REFERENCES rules(id) ON DELETE SET NULL;

      -- Add overseerr_reset_at to track when the item was reset in Overseerr
      ALTER TABLE media_items ADD COLUMN overseerr_reset_at TEXT;

      -- Create index for matched_rule_id
      CREATE INDEX IF NOT EXISTS idx_media_items_matched_rule ON media_items(matched_rule_id);

      -- Add overseerr_reset column to deletion_history
      ALTER TABLE deletion_history ADD COLUMN overseerr_reset INTEGER DEFAULT 0;
    `,
  },
  {
    version: 4,
    name: 'ensure_deletion_columns',
    up: `
      -- Ensure overseerr_reset_at column exists (may have been missed in migration 3)
      -- SQLite doesn't support IF NOT EXISTS for ADD COLUMN, but will error if column exists
      -- Using a simple approach: try to select from the column, if it fails the column doesn't exist
      -- This migration uses a workaround by creating a new temp table

      -- For simplicity, we'll just try to add the column and catch the error in the migration runner
      -- This migration adds columns that might be missing
      ALTER TABLE media_items ADD COLUMN overseerr_reset_at TEXT;
    `,
  },
  {
    version: 5,
    name: 'add_rule_media_type',
    up: `
      -- Add media_type column to rules for filtering by media type
      -- Options: all, movie, show
      ALTER TABLE rules ADD COLUMN media_type TEXT DEFAULT 'all' CHECK (media_type IN ('all', 'movie', 'show'));
    `,
  },
  {
    version: 6,
    name: 'add_activity_log',
    up: `
      -- Activity log table for unified event tracking
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL CHECK (event_type IN ('scan', 'deletion', 'rule_match', 'protection', 'manual_action', 'error')),
        action TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK (actor_type IN ('scheduler', 'user', 'rule')),
        actor_id TEXT,
        actor_name TEXT,
        target_type TEXT,
        target_id INTEGER,
        target_title TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for efficient queries
      CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_log_event_type ON activity_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_activity_log_actor_type ON activity_log(actor_type);
    `,
  },
  {
    version: 7,
    name: 'ensure_rule_media_type',
    up: `
      -- Ensure media_type column exists on rules table
      -- This is a defensive migration for databases where migration 5 may have been recorded but not applied
      ALTER TABLE rules ADD COLUMN media_type TEXT DEFAULT 'all' CHECK (media_type IN ('all', 'movie', 'show'));
    `,
  },
];

// Schema version tracking table
const createMigrationsTable = `
  CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(createMigrationsTable);

  // Get current schema version
  const getCurrentVersion = db.prepare<[], { max_version: number | null }>(
    'SELECT MAX(version) as max_version FROM migrations'
  );
  const result = getCurrentVersion.get();
  const currentVersion = result?.max_version ?? 0;

  logger.info(`Current database schema version: ${currentVersion}`);

  // Run pending migrations
  const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    logger.info('Database schema is up to date');
    return;
  }

  logger.info(`Running ${pendingMigrations.length} pending migration(s)...`);

  const insertMigration = db.prepare<[number, string]>(
    'INSERT INTO migrations (version, name) VALUES (?, ?)'
  );

  for (const migration of pendingMigrations) {
    logger.info(`Running migration ${migration.version}: ${migration.name}`);

    try {
      db.exec(migration.up);
      insertMigration.run(migration.version, migration.name);
      logger.info(`Migration ${migration.version} completed successfully`);
    } catch (error) {
      // Handle "duplicate column" errors gracefully - column already exists
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('duplicate column name')) {
        logger.info(`Migration ${migration.version}: Column already exists, marking as complete`);
        insertMigration.run(migration.version, migration.name);
      } else {
        logger.error(`Migration ${migration.version} failed:`, error);
        throw error;
      }
    }
  }

  logger.info('All migrations completed successfully');
}

export { migrations };
