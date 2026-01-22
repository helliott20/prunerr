# External Integrations

**Analysis Date:** 2026-01-22

## APIs & External Services

**Plex Media Server (Required):**
- Service: Plex Media Server REST API
- Purpose: Core integration - fetch libraries, media items, metadata, view counts
- SDK/Client: Custom `PlexService` class using axios
  - Location: `server/src/services/plex.ts`
- Auth: X-Plex-Token header
  - Env var: `PLEX_TOKEN` (required)
- API Pattern: XML responses parsed via fast-xml-parser
- Rate limiting: Handles 429 responses with retry-after
- Default URL: `http://localhost:32400`
  - Env var: `PLEX_URL` (configurable)
- Key Methods:
  - `testConnection()` - Verify token validity
  - `getLibraries()` - Fetch all library sections
  - `getLibraryItems(libraryId)` - Get items in library
  - `getItemMetadata(ratingKey)` - Get detailed metadata
  - `refreshLibrary(libraryId)` - Trigger library scan

**Sonarr (Optional):**
- Service: Sonarr TV show management API
- Purpose: TV show deletion coordination, unmonitoring, file deletion
- SDK/Client: Custom `SonarrService` class using axios
  - Location: `server/src/services/sonarr.ts`
- Auth: X-Api-Key header
  - Env var: `SONARR_API_KEY` (optional)
- API Endpoint: `/api/v3` base path
- Default URL: `http://localhost:8989`
  - Env var: `SONARR_URL` (optional)
- Rate limiting: Handles 429 responses
- Key Methods:
  - `testConnection()` - Verify API key validity
  - `getSeries()` - List all TV shows
  - `deleteSeries(id, deleteFiles)` - Remove series and optionally files
  - `deleteAllEpisodeFiles(seriesId)` - Delete files while keeping series
  - `unmonitorSeries(id)` - Stop monitoring series
  - `unmonitorEpisodes(episodeIds)` - Stop monitoring specific episodes
  - `getSeriesByTvdbId(tvdbId)` - Find series by external ID
  - `refreshSeries(seriesId)` - Trigger metadata refresh

**Radarr (Optional):**
- Service: Radarr movie management API
- Purpose: Movie deletion coordination, file deletion
- SDK/Client: Custom `RadarrService` class using axios
  - Location: `server/src/services/radarr.ts`
- Auth: X-Api-Key header
  - Env var: `RADARR_API_KEY` (optional)
- API Endpoint: `/api/v3` base path
- Default URL: `http://localhost:7878`
  - Env var: `RADARR_URL` (optional)
- Rate limiting: Handles 429 responses
- Similar methods to Sonarr adapted for movies

**Tautulli (Optional):**
- Service: Plex monitoring and analytics API
- Purpose: Track watch history, identify unwatched media, user statistics
- SDK/Client: Custom `TautulliService` class using axios
  - Location: `server/src/services/tautulli.ts`
- Auth: API key in query parameters
  - Env var: `TAUTULLI_API_KEY` (optional)
- Default URL: `http://localhost:8181`
  - Env var: `TAUTULLI_URL` (optional)
- Response Format: JSON with datatables structure
- Key Methods: Watch history retrieval, user statistics, library stats

**Overseerr (Optional):**
- Service: Overseerr request management API
- Purpose: Integration point for request tracking (planning phase)
- SDK/Client: Custom `OverseerrService` class using axios
  - Location: `server/src/services/overseerr.ts`
- Auth: API key in header
  - Env var: `OVERSEERR_API_KEY` (optional)
- Default URL: `http://localhost:5055`
  - Env var: `OVERSEERR_URL` (optional)

**Unraid (Optional):**
- Service: Unraid system management API
- Purpose: Disk usage statistics, system monitoring
- SDK/Client: Custom `UnraidService` class
  - Location: `server/src/services/unraid.ts`
- Auth: API key
  - Env var: `UNRAID_API_KEY` (optional)
- Default URL: `http://localhost`
  - Env var: `UNRAID_URL` (optional)

## Data Storage

**Local Database:**
- Type: SQLite 3 (embedded)
- Location: `${DATA_DIR}/prunerr.db` (default: `/app/data/prunerr.db`)
  - Env vars: `DATA_DIR`, `DB_PATH`
- Library: `better-sqlite3` (synchronous, file-based)
- Initialization: `server/src/db/index.ts`
- Schema: `server/src/db/schema.ts`
- Tables: Projects, media items, deletion history, rules, queue items
- Pragmas: WAL mode enabled, foreign keys enabled
- Repositories: `server/src/db/repositories/` - Data access layer

**File Storage:**
- Type: Local filesystem only
- Usage: SQLite database file storage
- No cloud storage integration

**Caching:**
- Type: In-memory via React Query on frontend
  - Location: `client/src/hooks/useApi.ts`
- Query keys defined for dashboard, library, rules, queue, history, settings
- Cache strategy: Query-based deduplication, configurable stale time
- No external cache service (Redis, Memcached)

## Authentication & Identity

**Auth Provider:**
- Type: Custom (application-level only)
- Implementation: No built-in user authentication
- Access Control: None - application assumes single admin user
- Session Management: Not implemented

## Monitoring & Observability

**Error Tracking:**
- Type: None (no error tracking service)
- Internal logging via Winston

**Logs:**
- Framework: Winston 3.x
  - Location: `server/src/utils/logger.ts`
- Levels: error, warn, info, debug
- Level control: `LOG_LEVEL` environment variable
- Morgan integration: HTTP request logging to Winston
- Development mode: Verbose SQL queries logged
- Output: Console + structured logs with context metadata

## CI/CD & Deployment

**Hosting:**
- Type: Docker containers (Cloud Run compatible)
- Files: `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`
- Platform: Can run on Docker, Kubernetes, or bare Node.js

**CI Pipeline:**
- Type: Not detected in codebase
- Likely: GitHub Actions or similar (based on `.dockerignore`)

## Environment Configuration

**Required env vars (must be set):**
- `PLEX_URL` - Plex server URL (default: http://localhost:32400)
- `PLEX_TOKEN` - Plex authentication token

**Optional service env vars:**
- `SONARR_URL` - Sonarr server URL
- `SONARR_API_KEY` - Sonarr API key
- `RADARR_URL` - Radarr server URL
- `RADARR_API_KEY` - Radarr API key
- `TAUTULLI_URL` - Tautulli server URL
- `TAUTULLI_API_KEY` - Tautulli API key
- `OVERSEERR_URL` - Overseerr server URL
- `OVERSEERR_API_KEY` - Overseerr API key
- `UNRAID_URL` - Unraid server URL
- `UNRAID_API_KEY` - Unraid API key

**Email/Notification env vars:**
- `SMTP_HOST` - SMTP server hostname
- `SMTP_PORT` - SMTP server port (default: 587)
- `SMTP_USER` - SMTP authentication username
- `SMTP_PASSWORD` - SMTP authentication password
- `SMTP_FROM` - Sender email address
- `NOTIFICATION_EMAIL` - Recipient email address

**Discord/Telegram notifications:**
- `DISCORD_WEBHOOK_URL` - Discord webhook for notifications
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `TELEGRAM_CHAT_ID` - Telegram chat ID

**Application env vars:**
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 3000)
- `DATA_DIR` - Database directory (default: /app/data)
- `DB_PATH` - Database file path (default: /app/data/prunerr.db)
- `LOG_LEVEL` - Logging level (default: info)

**Advanced env vars:**
- `SCAN_CRON` - Cron schedule for automatic scans (default: 0 3 * * *)
- `STALE_DAYS` - Days without watch to consider media stale (default: 90)
- `DRY_RUN` - Test run without executing deletions
- `DEBUG` - Enable verbose API logging
- `CORS_ORIGIN` - CORS allowed origin (production only)

**Secrets location:**
- `.env` file in project root (git-ignored)
- Reference template: `.env.example`

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- Email notifications via SMTP (`server/src/notifications/index.ts`)
- Discord webhooks (future integration)
- Telegram messages (future integration)

## Service Integration Architecture

**Service Pattern:**
All external service integrations follow a consistent pattern:
- Located in `server/src/services/`
- Each service: axios HTTP client with timeout (30s)
- Rate limit handling: 429 responses with retry-after
- Error logging: AxiosError handling with context
- Connection testing: `testConnection()` method on all services

**Service Initialization:**
- Location: `server/src/services/init.ts`
- Services are instantiated based on configuration at server startup
- Only configured services are initialized (optional services)

**API Client Pattern (Frontend):**
- HTTP client: axios through custom API services
- Location: `client/src/services/api/`
- State management: React Query for server state
- Query invalidation: Mutation-triggered cache updates

---

*Integration audit: 2026-01-22*
