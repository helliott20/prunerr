# Coding Conventions

**Analysis Date:** 2026-01-22

## Naming Patterns

**Files:**
- Lowercase with hyphens for multi-word names (e.g., `media-items.ts`, `deletion-options.tsx`)
- Component files use PascalCase (e.g., `Library.tsx`, `MediaCard.tsx`, `Button.tsx`)
- Utility/hook files use camelCase (e.g., `useApi.ts`, `logger.ts`)
- Type definition files: `index.ts` in type directories
- Repository files follow entity name: `mediaItems.ts`, `rules.ts`, `settings.ts`

**Functions:**
- camelCase for all function and method names
- Async functions prefixed with verb when applicable: `scanLibraries()`, `processDeletionQueue()`, `fetchItems()`
- Utility functions are descriptive: `extendMediaItem()`, `evaluateNotWatchedDays()`, `bytesToGB()`
- React hooks use `use` prefix: `useApi`, `useDebounce`, `useStats`, `useLibrary`
- Private/internal functions use leading underscore: `_validateCondition()`, but not required

**Variables:**
- camelCase for all variables and constants
- Constants use UPPER_SNAKE_CASE only for truly global/unchanging values: `DEFAULT_PROTECTION_CONFIG`, `DEFAULT_RULES_CONFIG`
- State variables in React match their updater: `[searchInput, setSearchInput]`, `[selectedIds, setSelectedIds]`
- Type unions for UI states: `type ViewMode = 'table' | 'grid'`, `type MediaType = 'all' | 'movie' | 'tv'`

**Types:**
- Interfaces for object shapes: `interface PlexLibrary`, `interface MediaItem`, `interface Rule`
- Type unions for discrete values: `type MediaType = 'movie' | 'show' | 'episode'`
- Generic interfaces with `T`: `interface PaginatedResponse<T>`
- Interface names are PascalCase and describe the entity
- Input/Output interfaces: `CreateMediaItemInput`, `UpdateMediaItemInput`, `DeletionHistoryEntry`
- Schema interfaces: `PlexXmlContainer`, `PlexXmlVideo` for parsed XML structures

**Imports:**
- Order: standard library → third-party → relative imports with type imports separated
- Example from `server/src/routes/media.ts`:
  ```typescript
  import { Router, Request, Response, NextFunction } from 'express';
  import { z } from 'zod';
  import mediaItemsRepo from '../db/repositories/mediaItems';
  import { CreateMediaItemSchema, UpdateMediaItemSchema } from '../types';
  import logger from '../utils/logger';
  ```

## Code Style

**Formatting:**
- No explicit formatter configured (no .prettier config or .eslintrc found in project root)
- 2-space indentation observed throughout codebase
- Line length follows natural code flow (not enforced limit detected)
- Semicolons used consistently at end of statements
- Trailing commas in multi-line arrays/objects

**Linting:**
- ESLint configured with TypeScript support (`@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`)
- ESLint config: `eslint: ^9.39.2`, `@typescript-eslint/*: ^8.53.1`
- React hooks linting enabled via `eslint-plugin-react-hooks`
- Max warnings: 0 enforced in client build: `eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0`
- No custom ESLint config file detected (using default configuration)

**TypeScript:**
- Strict mode enabled: `"strict": true`
- Target: ES2022
- Module: NodeNext
- Force consistent casing and explicit type declarations required
- Declaration maps enabled for source mapping

## Import Organization

**Order:**
1. Node.js built-in modules (`dotenv`, `path`, `express`)
2. Third-party packages (`axios`, `cors`, `helmet`, `zod`)
3. Type imports from third-party (`import type { ... } from '@tanstack/react-query'`)
4. Relative imports from utils (`./utils/logger`)
5. Relative imports from types (`./types`, `../types`)
6. Relative imports from services/components

**Path Aliases:**
- `@/` alias used in client for absolute imports from `src/` (e.g., `@/components/Layout`, `@/hooks/useApi`, `@/services/api`)
- Server uses relative paths exclusively (no alias config detected)

## Error Handling

**Patterns:**
- Try-catch blocks wrapping async operations and API calls
- Errors logged to Winston logger with context: `logger.error('Failed to start server:', error)`
- HTTP routes catch errors and respond with consistent JSON format:
  ```typescript
  {
    success: false,
    error: 'Error message',
    details?: ValidationError[] // For validation errors
  }
  ```
- Null checks before operations: `if (!item) return []`
- Optional chaining and nullish coalescing used: `filters?.limit ?? 50`
- Zod validation for request bodies with detailed error reporting:
  ```typescript
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: result.error.issues,
    });
  }
  ```

**Global Error Handler:**
- Express global error handler in `server/src/index.ts` (lines 90-112)
- Catches unhandled errors with status code extraction
- Returns different messages in production vs development
- Includes stack trace in non-production environments

## Logging

**Framework:** Winston logger (`winston: ^3.19.0`)
- Configured in `server/src/utils/logger.ts`
- Log levels: info, warn, error, debug, http
- Timestamp format: `YYYY-MM-DD HH:mm:ss`
- Metadata included in all logs: `{ service: 'prunerr' }`
- File transports in production (error.log, combined.log) with rotation (5MB max, 5 file limit)
- Console output with color in development

**Patterns:**
- Log startup information: `logger.info('Server started successfully')`
- Log errors with context: `logger.error('Failed to get media items:', error)`
- Log debug info for rule evaluation: `logger.debug('Item "${item.title}" last watched ${daysSince} days ago')`
- HTTP request logging via morgan middleware (skips /api/health/ping)

## Comments

**When to Comment:**
- JSDoc comments for exported functions and complex logic
- Block separators for major sections (e.g., `// ============================================================================`)
- Inline comments only for non-obvious intent
- Comments explain the "why", not the "what"

**JSDoc/TSDoc:**
- Used for exported functions and class methods
- Example from `server/src/rules/conditions.ts`:
  ```typescript
  /**
   * Calculate the number of days between two dates
   */
  function daysBetween(date1: Date, date2: Date): number {
  ```
- Parameter and return type documentation for complex functions

## Function Design

**Size:**
- Most functions 20-100 lines
- Larger functions (200-700 lines) exist in route handlers and services but well-organized with internal helper functions
- Example: `server/src/routes/rules.ts` is 896 lines but handles complete CRUD with nested logic

**Parameters:**
- Explicit typed parameters (no implicit `any`)
- Object destructuring for multiple related parameters: `{ id, options }` in mutations
- Optional parameters using `?`: `limit?: number`, `gracePeriodDays?: number`

**Return Values:**
- Explicit return types for all functions
- Async functions return `Promise<T>`
- Nullable returns with type union: `Promise<T | null>`
- Array returns: `Promise<MediaItem[]>`
- Objects with success flag:
  ```typescript
  {
    success: boolean;
    data?: T;
    error?: string;
  }
  ```

## Module Design

**Exports:**
- Named exports for utilities and functions: `export function daysBetween()`
- Default exports for main components: `export default App`
- Mixed exports in API files:
  ```typescript
  export const dashboardApi = { getStats, getRecentActivity, ... }
  export function useStats() { ... }
  ```

**Barrel Files:**
- Used in client: `src/components/` has implicit barrel pattern through imports
- Used in server: `src/services/index.ts` exports service instances
- Type definitions in `src/types/index.ts` consolidate all base types

**Repositories Pattern:**
- Database access centralized in `server/src/db/repositories/`
- Each repository (`mediaItems.ts`, `rules.ts`) exports named functions
- Row-to-entity mapping functions (e.g., `rowToMediaItem`) handle database type conversion
- No class-based repositories; functional approach with pure functions

---

*Convention analysis: 2026-01-22*
