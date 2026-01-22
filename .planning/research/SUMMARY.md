# Project Research Summary

**Project:** Prunerr - Polish & Production Readiness
**Domain:** Automated media library management (Plex/Sonarr/Radarr ecosystem)
**Researched:** 2026-01-22
**Confidence:** HIGH

## Executive Summary

Prunerr is an automated media deletion tool for home server users that requires exceptional polish and trust-building features for production readiness. The research reveals that in this domain, transparency and deletion safety aren't optional polish—they're table stakes. Users will not trust automated deletion without clear visibility into what's happening, why it's happening, and the ability to recover from mistakes.

The existing stack (React 18, Vite, Express 5, TypeScript, Tailwind CSS) is solid and modern. Polish features should extend rather than replace it, focusing on three critical areas: (1) visual formatting and professional UI polish using Radix UI primitives + Tailwind, (2) trust-building through activity logging, health indicators, and dry-run modes, and (3) notification excellence via Discord webhooks and email with careful attention to avoiding alert fatigue. The architecture already follows good patterns (repository pattern, service layer, TanStack Query for state) and needs integration rather than redesign.

The critical risk is losing user trust through unexpected deletions. Mitigation requires soft delete with recovery, comprehensive activity logging with context (why was this deleted, which rule matched), dry-run preview before rule activation, and notification severity levels to prevent alert fatigue. Unraid deployment has specific template requirements that must be validated before submission to Community Applications.

## Key Findings

### Recommended Stack

The existing stack requires minimal additions. No major framework changes needed. Focus on professional UI components, formatting utilities, and notification channels that integrate with the home server ecosystem.

**Core additions:**
- **Radix UI primitives** (Switch, Tabs, Select, Dialog, Tooltip): Accessible, unstyled React components that pair perfectly with Tailwind CSS — industry standard for settings UIs
- **react-hook-form + Zod resolver**: Type-safe forms using existing Zod schemas — single source of truth for validation
- **Sonner**: Modern toast notification library with zero config, stacking animations — current gold standard for in-app notifications
- **pretty-bytes**: Human-readable file size formatting (2.4 GB vs 2400000000) — lightweight, simple API
- **Native implementations**: Use Intl.NumberFormat for number formatting, native fetch for Discord webhooks, existing nodemailer for email — zero dependencies for common needs

**What NOT to add:**
- Complex multi-user auth (home server is trusted network)
- Real-time WebSocket everywhere (polling sufficient)
- AI/ML recommendations (predictable rules build trust)
- Media playback (that's Plex's job)

### Expected Features

Polish features in this domain fall into four categories: visual formatting, transparency/trust, notifications, and settings UX. The critical insight is that for automated deletion tools, transparency features are not differentiators—they're production blockers.

**Must have (table stakes):**
- Human-readable formatting (file sizes "2.4 GB", relative dates "2 hours ago", number separators "1,234")
- Loading states with skeletons/spinners and clear error messages
- Service connection status indicators (green/red dots for Plex/Sonarr/Radarr)
- Last scan / next scheduled run timestamps
- Activity log with deletion audit trail (what, when, why, which rule)
- Dry run mode preview showing what rules would match without executing
- Confirmation for batch deletions with clear impact ("will delete 47 items")
- Rule match visibility ("why was this flagged?")

**Should have (competitive polish):**
- Discord webhook notifications (most popular in home server community)
- Email notifications for critical events
- Settings for display preferences (date format, timezone)
- Empty states with guidance ("No items match your filters" + suggested action)
- Dark mode support (expected by 2026)

**Defer (v2+):**
- Real-time log viewer (WebSocket streaming)
- Dashboard graphs and analytics (Tautulli-style bandwidth/storage trends)
- Settings search (only needed when >15 settings)
- Keyboard shortcuts for power users
- Rule simulation with live preview

**Anti-features (explicitly avoid):**
- Complex permissions/multi-user (single admin model)
- Real-time WebSocket push everywhere (polling is sufficient)
- Media playback/preview (stay in your lane)
- Overly frequent notifications (causes alert fatigue)
- Auto-dismiss critical alerts (must be persistent)
- Color-only status indicators (accessibility issue)
- Confirmation dialogs for everything (defeats purpose)

### Architecture Approach

The existing codebase follows a clean monorepo pattern with Express backend and React frontend. The architecture is already well-structured with repository pattern, service layer, and hook-based API using TanStack Query. Polish features require integration rather than redesign.

**Major components to add/enhance:**
1. **ActivityLogRepository** — New SQLite table for unified activity logging. Current approach reconstructs activity from multiple tables (scan_history, deletion_history), which is slow and limited. Single table with event_type discriminator enables fast queries, flexible filtering, and easy extension.
2. **NotificationService integration** — Service already exists but isn't wired into application. Use event-driven pattern where system events (scan complete, deletion, error) emit to dispatcher, NotificationService subscribes and sends to channels. Decouple notification logic from business logic.
3. **HealthService** — Aggregate service health checks with background refresh (every 60s), cached results. Never check health synchronously on API requests. Dashboard reads cached status for instant response.
4. **SettingsService** — Typed settings layer over existing key-value store. Current flat structure is good, but add Zod validation and typed getters/setters. Frontend uses react-hook-form with Zod resolver for type-safe forms.

**Key architectural patterns:**
- Event-driven notifications (emit events, service subscribes)
- SQLite for activity logging (already using it, natural fit)
- Repository pattern for data access (maintain existing pattern)
- Optimistic updates for settings (TanStack Query pattern)
- Background health checks with caching (never block UI on health checks)

**Integration points:**
- Wire NotificationService into scheduler/tasks.ts and services/deletion.ts
- Add activity logging calls at all key events (scan, delete, rule change, error)
- Replace /api/activity/recent to query new activity_log table
- Add health check cron job for background monitoring

### Critical Pitfalls

Based on patterns from similar tools in the home server ecosystem and UX research on destructive actions.

1. **Notification fatigue leading to ignored alerts** — Users receive too many notifications, become habituated, start ignoring all alerts. When something critical happens (unexpected bulk deletion, service failure), they miss it. Prevention: Default to digest mode (daily/weekly summary), implement severity levels (only HIGH priority by default), never notify for routine success. Test with "would I want this at 3 AM?" criterion.

2. **Deletion without adequate recovery path** — Automated deletion happens, user realizes they wanted that content, no way to recover. Even "correct" deletions destroy trust if unrecoverable. Prevention: Implement soft delete pattern (items recoverable for X days after deletion), provide "Recently Deleted" section with restore option, clear recovery instructions in notifications. Grace period alone isn't enough—need post-deletion recovery.

3. **No dry run / preview mode for automated actions** — Users configure rules, enable automation, first run deletes unexpected content, trust destroyed immediately. Prevention: Dry run mode shows exactly what would be flagged, rule builder shows live preview of matching items, first-time automation requires reviewing dry run results, simulation mode that logs but never acts.

4. **Unraid template rejected or causes installation failures** — Template submitted to Community Applications gets rejected or accepted but causes failures. Common issues: missing required fields, wrong path mappings, Support link pointing to GitHub instead of Unraid forum. Prevention: Remove auto-generated tags (DateInstalled, MyIP), create Unraid forum support thread before submission, use HTTPS for all URLs, test on actual Unraid before submitting.

5. **Inconsistent UI formatting across pages** — File sizes shown as bytes on one page and GB on another, dates formatted differently, spacing inconsistent. Users perceive app as unpolished/untrustworthy. Prevention: Create shared formatting utilities used everywhere (formatFileSize, formatDate, formatNumber), audit all pages before polish phase ends, use 8pt spacing system, extract colors to CSS variables.

## Implications for Roadmap

Based on research, suggested phase structure prioritizes trust-building foundations before user-facing polish, then layers notifications and deployment features.

### Phase 1: Foundation - Activity Logging & Health Infrastructure
**Rationale:** Activity logging enables notifications (must log events before notifying about them) and provides audit trail needed for trust. Health checks provide transparency about system status. Both are foundational dependencies with no external dependencies themselves.

**Delivers:**
- SQLite activity_log table with repository
- Background health check service with caching
- Enhanced /api/health endpoint with service status
- Activity log API with filtering/pagination

**Addresses:** Activity logging infrastructure (FEATURES.md table stakes), health indicators (FEATURES.md table stakes)

**Avoids:** Pitfall #7 (silent service failures) by implementing clear error states and health indicators

**Research flag:** Standard patterns — SQLite schema and health check patterns are well-documented. No phase-specific research needed.

### Phase 2: Trust & Safety - Deletion Safety Features
**Rationale:** Must implement deletion safety (dry run, soft delete, confirmation) before any polish or notifications. If users don't trust deletions, no amount of polish will help. This builds on activity logging (need audit trail for deletions).

**Delivers:**
- Soft delete implementation with recovery UI
- Dry run mode for rules (preview without executing)
- Rule match visibility ("why was this flagged?")
- Enhanced deletion confirmation with impact preview
- "Recently Deleted" section in UI

**Addresses:** Deletion safety (FEATURES.md table stakes), rule match visibility (FEATURES.md table stakes)

**Avoids:** Pitfall #2 (deletion without recovery), Pitfall #4 (no dry run mode)

**Research flag:** Standard patterns — soft delete and dry run are well-established patterns. No phase-specific research needed.

### Phase 3: Visual Polish - Formatting & UI Components
**Rationale:** Once trust foundations are in place, add visual polish. This is high-impact, low-risk work that makes the app feel professional. Can proceed independently now that foundations exist.

**Delivers:**
- Shared formatting utilities (file sizes, dates, numbers, durations)
- Radix UI components integrated (Switch, Tabs, Select, Dialog, Tooltip)
- Loading states with skeletons
- Error states distinct from empty states
- Consistent spacing and color system
- Dark mode support

**Uses:** Radix UI primitives, pretty-bytes, Intl.NumberFormat, date-fns (existing)

**Addresses:** Visual formatting (FEATURES.md table stakes), loading/error states (FEATURES.md table stakes)

**Avoids:** Pitfall #5 (inconsistent formatting), Pitfall #9 (missing loading states)

**Research flag:** Standard patterns — React component libraries and formatting are well-documented. No phase-specific research needed.

### Phase 4: Settings UX - Enhanced Configuration
**Rationale:** Settings UI depends on visual polish components (Radix UI) and should precede notifications (need notification configuration UI). Settings changes can trigger rule changes which need activity logging.

**Delivers:**
- Settings service with Zod validation
- react-hook-form integration with typed schemas
- Settings UI with sub-components (Services, Notifications, Schedule)
- Contextual help and consequence warnings
- Test connection buttons for services
- Settings import/export

**Uses:** react-hook-form, @hookform/resolvers, Zod schemas, Radix UI components

**Addresses:** Settings UX (FEATURES.md should-have), contextual help (FEATURES.md should-have)

**Avoids:** Pitfall #6 (settings without consequences explained), Pitfall #7 (unclear service failures)

**Research flag:** Standard patterns — form handling with react-hook-form is well-documented. No phase-specific research needed.

### Phase 5: Notifications - External Alerts
**Rationale:** Notifications depend on activity logging (what to notify about), settings infrastructure (user preferences), and visual polish (toast library). This is the first phase that reaches outside the application.

**Delivers:**
- Event dispatcher for notification events
- NotificationService wiring into scheduler and deletion service
- Discord webhook integration
- Email notifications via existing nodemailer
- Notification severity levels and digest mode
- In-app toast notifications via Sonner

**Uses:** Sonner for toasts, native fetch for Discord webhooks, nodemailer (existing) for email

**Implements:** Event-driven notification pattern from ARCHITECTURE.md

**Addresses:** Notifications (FEATURES.md should-have), Discord webhooks (FEATURES.md should-have)

**Avoids:** Pitfall #1 (notification fatigue) by implementing severity levels and digest mode from start

**Research flag:** Low complexity — Discord webhooks are simple HTTP POST, nodemailer already installed. No phase-specific research needed.

### Phase 6: Deployment - Unraid Integration
**Rationale:** Final phase focuses on distribution. Unraid template enables easy installation for target audience. Can proceed independently once application features are stable.

**Delivers:**
- Unraid XML template following v2 schema
- Multi-stage Dockerfile optimized for Unraid
- Docker Hub image publication
- Unraid forum support thread
- Installation documentation

**Addresses:** Unraid deployment (FEATURES.md competitive advantage for home server users)

**Avoids:** Pitfall #3 (Unraid template rejection) by validating against checklist before submission

**Research flag:** Needs validation — Unraid template validation should be done during phase planning. Test on actual Unraid system before submission to Community Applications.

### Phase Ordering Rationale

**Dependency-driven order:**
- Activity logging has no dependencies → Phase 1
- Deletion safety depends on activity logging → Phase 2
- Visual polish can proceed once foundations exist → Phase 3
- Settings needs visual components → Phase 4
- Notifications need activity logging + settings → Phase 5
- Deployment is independent → Phase 6

**Trust-first approach:**
- Phases 1-2 build trust (transparency, safety) before polish
- User must trust deletions before any polish matters
- Polish without safety creates polished broken tool

**Risk mitigation:**
- Critical pitfalls (notification fatigue, deletion recovery, dry run) addressed in their respective phases
- No phase introduces risk that later phase must fix
- Each phase delivers user-visible value

**Parallelization opportunities:**
- Phase 3 (visual polish) could overlap with Phase 4 (settings) — both use Radix UI
- Phase 6 (Unraid) can proceed independently once Phase 5 completes
- Within phases, frontend and backend work can proceed in parallel

### Research Flags

**Phases with standard patterns (skip /gsd:research-phase):**
- **Phase 1-5:** All use well-documented patterns. Activity logging (SQLite schema), health checks (standard HTTP endpoints), Radix UI (official docs), react-hook-form (extensive docs), Discord webhooks (simple HTTP POST) are all thoroughly documented in 2026.

**Phases needing validation during planning:**
- **Phase 6 (Unraid):** While patterns are documented, Unraid template validation should be done during phase planning. The checklist from PITFALLS.md should be used to validate template structure. Test on actual Unraid system before Community Applications submission.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Technologies verified via npm registry and official docs. Versions checked and available. Radix UI + Tailwind is proven pattern. |
| Features | HIGH | Home server ecosystem patterns well-established across Sonarr, Radarr, Tautulli, Overseerr. Feature expectations validated across multiple mature projects. |
| Architecture | HIGH | Based on existing codebase analysis. Patterns (repository, service layer, TanStack Query) already in use. Recommendations extend rather than replace. |
| Pitfalls | HIGH | Drawn from UX research (NN/g, Smashing Magazine), home server community forums, destructive action design patterns, and notification best practices. |

**Overall confidence:** HIGH

### Gaps to Address

**Timezone handling:** Research identified timezone issues as a moderate pitfall but didn't deeply explore solution patterns. During Phase 1 implementation, audit all date/time handling for timezone consistency. Consider adding user timezone preference in settings.

**Notification rate limiting:** Discord has 30/min limit. During Phase 5 planning, implement rate limiting logic to prevent hitting webhook rate limits during high-activity periods (bulk scans, mass deletions).

**Activity log retention:** Research recommended 30-day retention but didn't explore user preferences. During Phase 1 implementation, make retention period configurable in settings (default 30 days, allow users to extend).

**Soft delete storage impact:** Soft delete means deleted files stay on disk during recovery period. During Phase 2 planning, calculate storage impact and ensure users understand deleted files aren't immediately removed.

**Unraid template testing:** Phase 6 requires actual Unraid system testing. If Unraid access isn't available, consider asking Unraid community member to validate template before submission.

## Sources

### Primary (HIGH confidence)
- **Stack:** npm registry (versions verified 2026-01-22), MDN documentation (Intl.NumberFormat, native APIs), official docs for Radix UI, react-hook-form, Sonner, Discord webhooks API
- **Features:** Carbon Design System (notification patterns, status indicators, loading patterns), NN/g (confirmation dialogs, empty states), Cloudscape Design (delete confirmation patterns)
- **Architecture:** Existing codebase analysis, TanStack Query docs, Event-driven architecture patterns (FreeCodeCamp)
- **Pitfalls:** NN/g confirmation dialog research, Smashing Magazine notification UX, GitLab Pajamas destructive action patterns, Unraid official documentation and Selfhosters.net template guide

### Secondary (MEDIUM confidence)
- Dashboard UI design guides (Pencil & Paper UX patterns, TailAdmin SaaS patterns)
- Home server ecosystem observation (Dashy, Tautulli, Bettarr-Notifications patterns)
- Community resources (Builder.io React libraries comparison, Knock notification library rankings)
- State management best practices (C# Corner React 2026 guide)

### Tertiary (LOW confidence)
- Unraid forum discussions (for context on common issues, not primary guidance)
- SlantCo homeserver dashboard comparisons (for ecosystem context)

---
*Research completed: 2026-01-22*
*Ready for roadmap: yes*
