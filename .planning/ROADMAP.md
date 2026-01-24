# Roadmap: Prunerr

## Overview

This roadmap transforms Prunerr from functional to production-ready through six phases of polish and infrastructure work. The journey starts with foundational UI polish (formatting, loading states), builds transparency infrastructure (activity logging, health indicators), adds user configurability (settings, notifications), and concludes with deployment packaging for Unraid. Each phase delivers user-visible value while building toward the core promise: automated library management you can trust because you can see what it's doing.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: UI Polish** - Human-readable formatting, loading states, error handling, empty states
- [x] **Phase 2: Activity Logging** - Activity log infrastructure with action attribution and deletion audit trail
- [x] **Phase 3: Health Indicators** - Service connection status, scan timestamps, scheduled run display
- [x] **Phase 4: Settings** - Scheduling configuration, display preferences, settings import/export
- [ ] **Phase 5: Notifications** - Discord webhook integration for scan completions and errors
- [ ] **Phase 6: Unraid Deployment** - Community Applications template, persistence, container health checks

## Phase Details

### Phase 1: UI Polish
**Goal**: User sees a professional, polished interface with clear feedback during all interactions
**Depends on**: Nothing (first phase)
**Requirements**: VIS-01, VIS-02, UX-01, UX-02, UX-03
**Success Criteria** (what must be TRUE):
  1. User sees file sizes displayed as "2.4 GB" instead of bytes throughout the application
  2. User sees dates displayed as "2 hours ago" or "3 days ago" instead of raw timestamps
  3. User sees skeleton placeholders while data loads (no layout shift when content appears)
  4. User sees descriptive error messages with suggested actions when operations fail
  5. User sees helpful empty states with guidance when no items match filters or on first use
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Add error state handling to all views with retry support
- [x] 01-02-PLAN.md — Standardize empty states with contextual messaging and actions

### Phase 2: Activity Logging
**Goal**: User has complete visibility into what the system is doing and has done
**Depends on**: Phase 1 (uses consistent UI components and formatting)
**Requirements**: LOG-01, LOG-02, LOG-03
**Success Criteria** (what must be TRUE):
  1. User can view a timestamped activity log showing system actions in reverse chronological order
  2. User can distinguish automated scheduler actions from manual user actions via clear attribution
  3. User can view a permanent deletion audit trail showing what was deleted, when, and which rule triggered it
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Backend infrastructure: activity_log table, repository, and service integration
- [x] 02-02-PLAN.md — Frontend: Activity Log page with filtering, pagination, and actor attribution

### Phase 3: Health Indicators
**Goal**: User can instantly see if the system is healthy and when things are happening
**Depends on**: Phase 1 (uses status display components)
**Requirements**: HEALTH-01, HEALTH-02, HEALTH-03
**Success Criteria** (what must be TRUE):
  1. User sees connection status indicators for each integrated service (Plex, Sonarr, Radarr, Tautulli, Overseerr)
  2. User sees the last scan timestamp displayed prominently on the dashboard
  3. User sees the next scheduled run time displayed on the dashboard
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — Backend: aggregated health status endpoint with service tests and scheduler info
- [x] 03-02-PLAN.md — Frontend: health dashboard components with service status and schedule display

### Phase 4: Settings
**Goal**: User can configure how and when the system operates to match their preferences
**Depends on**: Phase 1 (uses form components), Phase 3 (scheduling relies on health infrastructure)
**Requirements**: SET-01, SET-02, SET-03
**Success Criteria** (what must be TRUE):
  1. User can configure scan schedules including when scans run and how frequently
  2. User can configure display preferences including date/time format and file size units
  3. User can export all settings to a JSON file and import settings from a JSON file
**Plans**: 5 plans (3 original + 2 gap closure)

Plans:
- [x] 04-01-PLAN.md — Display preferences context and settings UI section
- [x] 04-02-PLAN.md — Enhanced schedule configuration with day-of-week picker
- [x] 04-03-PLAN.md — Settings export/import functionality
- [x] 04-04-PLAN.md — [GAP CLOSURE] Fix display preferences backend persistence
- [x] 04-05-PLAN.md — [GAP CLOSURE] Fix scheduler notification and import validation

### Phase 5: Notifications
**Goal**: User receives alerts about important system events without being overwhelmed
**Depends on**: Phase 2 (activity logging provides events to notify about), Phase 4 (notification URL configured in settings)
**Requirements**: NOTIFY-01
**Success Criteria** (what must be TRUE):
  1. User can configure a Discord webhook URL in settings
  2. User receives Discord notifications when library scans complete
  3. User receives Discord notifications when errors occur during scans or deletions
**Plans**: 1 plan

Plans:
- [ ] 05-01-PLAN.md — Wire Discord notifications to database settings with test button and error events

### Phase 6: Unraid Deployment
**Goal**: User can install Prunerr from Unraid Community Applications with zero friction
**Depends on**: Phase 5 (all features complete before packaging)
**Requirements**: UNRAID-01, UNRAID-02, UNRAID-03
**Success Criteria** (what must be TRUE):
  1. Prunerr appears in Unraid Community Applications with a valid XML template
  2. User settings and database persist across container updates via proper volume mapping
  3. Container reports health status based on service connectivity for Unraid dashboard display
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. UI Polish | 2/2 | Complete | 2026-01-22 |
| 2. Activity Logging | 2/2 | Complete | 2026-01-22 |
| 3. Health Indicators | 2/2 | Complete | 2026-01-24 |
| 4. Settings | 5/5 | Complete | 2026-01-24 |
| 5. Notifications | 0/1 | Not started | - |
| 6. Unraid Deployment | 0/2 | Not started | - |
