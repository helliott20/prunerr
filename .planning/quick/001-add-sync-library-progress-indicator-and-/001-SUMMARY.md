# Quick Task 001: Add Sync Library Progress Indicator

**Status:** Complete
**Completed:** 2026-01-25

## One-liner

Sync status endpoint with frontend polling replaces unreliable ref-based tracking for accurate completion detection.

## What Changed

### Backend
- Added `GET /api/library/sync/status` endpoint that exposes the existing `syncInProgress` flag
- Endpoint returns `{ success: true, data: { inProgress: boolean } }`
- Route placed before `/:id` route to avoid matching "sync" as an ID

### Frontend API Layer
- Added `getSyncStatus()` to `libraryApi` for polling the new endpoint
- Added `useSyncStatus(enabled: boolean)` hook that polls every 2 seconds when enabled
- Simplified `useSyncLibrary()` by removing timer-based polling delays

### Library Component
- Added `isSyncing` state to track whether a sync is in progress
- Integrated `useSyncStatus` hook that polls only when `isSyncing` is true
- Replaced old ref-based tracking (`syncStartedRef`, `baselineCountRef`) with proper status polling
- Button now shows "Syncing..." text with spinning icon during sync
- Button disabled during sync to prevent concurrent syncs
- Success toast appears only after backend `syncInProgress` becomes false

## Files Modified

| File | Changes |
|------|---------|
| `server/src/routes/library.ts` | Added GET /api/library/sync/status endpoint |
| `client/src/services/api.ts` | Added getSyncStatus() API method |
| `client/src/hooks/useApi.ts` | Added useSyncStatus hook, simplified useSyncLibrary |
| `client/src/components/Library/Library.tsx` | Replaced ref tracking with status polling |

## Commits

| Hash | Description |
|------|-------------|
| f67d657 | feat(quick-001): add sync status endpoint |
| 7c781f7 | feat(quick-001): add sync status API and hook |
| 2b2e603 | feat(quick-001): add sync progress indicator to Library |

## Verification

- [x] GET /api/library/sync/status endpoint returns `{ inProgress: boolean }`
- [x] Sync button shows spinning icon and "Syncing..." text during sync
- [x] Success toast appears only after sync actually completes on backend
- [x] Button is disabled during sync to prevent concurrent syncs
- [x] TypeScript compiles without errors

## Deviations from Plan

None - plan executed exactly as written.

## Technical Notes

The previous implementation used refs (`syncStartedRef`, `baselineCountRef`) and tracked when queries stopped refetching to determine sync completion. This was unreliable because query refetching doesn't correlate with actual backend sync completion.

The new implementation polls the backend's actual `syncInProgress` flag every 2 seconds, giving accurate real-time status. Polling is only enabled when `isSyncing` is true, so there's no overhead when not syncing.
