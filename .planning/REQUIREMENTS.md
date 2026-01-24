# Prunerr Requirements

## v1 Requirements

### Visual Formatting

- [x] **VIS-01**: User sees file sizes in human-readable format (e.g., "2.4 GB" not "2400000000 bytes")
- [x] **VIS-02**: User sees relative dates (e.g., "2 hours ago" not raw timestamps)

### Loading & Error States

- [x] **UX-01**: User sees skeleton loading states while data loads (prevents layout shift)
- [x] **UX-02**: User sees helpful error messages explaining what went wrong and suggested actions
- [x] **UX-03**: User sees empty states with guidance when no items match filters or first-use scenarios

### Health & Status Indicators

- [x] **HEALTH-01**: User sees service connection status indicators for Plex/Sonarr/Radarr/Tautulli/Overseerr
- [x] **HEALTH-02**: User sees last scan timestamp displayed prominently on dashboard
- [x] **HEALTH-03**: User sees next scheduled run time displayed on dashboard

### Activity Logging

- [x] **LOG-01**: User can view timestamped activity log showing system actions in reverse chronological order
- [x] **LOG-02**: User can distinguish automated actions from manual user actions in the activity log
- [x] **LOG-03**: User can view permanent audit trail of all deletions including what was deleted, when, and why

### Notifications

- [x] **NOTIFY-01**: User can configure Discord webhook URL in settings and receive notifications for scan completions and errors

### Settings

- [x] **SET-01**: User can configure scan schedules (when scans run, frequency)
- [x] **SET-02**: User can configure display preferences (date/time format, file size units)
- [x] **SET-03**: User can export settings to JSON file and import settings from JSON file

### Unraid Deployment

- [x] **UNRAID-01**: App provides Unraid Community Applications XML template for clean installation
- [x] **UNRAID-02**: User settings and data persist across container updates via proper volume mapping
- [x] **UNRAID-03**: Container reports health status based on service connectivity for Unraid dashboard

---

## v2 Requirements (Deferred)

### Visual Formatting
- Number formatting with locale-appropriate separators (1,234,567)
- User-configurable date format preference (US/EU/ISO)

### Error Handling
- API timeout handling with graceful degradation and "last updated" indicators
- Error logging with detailed context ("Failed to connect to Sonarr: timeout after 30s")

### Health Indicators
- Consolidated health indicator showing single "all systems healthy" or "issues detected" status

### Notifications
- Email notification channel
- Notification severity levels (errors only vs all events)
- Digest mode for daily summary instead of real-time alerts

### Settings
- Behavior tuning (grace periods, protection rules, confirmation requirements)

---

## Out of Scope

- **Dry run mode / confirmation dialogs / rule match visibility** — Existing deletion queue with grace period provides sufficient safety net
- **Setup documentation** — Defer to README and inline Unraid template notes
- **Mobile app** — Web interface is responsive, sufficient for mobile access
- **Multi-user accounts** — Single admin user, runs on trusted home network
- **Real-time sync** — Scheduled polling is sufficient for media changes
- **Media playback** — Plex handles playback, this is management only

---

## Requirement Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| VIS-01 | Phase 1: UI Polish | Complete |
| VIS-02 | Phase 1: UI Polish | Complete |
| UX-01 | Phase 1: UI Polish | Complete |
| UX-02 | Phase 1: UI Polish | Complete |
| UX-03 | Phase 1: UI Polish | Complete |
| HEALTH-01 | Phase 3: Health Indicators | Complete |
| HEALTH-02 | Phase 3: Health Indicators | Complete |
| HEALTH-03 | Phase 3: Health Indicators | Complete |
| LOG-01 | Phase 2: Activity Logging | Complete |
| LOG-02 | Phase 2: Activity Logging | Complete |
| LOG-03 | Phase 2: Activity Logging | Complete |
| NOTIFY-01 | Phase 5: Notifications | Complete |
| SET-01 | Phase 4: Settings | Complete |
| SET-02 | Phase 4: Settings | Complete |
| SET-03 | Phase 4: Settings | Complete |
| UNRAID-01 | Phase 6: Unraid Deployment | Complete |
| UNRAID-02 | Phase 6: Unraid Deployment | Complete |
| UNRAID-03 | Phase 6: Unraid Deployment | Complete |

---

*Created: 2026-01-22*
*18 v1 requirements across 7 categories*
*Traceability updated: 2026-01-24*
