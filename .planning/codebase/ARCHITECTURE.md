# Architecture

**Analysis Date:** 2026-01-22

## Pattern Overview

**Overall:** Three-tier monorepo with layered separation between API, business logic, and frontend.

**Key Characteristics:**
- **Monorepo structure** (server + client workspaces)
- **Service-oriented backend** with orchestration layer
- **State management through SQLite** database with repository pattern
- **React SPA frontend** with React Router and TanStack Query
- **Event-driven scheduler** for automated cleanup tasks
- **Rules engine** for declarative deletion policies

## Layers

**Presentation Layer:**
- Purpose: User interface and interaction
- Location: `client/src/components/`, `client/src/main.tsx`
- Contains: React components, hooks, services for API communication
- Depends on: React Router, TanStack Query, Lucide icons, Axios
- Used by: Browser/end-users

**API/Routes Layer:**
- Purpose: Expose HTTP endpoints for client communication
- Location: `server/src/routes/`
- Contains: Express route handlers and middleware
- Depends on: Services layer, Database repositories
- Used by: Frontend via Axios, internal scheduler

**Business Logic Layer:**
- Purpose: Core domain logic and orchestration
- Location: `server/src/services/`, `server/src/rules/`
- Contains: PlexService, TautulliService, SonarrService, RadarrService, OverseerrService, ScannerService, DeletionService, RulesEngine
- Depends on: Database, external APIs (Plex, Sonarr, Radarr, Overseerr, Tautulli)
- Used by: Routes, Scheduler

**Data Access Layer:**
- Purpose: Database operations and persistence
- Location: `server/src/db/repositories/`, `server/src/db/schema.ts`
- Contains: Repository classes for MediaItems, Rules, Settings, History
- Depends on: Better-sqlite3
- Used by: Services, Routes

**Infrastructure Layer:**
- Purpose: Configuration, logging, scheduling, notifications
- Location: `server/src/config/`, `server/src/utils/`, `server/src/scheduler/`, `server/src/notifications/`
- Contains: Environment config, Winston logger, node-cron scheduler, email/Discord/Telegram notifiers
- Depends on: External services (SMTP, Discord API, Telegram API), node-cron
- Used by: All layers

## Data Flow

**Library Scan Flow:**

1. **Trigger**: Scheduler executes `scanLibraries()` task at configured cron interval (default: 3 AM daily)
2. **Collection**: ScannerService initializes - loads service configs (PlexService, TautulliService, SonarrService, RadarrService, OverseerrService)
3. **Fetch Metadata**:
   - PlexService.getLibraries() → retrieves all Plex libraries
   - PlexService.getMedia(libraryKey) → fetches media items per library
   - TautulliService.getWatchedStatus() → gets play counts, watch dates
   - SonarrService.getSeries() / RadarrService.getMovies() → fetches ARR data with quality, ratings
4. **GUID Matching**: ScannerService parses Plex GUIDs (IMDB, TMDB, TVDB) and matches with Sonarr/Radarr records
5. **Database Upsert**: SyncedMediaData written to `media_items` table via mediaItemsRepo
6. **Return**: ScanResult sent back to API caller

**Deletion Queue Flow:**

1. **Rule Evaluation**: RulesEngine.evaluateAllRules() iterates all enabled rules and media items
2. **Condition Check**: evaluateConditions() applies rule logic (AND/OR) against extended media fields
3. **Flagging**: Matched items → mediaItemsRepo.update(status='flagged', marked_at=now)
4. **Queue Processing**: processDeletionQueue() task checks deletion grace period (default: 7 days)
5. **Execution**:
   - DeletionService.performDeletion() → updates status to 'pending_deletion'
   - Calls SonarrService.deleteEpisodeFile() or RadarrService.deleteMovieFile() as needed
   - Updates file_path in database post-deletion
6. **Notification**: deletionHistoryRepo records entry + notificationService sends alerts
7. **OverseerrReset**: If configured, OverseerrService.resetMediaByTmdbId() resets request status

**State Management:**

- **Client state**: React Query (TanStack Query) caches API responses, 5-minute stale time
- **Server state**: SQLite database with schema defining media_items, rules, history, settings tables
- **Settings persistence**: settingsRepo acts as key-value store for Plex/Sonarr/etc URLs and API keys
- **No real-time sync**: Scheduler-based polling; manual scan triggers via POST `/api/scan`

## Key Abstractions

**RulesEngine:**
- Purpose: Declarative evaluation of deletion eligibility against configurable conditions
- Examples: `server/src/rules/engine.ts`, `server/src/rules/conditions.ts`
- Pattern:
  - Parse rule JSON into ExtendedRuleCondition[] with logic operators (AND/OR)
  - Extend media items with computed fields (daysUnwatched, ruleMatches)
  - Return ProtectionResult + ItemEvaluationResult for each item
  - Supports protection policies: recentlyAdded, recentlyWatched, inProgress, genre, tags, rating thresholds

**ScannerService:**
- Purpose: Multi-source data aggregation and GUID matching
- Examples: `server/src/services/scanner.ts`
- Pattern:
  - Lazy initialization of Plex/Tautulli/Sonarr/Radarr/Overseerr from settings or env vars
  - Caches Sonarr series/Radarr movies by ID and GUID indices (TVDB, IMDB, TMDB)
  - Parses Plex GUIDs using regex patterns to extract external IDs
  - Returns typed ScanResult with errors array for partial failures

**DeletionService:**
- Purpose: Orchestrate deletion across multiple ARR services with history tracking
- Examples: `server/src/services/deletion.ts`
- Pattern:
  - Dependency injection of repositories and services
  - Cascade deletion: file → episode/movie → series/movie record
  - Audit trail: every deletion logged to deletion_history table
  - Optional Overseerr notification to reset user requests

**Scheduler:**
- Purpose: Reliable cron-based task execution with status tracking
- Examples: `server/src/scheduler/index.ts`
- Pattern:
  - Singleton pattern with getScheduler() factory
  - Task registry: scanLibraries, processDeletionQueue, sendDeletionReminders
  - Prevents duplicate execution: checks isRunning flag before re-entry
  - Manual trigger support: runNow(taskName) executes outside cron

**Repository Pattern:**
- Purpose: Isolate database access, enable testing, provide typed queries
- Examples: `server/src/db/repositories/mediaItems.ts`, `server/src/db/repositories/rules.ts`
- Pattern:
  - Typed getters/setters for entity operations (create, update, delete, findById, getByStatus)
  - SQL prepared statements via better-sqlite3
  - Return typed objects (MediaItem[], Rule[]) not raw rows

## Entry Points

**Server:**
- Location: `server/src/index.ts`
- Triggers: `npm start` or container startup
- Responsibilities:
  - Load env config via dotenv
  - Initialize Express app with CORS, helmet, Morgan logging
  - Initialize SQLite database and run migrations
  - Call initializeServices() to set up PlexService, TautulliService, SonarrService, RadarrService, OverseerrService
  - Serve client static files in production
  - Mount API routes at `/api`
  - Register graceful shutdown handlers (SIGTERM, SIGINT)

**Client:**
- Location: `client/src/main.tsx`
- Triggers: Vite dev server or built artifact in production
- Responsibilities:
  - Initialize React app with QueryClientProvider, BrowserRouter, ToastProvider
  - Configure TanStack Query defaults (5-min stale time, retry=1, no refetchOnWindowFocus)
  - Mount App.tsx component to #root DOM element

**Scheduler:**
- Location: `server/src/index.ts` line 122: `await initializeServices()`
- Triggers: Server startup
- Responsibilities:
  - Instantiate Scheduler singleton
  - Start cron jobs for scanLibraries, processDeletionQueue, sendDeletionReminders
  - Default schedule: 3 AM, 4 AM, 9 AM UTC (configurable via env)

**API Routes:**
- Location: `server/src/routes/index.ts`
- Examples:
  - GET `/api/media?filters=...` → `mediaRouter` → libraryApi
  - POST `/api/scan` → `scanRouter` → manual trigger scheduler.runNow('scanLibraries')
  - POST `/api/rules` → `rulesRouter` → RulesEngine evaluation
  - GET `/api/queue` → `queueRouter` → deletion status
  - POST `/api/media/{id}/delete` → `mediaRouter` → DeletionService.performDeletion()

## Error Handling

**Strategy:** Layered error responses with environment-aware details

**Patterns:**

- **API errors** (lines 95-112, `server/src/index.ts`):
  - Global error handler catches all unhandled exceptions
  - Returns { success: false, error: "message" }
  - Includes stack trace only in development

- **Service errors**:
  - Axios errors caught and logged by TautulliService, PlexService, etc.
  - Return null/empty arrays on failure to allow partial scans
  - Logged via Winston at ERROR level with context

- **Rule evaluation errors** (RulesEngine):
  - Try-catch wraps JSON.parse of rule conditions
  - Logs error but continues with default conditions
  - Prevents one malformed rule from failing entire evaluation

- **Database errors**:
  - Migrations fail loudly at startup (runMigrations throws)
  - Query failures in repositories propagate to caller
  - Better-sqlite3 foreign key violations prevent data corruption

- **Notification errors** (email, Discord, Telegram):
  - Caught in notificationService, logged but don't block deletion
  - Allows cleanup to proceed even if alerts fail

## Cross-Cutting Concerns

**Logging:** Winston logger (`server/src/utils/logger.ts`)
- Four levels: debug, info, warn, error
- Development: colorized console output
- Production: structured JSON to stdout
- Morgan middleware logs HTTP requests (skip /api/health/ping)
- Every service operation logged with context (e.g., "Plex service initialized")

**Validation:** Zod schemas (`server/src/types/index.ts`)
- MediaItem, Rule, Setting types exported as schemas
- API request bodies validated before reaching handlers
- Config values validated at startup via validateConfig()

**Authentication:** None at present
- No user accounts or permissions model
- Assumed to run in trusted network or behind reverse proxy auth

**Database Migrations:** Schema-based (`server/src/db/schema.ts`)
- runMigrations(db) creates tables if not exist
- Foreign keys enabled (PRAGMA foreign_keys = ON)
- WAL mode enabled for concurrent reads (PRAGMA journal_mode = WAL)

---

*Architecture analysis: 2026-01-22*
