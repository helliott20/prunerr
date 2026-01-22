# Technology Stack

**Analysis Date:** 2026-01-22

## Languages

**Primary:**
- TypeScript 5.9.3 - Used in both server and client
- JavaScript (ES2022) - Runtime target

**Markup & Styling:**
- HTML - Client templates via React/Vite
- CSS/Tailwind CSS 3.4.19 - Client styling via utility classes

## Runtime

**Environment:**
- Node.js 18.0.0+ (required)

**Package Manager:**
- npm (with workspaces monorepo support)
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core Backend:**
- Express.js 5.2.1 - HTTP server and API framework
  - Location: `server/src/index.ts`
  - Provides routing, middleware, static file serving

**Core Frontend:**
- React 18.3.1 - UI library
- Vite 7.3.1 - Build tool and dev server
  - Config: `client/vite.config.ts`
  - Alias: `@` resolves to `client/src`
  - Dev proxy: `/api` routes to `http://localhost:3000`

**Frontend UI:**
- Tailwind CSS 3.4.19 - Utility-first CSS framework
  - Config: `client/tailwind.config.js`
  - Custom theme with accent (amber), surface (slate), ruby, emerald, violet, cyan colors
  - Custom animations: fade-in, fade-up, scale-in, slide-left/right, pulse-glow, shimmer, float

**Routing:**
- React Router v7.12.0 - Client-side routing

## Key Dependencies

**Backend - HTTP/Networking:**
- axios 1.13.2 - HTTP client for service integrations
- cors 2.8.5 - Cross-origin resource sharing
- helmet 8.1.0 - HTTP security headers
- morgan 1.10.1 - HTTP request logging middleware

**Backend - Database:**
- better-sqlite3 12.6.2 - SQLite database (synchronous)
  - Location: `server/src/db/index.ts`
  - Mode: WAL (Write-Ahead Logging) for concurrent access
  - Foreign keys enabled

**Backend - Data Processing:**
- fast-xml-parser 5.3.3 - XML parsing for Plex API responses
- zod 4.3.5 - TypeScript-first schema validation

**Backend - Scheduling:**
- node-cron 4.2.1 - Cron job scheduler for automated tasks
  - Location: `server/src/scheduler/`

**Backend - Notifications:**
- nodemailer 7.0.12 - Email sending via SMTP
  - Location: `server/src/notifications/index.ts`

**Backend - Logging:**
- winston 3.19.0 - Structured logging
  - Location: `server/src/utils/logger.ts`

**Backend - Configuration:**
- dotenv 17.2.3 - Environment variable loading
  - Loads from `.env` in project root or parent directories

**Frontend - State Management:**
- @tanstack/react-query 5.90.19 - Server state management and caching
  - Location: `client/src/hooks/useApi.ts`
  - Implements query deduplication and caching

**Frontend - HTTP:**
- axios 1.13.2 - API requests to backend

**Frontend - Utilities:**
- date-fns 4.1.0 - Date manipulation and formatting
- clsx 2.1.1 - Conditional CSS class names
- tailwind-merge 3.4.0 - Merge Tailwind classes intelligently
- lucide-react 0.562.0 - Icon component library

## Build & Dev Tools

**TypeScript:**
- typescript 5.9.3 - Type checking and transpilation
- Server: `server/tsconfig.json` - commonjs output
- Client: `client/tsconfig.json` - esm output

**Linting:**
- ESLint 9.39.2 - JavaScript/TypeScript linting
- @typescript-eslint/parser 8.53.1 - TypeScript support
- @typescript-eslint/eslint-plugin 8.53.1 - TypeScript rules
- eslint-plugin-react-hooks 7.0.1 - React hooks best practices
- eslint-plugin-react-refresh 0.4.26 - React Fast Refresh validation

**Build Processors:**
- @vitejs/plugin-react 5.1.2 - React JSX support for Vite
- postcss 8.5.6 - CSS post-processor
- autoprefixer 10.4.23 - Add vendor prefixes to CSS

**Dev Utilities:**
- tsx 4.21.0 - TypeScript execution for Node.js
  - Used for `npm run dev:server` with hot reload
- concurrently 9.2.1 - Run multiple npm scripts in parallel
  - Used to run server and client simultaneously with `npm run dev`

## Configuration Files

**Root Level:**
- `tsconfig.json` - Shared TypeScript config for monorepo

**Environment:**
- `.env` - Runtime environment variables (git-ignored)
- `.env.example` - Template with all available configuration options
- Variables are loaded by dotenv at server startup

**Build & Formatting:**
- `client/vite.config.ts` - Vite bundler configuration
- `client/tailwind.config.js` - Tailwind CSS theme and extensions
- `.eslintrc` files in workspace subdirectories (inherited pattern)

**Docker:**
- `Dockerfile` - Production container image
- `docker-compose.yml` - Production container orchestration
- `docker-compose.dev.yml` - Development container setup
- `.dockerignore` - Files to exclude from Docker context

## Platform Requirements

**Development:**
- Node.js >= 18.0.0
- npm 8+ (for workspaces)
- SQLite 3.x (built into better-sqlite3)
- SMTP server access (for email notifications, optional)

**Production:**
- Node.js >= 18.0.0
- Docker (recommended) or bare Node.js runtime
- SQLite database file location: `/app/data/prunerr.db` (configurable)
- Access to Plex API (required) and optional Sonarr/Radarr/Tautulli/Overseerr/Unraid services

**Port Requirements:**
- Server: 3000 (configurable via `PORT` env var)
- Client dev: 5173 (Vite default)

---

*Stack analysis: 2026-01-22*
