```markdown
# prunerr Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `prunerr` TypeScript codebase. It covers file organization, code style, commit practices, and the primary workflow for feature development and follow-up bugfixes. This guide is designed to help contributors quickly understand and adopt the established practices in this repository.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `syncCoordinator.ts`, `health.ts`

### Imports
- Use **relative imports** for modules within the project.
  - Example:
    ```typescript
    import { syncLibrary } from '../services/syncCoordinator';
    ```

### Exports
- Prefer **named exports** over default exports.
  - Example:
    ```typescript
    // In syncCoordinator.ts
    export function syncLibrary() { ... }
    ```

### Commit Messages
- Follow **conventional commit** style.
- Use prefixes such as `feat` for features and `fix` for bugfixes.
- Keep commit messages concise (average ~40 characters).
  - Example:
    ```
    feat: add scheduled task for library sync
    fix: correct sync task scheduling logic
    ```

## Workflows

### Feature Development with Follow-Up Bugfix
**Trigger:** When implementing a new cross-cutting feature (e.g., scheduled task) that affects both backend and frontend, followed by a quick bugfix or refinement.
**Command:** `/feature-with-followup`

1. **Implement the new feature:**
   - Update backend logic, API routes, client components, and shared types.
     ```typescript
     // server/src/scheduler/tasks.ts
     export function scheduleLibrarySync() { ... }

     // client/src/components/Dashboard/Dashboard.tsx
     import { useLibrarySyncStatus } from '../../api/library';
     ```
   - Add or update scheduled tasks and service coordination logic.
     ```typescript
     // server/src/services/syncCoordinator.ts
     export function syncLibrary() { ... }
     ```
   - Expose new data or controls in frontend settings and dashboard.
     ```tsx
     // client/src/components/Settings/Settings.tsx
     <Toggle label="Enable Scheduled Sync" ... />
     ```
   - Update API health/status endpoints to reflect the new feature state.
     ```typescript
     // server/src/routes/health.ts
     router.get('/health', (req, res) => {
       res.json({ syncStatus: getSyncStatus() });
     });
     ```

2. **Shortly after, make a follow-up commit:**
   - Fix bugs, tighten logic, or address review findings.
   - Touch many of the same files as the initial feature commit.
     ```typescript
     // server/src/scheduler/tasks.ts
     // Fix: ensure task does not double-schedule
     ```

**Files commonly involved:**
- `client/src/components/Dashboard/Dashboard.tsx`
- `client/src/components/Settings/Settings.tsx`
- `client/src/types/index.ts`
- `server/src/routes/health.ts`
- `server/src/routes/library.ts`
- `server/src/routes/settings.ts`
- `server/src/scheduler/tasks.ts`
- `server/src/services/syncCoordinator.ts`

**Frequency:** ~1-2 times per month

## Testing Patterns

- Test files use the pattern `*.test.*` (e.g., `syncCoordinator.test.ts`).
- The specific testing framework is unknown, but tests are colocated with or near the code they test.
- Example:
  ```typescript
  // server/src/services/syncCoordinator.test.ts
  import { syncLibrary } from './syncCoordinator';

  test('syncLibrary schedules correctly', () => {
    // test implementation
  });
  ```

## Commands

| Command                 | Purpose                                                      |
|-------------------------|--------------------------------------------------------------|
| /feature-with-followup  | Start a new feature with a follow-up bugfix or refinement.   |
```
