# Testing Patterns

**Analysis Date:** 2026-01-22

## Test Framework

**Status:** No testing framework currently configured

**Runner:** Not present
- Neither server nor client has jest, vitest, mocha, or chai in dependencies
- No test configuration files detected (jest.config.js, vitest.config.ts, etc.)

**Assertion Library:** Not present

**Run Commands:** Not defined
- Server has no test script defined
- Client has no test script defined
- `npm test` would fail if invoked in either workspace

## Test File Organization

**Current State:** No test files exist in the project

**Detection Search:**
- Searched for `*.test.*` and `*.spec.*` files in project root and workspaces
- No test files found in `server/src` or `client/src`
- No `__tests__` directories present

**Recommended Future Pattern:**
- **Location:** Co-located with source files
  - `src/services/plex.ts` → `src/services/plex.test.ts`
  - `src/components/Library/Library.tsx` → `src/components/Library/Library.test.tsx`

- **Naming:** `.test.ts` or `.spec.ts` suffix
  - Prefer `.test.ts` for consistency with common patterns

**Structure:**
```
server/src/
├── services/
│   ├── plex.ts
│   └── plex.test.ts
├── routes/
│   ├── media.ts
│   └── media.test.ts
└── db/
    ├── repositories/
    │   └── mediaItems.ts

client/src/
├── components/
│   └── Library/
│       ├── Library.tsx
│       └── Library.test.tsx
└── hooks/
    ├── useApi.ts
    └── useApi.test.ts
```

## Test Structure

**Current Codebase Analysis:**

No existing test patterns to document. However, the codebase structure suggests tests should follow these patterns:

**Recommended Suite Organization:**
```typescript
// Example for server route handler (server/src/routes/media.test.ts)
describe('Media Routes', () => {
  describe('GET /api/media', () => {
    it('should return paginated media items', () => {
      // Test implementation
    });

    it('should filter by type', () => {
      // Test implementation
    });

    it('should handle invalid query parameters', () => {
      // Test implementation
    });
  });

  describe('GET /api/media/stats', () => {
    it('should return media statistics', () => {
      // Test implementation
    });
  });
});
```

**Recommended Patterns for Async/Promise Handling:**
```typescript
// For async operations (currently using try-catch in production code)
it('should scan libraries and flag items', async () => {
  const result = await scanLibraries();
  expect(result.success).toBe(true);
  expect(result.itemsFlagged).toBeGreaterThan(0);
});

// For database operations
it('should update media item status', async () => {
  await mediaItemsRepo.updateStatus(1, 'flagged');
  const item = await mediaItemsRepo.getById(1);
  expect(item.status).toBe('flagged');
});
```

## Mocking

**Framework:** Would require vitest or jest (not yet installed)

**Recommended Approach for Codebase:**

**Service Mocking:**
```typescript
// Mock Plex service for deletion tests
const mockPlexService = {
  getLibraries: vi.fn().mockResolvedValue([...]),
  getMediaItems: vi.fn().mockResolvedValue([...]),
  deleteFile: vi.fn().mockResolvedValue(true),
};
```

**Repository Mocking:**
```typescript
// Mock database for service tests
const mockMediaItemRepository = {
  getAll: vi.fn().mockReturnValue([...]),
  update: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};
```

**HTTP Client Mocking:**
- Current code uses `axios` for external API calls
- Mock with interceptors or mock adapter:
```typescript
import MockAdapter from 'axios-mock-adapter';
const mock = new MockAdapter(axios);
mock.onGet('/api/plex/libraries').reply(200, { libraries: [...] });
```

**What to Mock:**
- External API calls (Plex, Sonarr, Radarr, Overseerr, Unraid, Tautulli)
- Database operations (all repository methods)
- File system operations
- Email notifications (nodemailer)
- Winston logger calls

**What NOT to Mock:**
- Zod validation schemas (test with real validation)
- Error handling logic
- Business rule evaluation in RulesEngine
- Date/time calculations in conditions.ts (may use `vi.useFakeTimers()` instead)
- Winston logger itself (use transports to capture in tests)

## Fixtures and Factories

**Current State:** No fixtures or factory functions exist

**Recommended Pattern:**

**Test Data Builders:**
```typescript
// In server/src/__tests__/fixtures/media-items.ts
export function createMediaItem(overrides?: Partial<MediaItem>): MediaItem {
  return {
    id: 1,
    type: 'movie',
    title: 'Test Movie',
    plex_id: 'plex-123',
    sonarr_id: null,
    radarr_id: null,
    tmdb_id: 550,
    imdb_id: 'tt0137523',
    tvdb_id: null,
    year: 1999,
    poster_url: 'https://example.com/poster.jpg',
    file_path: '/media/movies/fight-club.mkv',
    file_size: 2147483648,
    resolution: '1080p',
    codec: 'h264',
    added_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    last_watched_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    play_count: 1,
    watched_by: JSON.stringify(['user1']),
    status: 'monitored',
    marked_at: null,
    delete_after: null,
    is_protected: false,
    protection_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createRule(overrides?: Partial<Rule>): Rule {
  return {
    id: 1,
    name: 'Delete Unwatched',
    profile_id: null,
    type: 'watch_status',
    conditions: JSON.stringify([
      { field: 'last_watched_at', operator: 'greater_than', value: 90 },
    ]),
    action: 'flag',
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
```

**Location:** `server/__tests__/fixtures/`, `client/src/__tests__/fixtures/`

## Coverage

**Requirements:** Not enforced
- No coverage configuration found
- No minimum threshold set

**Recommended Configuration (once framework is installed):**
```javascript
// vitest.config.ts (recommended)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.config.*',
        '**/__tests__/**',
      ],
    },
  },
});
```

**View Coverage (once implemented):**
```bash
npm run test:coverage     # Generate coverage report
npm run test:coverage:ui  # View in browser (if configured)
```

## Test Types

**Unit Tests (Recommended):**
- **Scope:** Individual functions and utilities
- **Examples to test:**
  - `server/src/rules/conditions.ts` functions:
    - `evaluateNotWatchedDays()`
    - `parseResolution()`
    - `bytesToGB()`
    - `extendMediaItem()`
  - `server/src/utils/logger.ts` custom format function
  - Repository methods: `getAllMediaItems()`, `updateStatus()`
  - React hooks: `useDebounce()`, custom validation hooks
  - API client functions in `client/src/services/api.ts`

- **Approach:** Mock external dependencies, test input/output contracts

**Integration Tests (Recommended):**
- **Scope:** Multiple components/services working together
- **Examples to test:**
  - Rule engine with condition evaluation (`server/src/rules/engine.ts`)
  - Media scanning flow: Plex service → repository → rule engine
  - Deletion queue processing: queue items → deletion service → history
  - API routes with real(mocked) database:
    - `POST /api/media` creates item and validates
    - `PUT /api/rules/:id` updates and notifies changes
  - React components with hooks: `useLibrary` + `Library` component

- **Approach:** Use real/mocked database layer, mock external APIs

**E2E Tests (Not yet implemented):**
- **Framework:** Not present
- **Recommendation:** Add Playwright or Cypress if needed
- **Scope:** Full user workflows through UI
- **Examples:**
  - Log in → navigate library → mark item for deletion → process queue
  - Create rule → sync library → verify items flagged

## Common Patterns

**Async Testing (Once Framework is Added):**

For testing async functions and promises, use vitest/jest patterns:

```typescript
// Using async/await
it('should fetch media items', async () => {
  const items = await libraryApi.getItems({ page: 1 });
  expect(items.length).toBeGreaterThan(0);
});

// Using return promise
it('should mark item for deletion', () => {
  return libraryApi.markForDeletion('123').then(result => {
    expect(result.success).toBe(true);
  });
});

// Using promise chaining with mocks
it('should create notification on deletion', () => {
  const notifySpy = vi.spyOn(notificationService, 'notify');
  return queueApi.deleteNow('123').then(() => {
    expect(notifySpy).toHaveBeenCalledWith('deletion_complete', expect.any(Object));
  });
});
```

**Error Testing:**

```typescript
// Testing error conditions
it('should return validation error for invalid input', () => {
  const result = CreateMediaItemSchema.safeParse({ type: 'invalid' });
  expect(result.success).toBe(false);
  expect(result.error.issues).toBeDefined();
});

// Testing exception handling
it('should handle Plex API errors gracefully', async () => {
  mockPlexService.getLibraries.mockRejectedValueOnce(new Error('Connection refused'));
  const result = await scanLibraries();
  expect(result.success).toBe(false);
  expect(result.error).toContain('failed');
});

// Testing error logging
it('should log errors with context', async () => {
  const loggerSpy = vi.spyOn(logger, 'error');
  await mediaItemsRepo.update(999, { status: 'deleted' });
  expect(loggerSpy).toHaveBeenCalledWith(
    expect.stringContaining('Failed'),
    expect.any(Error)
  );
});
```

## Pre-Test Setup Recommendation

Once a testing framework is installed, configure:

1. **Setup Files:**
   - `vitest.setup.ts` or `jest.setup.ts` for global mocks and configuration
   - Mock process.env for database URLs, API keys
   - Mock timers for date-dependent tests

2. **Database Testing:**
   - Use in-memory SQLite (better-sqlite3 already in dependencies) for tests
   - Run migrations before tests
   - Clear/reset database between tests

3. **Install Testing Dependencies:**
   ```bash
   npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/dom ts-node
   # OR
   npm install --save-dev jest @types/jest ts-jest @testing-library/react
   ```

---

*Testing analysis: 2026-01-22*
