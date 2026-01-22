# Prunerr

## What This Is

Prunerr is an automated media library management tool for Plex users running home media servers. It integrates with Plex, Sonarr, Radarr, Tautulli, and Overseerr to intelligently identify and clean up unwatched or stale media based on configurable rules. Built for Unraid deployment, it provides a polished web interface for monitoring and controlling automated library maintenance.

## Core Value

Automated library management you can trust because you can *see* what it's doing. Every scheduled task, every flagged item, every deletion decision is transparent and visible.

## Requirements

### Validated

<!-- Shipped and confirmed valuable - existing functionality -->

- ✓ Plex integration — fetch libraries, media items, watch status
- ✓ Sonarr/Radarr integration — series/movie management, file deletion coordination
- ✓ Tautulli integration — watch history and statistics
- ✓ Overseerr integration — request status management
- ✓ Rules engine — configurable conditions for flagging media (watch status, age, size, resolution)
- ✓ Deletion queue — grace period before permanent deletion
- ✓ Deletion history — record of all deletions with metadata
- ✓ Dashboard — overview of library stats and recommendations
- ✓ Library browser — view and filter media items
- ✓ Rule builder — create and manage deletion rules
- ✓ Scheduler — cron-based automated scans and queue processing
- ✓ Docker deployment — containerized for self-hosting

### Active

<!-- Current scope - building toward these for v1.0 -->

**UI Polish:**
- [ ] Human-readable formatting — file sizes (GB not MB), relative dates, large numbers with separators
- [ ] Consistent visual design — spacing, alignment, component styling across all pages
- [ ] Loading and error states — clear feedback when things are loading or fail

**Backend Reliability:**
- [ ] Error handling — graceful failures with helpful messages, no silent errors
- [ ] Edge case handling — partial sync failures, missing services, network timeouts
- [ ] Input validation — proper validation on all API endpoints
- [ ] Timezone handling — consistent date/time calculations across deployments

**Transparency:**
- [ ] Dashboard health indicators — last scan time, next scheduled run, service connection status
- [ ] Activity log — when tasks ran, what they did, any errors encountered
- [ ] Notifications — email/Discord alerts when scans complete or failures occur
- [ ] Rule match visibility — why each item was flagged, which rule matched

**Settings & Customization:**
- [ ] Scheduling controls — configure when scans run, frequency, quiet hours
- [ ] Display preferences — date/time formats, size units, theme options
- [ ] Behavior tuning — grace periods, protection rules, confirmation requirements
- [ ] Service toggles — enable/disable integrations, configure notification channels

**Unraid Deployment:**
- [ ] Unraid template — clean Community Applications install
- [ ] Configuration persistence — settings survive container updates
- [ ] Health checks — container reports healthy when services connected
- [ ] Documentation — clear setup instructions for Unraid users

### Out of Scope

- Mobile app — web interface is sufficient, responsive design for mobile access
- Multi-user accounts — single admin user, runs on trusted home network
- Real-time sync — scheduled polling is sufficient, no WebSocket push needed
- Media playback — this is management only, Plex handles playback
- Cloud hosting — designed for local Unraid deployment only

## Context

**Existing codebase:**
- TypeScript monorepo with server (Express) and client (React/Vite)
- SQLite database with better-sqlite3
- React Query for frontend state management
- Tailwind CSS for styling with custom theme
- Service layer pattern for external integrations
- Rules engine with JSON-based condition evaluation

**Technical state:**
- Core functionality works but needs polish
- Notification service partially implemented
- Some error handling gaps identified in codebase analysis
- No test coverage currently

**See:** `.planning/codebase/` for detailed technical documentation

## Constraints

- **Platform**: Must run reliably on Unraid via Docker
- **Tech stack**: TypeScript, React, Express, SQLite — no major architecture changes
- **Dependencies**: Plex is required; Sonarr/Radarr/Tautulli/Overseerr optional
- **Resources**: Single developer, focus on practical improvements over architectural purity

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite over PostgreSQL | Simpler deployment for home server, adequate for single-user load | — Pending |
| Scheduled polling over real-time | Simpler implementation, media changes aren't time-critical | — Pending |
| Focus on polish over new features | Existing features cover the use case, quality > quantity | — Pending |

---
*Last updated: 2026-01-22 after initialization*
