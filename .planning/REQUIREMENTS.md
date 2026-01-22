# Prunerr Requirements

## v1 Requirements

### Visual Formatting

- [ ] **VIS-01**: User sees file sizes in human-readable format (e.g., "2.4 GB" not "2400000000 bytes")
- [ ] **VIS-02**: User sees relative dates (e.g., "2 hours ago" not raw timestamps)

### Loading & Error States

- [ ] **UX-01**: User sees skeleton loading states while data loads (prevents layout shift)
- [ ] **UX-02**: User sees helpful error messages explaining what went wrong and suggested actions
- [ ] **UX-03**: User sees empty states with guidance when no items match filters or first-use scenarios

### Health & Status Indicators

- [ ] **HEALTH-01**: User sees service connection status indicators for Plex/Sonarr/Radarr/Tautulli/Overseerr
- [ ] **HEALTH-02**: User sees last scan timestamp displayed prominently on dashboard
- [ ] **HEALTH-03**: User sees next scheduled run time displayed on dashboard

### Activity Logging

- [ ] **LOG-01**: User can view timestamped activity log showing system actions in reverse chronological order
- [ ] **LOG-02**: User can distinguish automated actions from manual user actions in the activity log
- [ ] **LOG-03**: User can view permanent audit trail of all deletions including what was deleted, when, and why

### Notifications

- [ ] **NOTIFY-01**: User can configure Discord webhook URL in settings and receive notifications for scan completions and errors

### Settings

- [ ] **SET-01**: User can configure scan schedules (when scans run, frequency)
- [ ] **SET-02**: User can configure display preferences (date/time format, file size units)
- [ ] **SET-03**: User can export settings to JSON file and import settings from JSON file

### Unraid Deployment

- [ ] **UNRAID-01**: App provides Unraid Community Applications XML template for clean installation
- [ ] **UNRAID-02**: User settings and data persist across container updates via proper volume mapping
- [ ] **UNRAID-03**: Container reports health status based on service connectivity for Unraid dashboard

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
| VIS-01 | Phase 1: UI Polish | Pending |
| VIS-02 | Phase 1: UI Polish | Pending |
| UX-01 | Phase 1: UI Polish | Pending |
| UX-02 | Phase 1: UI Polish | Pending |
| UX-03 | Phase 1: UI Polish | Pending |
| HEALTH-01 | Phase 3: Health Indicators | Pending |
| HEALTH-02 | Phase 3: Health Indicators | Pending |
| HEALTH-03 | Phase 3: Health Indicators | Pending |
| LOG-01 | Phase 2: Activity Logging | Pending |
| LOG-02 | Phase 2: Activity Logging | Pending |
| LOG-03 | Phase 2: Activity Logging | Pending |
| NOTIFY-01 | Phase 5: Notifications | Pending |
| SET-01 | Phase 4: Settings | Pending |
| SET-02 | Phase 4: Settings | Pending |
| SET-03 | Phase 4: Settings | Pending |
| UNRAID-01 | Phase 6: Unraid Deployment | Pending |
| UNRAID-02 | Phase 6: Unraid Deployment | Pending |
| UNRAID-03 | Phase 6: Unraid Deployment | Pending |

---

*Created: 2026-01-22*
*18 v1 requirements across 7 categories*
*Traceability updated: 2026-01-22*
