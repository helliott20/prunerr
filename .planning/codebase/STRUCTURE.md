# Codebase Structure

**Analysis Date:** 2026-01-22

## Directory Layout

```
library-manager/
├── server/                          # Backend API server (Node.js + Express)
│   ├── src/
│   │   ├── index.ts                 # Express app setup, middleware, graceful shutdown
│   │   ├── config/
│   │   │   └── index.ts             # Environment variables and config objects
│   │   ├── db/
│   │   │   ├── index.ts             # Database initialization, getDatabase(), closeDatabase()
│   │   │   ├── schema.ts            # Migrations and table definitions
│   │   │   └── repositories/
│   │   │       ├── index.ts         # Re-exports all repositories
│   │   │       ├── mediaItems.ts    # CRUD for media_items table
│   │   │       ├── rules.ts         # CRUD for rules table
│   │   │       ├── settings.ts      # Key-value store for config
│   │   │       ├── history.ts       # Query deletion_history
│   │   │       └── [others]         # profiles, scan history, activity
│   │   ├── types/
│   │   │   └── index.ts             # Zod schemas and TypeScript types
│   │   ├── services/
│   │   │   ├── index.ts             # Service exports and type aggregation
│   │   │   ├── init.ts              # Initialize all services at startup
│   │   │   ├── plex.ts              # PlexService - fetch libraries, media, watch status
│   │   │   ├── tautulli.ts          # TautulliService - watch history and statistics
│   │   │   ├── sonarr.ts            # SonarrService - TV series, episodes, quality
│   │   │   ├── radarr.ts            # RadarrService - Movies, quality, ratings
│   │   │   ├── overseerr.ts         # OverseerrService - User requests, reset status
│   │   │   ├── scanner.ts           # ScannerService - Orchestrate multi-source scan
│   │   │   ├── deletion.ts          # DeletionService - Execute and track deletions
│   │   │   ├── unraid.ts            # UnraidService - Disk usage and array stats
│   │   │   └── types.ts             # Service-specific types (PlexLibrary, SonarrSeries, etc)
│   │   ├── routes/
│   │   │   ├── index.ts             # Mount all route handlers
│   │   │   ├── health.ts            # GET /api/health, /api/health/ping
│   │   │   ├── media.ts             # GET/POST media, DELETE by ID
│   │   │   ├── scan.ts              # POST /api/scan for manual triggers
│   │   │   ├── rules.ts             # GET/POST/PUT rules, trigger evaluation
│   │   │   ├── queue.ts             # GET deletion queue, upcoming deletions
│   │   │   ├── history.ts           # GET deletion history with filters
│   │   │   ├── stats.ts             # GET dashboard stats, recommendations
│   │   │   ├── settings.ts          # GET/PUT service URLs and API keys
│   │   │   ├── activity.ts          # GET recent activity log
│   │   │   ├── library.ts           # GET library metadata
│   │   │   └── unraid.ts            # GET Unraid array stats
│   │   ├── scheduler/
│   │   │   ├── index.ts             # Scheduler class, cron management
│   │   │   └── tasks.ts             # Task functions: scanLibraries, processDeletionQueue, sendDeletionReminders
│   │   ├── rules/
│   │   │   ├── engine.ts            # RulesEngine - evaluate conditions, return matches
│   │   │   ├── conditions.ts        # evaluateConditions(), extendMediaItem()
│   │   │   └── types.ts             # Rule condition and evaluation result types
│   │   ├── notifications/
│   │   │   ├── index.ts             # NotificationService - send emails, Discord, Telegram
│   │   │   └── templates.ts         # Message templates for different events
│   │   └── utils/
│   │       └── logger.ts            # Winston logger configuration, morganStream
│   ├── dist/                        # Compiled JavaScript (output from tsc)
│   ├── package.json                 # Server dependencies: express, better-sqlite3, axios, etc
│   └── tsconfig.json                # TypeScript configuration
│
├── client/                          # Frontend React SPA (Vite + TypeScript)
│   ├── src/
│   │   ├── main.tsx                 # React root, QueryClientProvider, BrowserRouter setup
│   │   ├── App.tsx                  # Route definitions via React Router
│   │   ├── index.css                # Tailwind CSS import
│   │   ├── components/
│   │   │   ├── Dashboard/
│   │   │   │   └── Dashboard.tsx    # Main dashboard with stats, recommendations
│   │   │   ├── Library/
│   │   │   │   ├── Library.tsx      # List and filter media items
│   │   │   │   ├── MediaCard.tsx    # Card view component
│   │   │   │   ├── MediaTable.tsx   # Table view component
│   │   │   │   └── DeletionOptionsModal.tsx # Deletion confirmation dialog
│   │   │   ├── Rules/
│   │   │   │   ├── Rules.tsx        # Rule management UI
│   │   │   │   └── SmartRuleBuilder.tsx # Visual rule editor
│   │   │   ├── Queue/
│   │   │   │   └── Queue.tsx        # Deletion queue and pending items
│   │   │   ├── History/
│   │   │   │   └── History.tsx      # Deletion history with search/filter
│   │   │   ├── Settings/
│   │   │   │   └── Settings.tsx     # Service URLs, API keys, profile management
│   │   │   ├── Recommendations/
│   │   │   │   └── Recommendations.tsx # Suggested deletions based on watch stats
│   │   │   ├── Layout/
│   │   │   │   ├── Layout.tsx       # Page wrapper with sidebar, header
│   │   │   │   ├── Sidebar.tsx      # Navigation menu
│   │   │   │   └── DiskStatsModal.tsx # Unraid disk usage modal
│   │   │   └── common/
│   │   │       ├── Button.tsx       # Reusable button component
│   │   │       ├── Input.tsx        # Text/number input with validation
│   │   │       ├── Modal.tsx        # Dialog wrapper
│   │   │       ├── Card.tsx         # Card layout component
│   │   │       ├── Badge.tsx        # Status/tag badge component
│   │   │       └── Toast.tsx        # Notification toast + ToastProvider context
│   │   ├── hooks/
│   │   │   └── useApi.ts            # React Query hooks for all API endpoints
│   │   ├── services/
│   │   │   └── api.ts               # Axios instance, API client functions (dashboardApi, libraryApi, etc)
│   │   ├── lib/
│   │   │   └── utils.ts             # formatBytes(), formatRelativeTime(), cn() (classname merge)
│   │   └── types/
│   │       └── index.ts             # Frontend TypeScript types (mirrors server types)
│   ├── dist/                        # Built output from Vite (static HTML/JS/CSS)
│   ├── index.html                   # Entry HTML file
│   ├── package.json                 # Client dependencies: react, vite, tailwindcss, lucide-react
│   ├── tsconfig.json                # TypeScript config with vite types
│   ├── vite.config.ts               # Vite configuration
│   ├── tailwind.config.js           # Tailwind CSS theme and plugin config
│   └── postcss.config.js            # PostCSS configuration for Tailwind
│
├── .env                             # Environment variables (git-ignored)
├── .env.example                     # Example environment variables
├── package.json                     # Root monorepo package.json with workspace scripts
├── tsconfig.json                    # Root TypeScript config
├── docker-compose.yml               # Production compose file
├── docker-compose.dev.yml           # Development compose file
├── Dockerfile                       # Multi-stage build for server + client
└── README.md                        # Project documentation
```

## Directory Purposes

**server/src:**
- Purpose: All backend TypeScript source code
- Contains: Express routes, services, database, configuration, scheduler, rules engine
- Key files:
  - `index.ts`: Express app entry point
  - `config/index.ts`: Environment variables parsed and typed
  - `db/schema.ts`: Database table definitions and migrations
  - `services/`: External integrations (Plex, Sonarr, Radarr, etc)
  - `routes/`: HTTP API endpoints
  - `scheduler/`: Cron-based task execution

**server/dist:**
- Purpose: Compiled JavaScript output
- Contains: Built `.js` and `.js.map` files (generated by TypeScript compiler)
- Generated: `npm run build` in server workspace
- Committed: No (in .gitignore)

**client/src:**
- Purpose: All frontend TypeScript/React source code
- Contains: Components, hooks, API services, utility functions
- Key files:
  - `main.tsx`: React app bootstrap
  - `App.tsx`: Route definitions
  - `components/`: Organized by feature (Dashboard, Library, Rules, etc)
  - `hooks/useApi.ts`: React Query hooks for data fetching
  - `services/api.ts`: Axios client and API function definitions

**client/dist:**
- Purpose: Built static assets
- Contains: Optimized HTML, JavaScript, CSS (served by Express in production)
- Generated: `npm run build` in client workspace
- Committed: No (in .gitignore)

## Key File Locations

**Entry Points:**
- `server/src/index.ts`: Express app initialization and HTTP server startup
- `client/src/main.tsx`: React app root with providers
- `server/src/services/init.ts`: Service initialization at server startup

**Configuration:**
- `server/src/config/index.ts`: All environment variables mapped to config objects
- `server/tsconfig.json`: TypeScript compilation settings
- `client/vite.config.ts`: Frontend build tool configuration
- `client/tailwind.config.js`: UI theme and Tailwind CSS settings

**Core Logic:**
- `server/src/services/scanner.ts`: Multi-source library scanning orchestration
- `server/src/rules/engine.ts`: Rule evaluation and deletion eligibility determination
- `server/src/services/deletion.ts`: Execution of file deletion and history tracking
- `server/src/scheduler/index.ts`: Cron job management and manual task triggering

**Data Access:**
- `server/src/db/index.ts`: Database connection and lifecycle management
- `server/src/db/schema.ts`: Table definitions and migration runner
- `server/src/db/repositories/mediaItems.ts`: CRUD operations for media_items table
- `server/src/db/repositories/rules.ts`: CRUD operations for rules table

**Testing:**
- Not detected in current structure (no test files found)

## Naming Conventions

**Files:**
- PascalCase for classes: `PlexService.ts`, `RulesEngine.ts`, `DeletionService.ts`
- camelCase for utilities and modules: `logger.ts`, `api.ts`, `utils.ts`
- index.ts for directory exports and re-exports
- Component files: PascalCase (e.g., `Dashboard.tsx`, `MediaCard.tsx`)
- Hook files: camelCase (e.g., `useApi.ts`)

**Directories:**
- lowercase for feature groupings: `services/`, `routes/`, `components/`
- PascalCase for route/component features: `Dashboard/`, `Library/`, `Rules/`

**Functions:**
- camelCase: getDatabase(), getScheduler(), evaluateConditions()
- Service methods: action-based verbs: getMedia(), deleteFile(), unmonitorSeries()

**Variables & Constants:**
- camelCase: mediItems, plexUrl, gracePeriodDays
- SCREAMING_SNAKE_CASE for environment variable names: PLEX_URL, SONARR_API_KEY
- SCREAMING_SNAKE_CASE for exported constants: DEFAULT_CONFIG, DEFAULT_PROTECTION_CONFIG

**Types & Interfaces:**
- PascalCase: MediaItem, Rule, PlexLibrary, DeletionService
- Extended types: append context, e.g., ExtendedRuleCondition, ItemEvaluationResult
- Request/Response suffixed types: ApiResponse<T>, LibraryFilters

## Where to Add New Code

**New API Endpoint:**
1. Create route handler in `server/src/routes/[feature].ts`
2. Add route to `server/src/routes/index.ts` via router.use()
3. Call service methods to execute business logic
4. Return ApiResponse<T> with data field
5. Add React Query hook in `client/src/hooks/useApi.ts`
6. Import hook in component and render with loading/error states

**New Service (external integration):**
1. Create `server/src/services/[name].ts` with class extending base pattern
2. Constructor accepts URL and API key from config
3. Methods return typed objects (e.g., PlexLibrary[], RadarrMovie[])
4. Export types from `server/src/services/types.ts`
5. Initialize in `server/src/services/init.ts`
6. Inject into ScannerService or DeletionService as dependency

**New Database Table:**
1. Add schema definition to `server/src/db/schema.ts` in runMigrations()
2. Create repository in `server/src/db/repositories/[entity].ts`
3. Export from `server/src/db/repositories/index.ts`
4. Add TypeScript type to `server/src/types/index.ts`
5. Use getDatabase() to access db connection

**New Scheduler Task:**
1. Create task function in `server/src/scheduler/tasks.ts`
2. Return TaskResult { success, taskName, startedAt, completedAt, durationMs, error? }
3. Register in tasks map and getAvailableTasks() list
4. Enable in `server/src/services/init.ts` or via settings route

**New Rule Condition Type:**
1. Add condition type to `server/src/rules/types.ts` (e.g., ExtendedRuleCondition)
2. Implement evaluation logic in `server/src/rules/conditions.ts` evaluateConditions()
3. Update RulesEngine to support new evaluation path
4. Add UI components in `client/src/components/Rules/SmartRuleBuilder.tsx`

**New Client Component:**
1. Create PascalCase file in `client/src/components/[Feature]/[Component].tsx`
2. Use React Router's useNavigate(), useParams() for routing
3. Import React Query hook from `client/src/hooks/useApi.ts`
4. Use common components (Button, Card, Modal) from `client/src/components/common/`
5. Style with Tailwind CSS classes
6. Add route to `client/src/App.tsx` Routes section

## Special Directories

**server/data:**
- Purpose: SQLite database file storage location
- Generated: Created by initializeDatabase() if doesn't exist
- Committed: No (in .gitignore)
- Contains: `prunerr.db` (SQLite database file)

**server/dist, client/dist:**
- Purpose: Compiled/built output for production
- Generated: Yes (from TypeScript compiler and Vite bundler)
- Committed: No (in .gitignore)

**node_modules:**
- Purpose: npm package dependencies
- Generated: Yes (by npm install)
- Committed: No (in .gitignore)

**.planning/codebase:**
- Purpose: GSD codebase mapping documentation
- Generated: Yes (by GSD mapping tools)
- Committed: Yes (reference docs)

---

*Structure analysis: 2026-01-22*
