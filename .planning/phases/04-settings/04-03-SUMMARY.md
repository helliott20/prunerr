---
phase: 04-settings
plan: 03
subsystem: settings-backup
tags: ["settings", "import", "export", "backup", "json"]

# Dependency Graph
requires:
  - "04-01"  # Settings page foundation
  - "04-02"  # Display preferences
provides:
  - "Settings export as JSON file"
  - "Settings import with validation"
  - "Backup and restore UI section"
affects: []

# Tech Tracking
tech-stack:
  added: []
  patterns:
    - "File download via blob URL"
    - "File upload with confirmation dialog"
    - "JSON schema validation with Zod"

# File Tracking
key-files:
  created: []
  modified:
    - "server/src/routes/settings.ts"
    - "client/src/hooks/useApi.ts"
    - "client/src/components/Settings/Settings.tsx"

# Decisions
decisions:
  - id: "export-format"
    choice: "JSON with metadata"
    why: "Includes version, exportedAt, and appName for validation and compatibility"
  - id: "import-validation"
    choice: "Zod schema validation"
    why: "Consistent with existing API patterns, provides detailed error messages"
  - id: "import-confirmation"
    choice: "Inline warning dialog"
    why: "Clear warning about overwriting without requiring modal component"

# Metrics
metrics:
  duration: "~2 minutes"
  completed: "2026-01-24"
---

# Phase 04 Plan 03: Settings Import/Export Summary

JSON settings export/import with Zod validation and confirmation UI

## What Was Built

### Backend Endpoints (server/src/routes/settings.ts)

**GET /api/settings/export**
- Returns all settings as downloadable JSON file
- Includes metadata: version (1), exportedAt timestamp, appName (Prunerr)
- Sets Content-Disposition header for file download

**POST /api/settings/import**
- Validates incoming JSON against Zod schema
- Applies settings using setMultiple repository method
- Refreshes and reinitializes services after import
- Returns count of imported settings

### Frontend Hook (client/src/hooks/useApi.ts)

**useImportSettings()**
- Mutation hook for POST /api/settings/import
- Invalidates settings query cache on success
- Handles error responses with detailed messages

### Settings UI (client/src/components/Settings/Settings.tsx)

**Backup & Restore Section**
- Export button: Downloads prunerr-settings.json via blob URL
- Import button: Hidden file input with .json filter
- Confirmation dialog with warning about overwriting
- Success/error state display after import
- Security note about credential handling

## Technical Details

### Export Format
```json
{
  "version": 1,
  "exportedAt": "2026-01-24T10:42:50Z",
  "appName": "Prunerr",
  "settings": {
    "plex_url": "http://...",
    "plex_token": "..."
  }
}
```

### Import Validation Schema
```typescript
const ImportSettingsSchema = z.object({
  version: z.number(),
  exportedAt: z.string(),
  appName: z.string().optional(),
  settings: z.record(z.string(), z.string()),
});
```

### File Download Pattern
```typescript
const response = await fetch('/api/settings/export');
const blob = await response.blob();
const url = URL.createObjectURL(blob);
// Create temporary anchor element for download
```

## Commits

| Hash | Message |
|------|---------|
| 5ed4a2e | feat(04-03): add settings export and import endpoints |
| 238c944 | feat(04-03): add Import/Export section to Settings UI |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- Server compiles without errors
- Client builds successfully (476.73 kB bundle)
- Export endpoint returns JSON with version, exportedAt, settings
- Import endpoint validates and applies settings
- UI shows Backup & Restore section with Export/Import buttons

## Next Phase Readiness

Phase 04 (Settings) is now complete. All three plans executed:
- 04-01: Settings page foundation with service connections
- 04-02: Display preferences with localStorage persistence
- 04-03: Settings import/export functionality

Ready to proceed to Phase 05 (Polish & Performance) or Phase 06 (Documentation).
