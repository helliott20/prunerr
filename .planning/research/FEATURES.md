# Feature Landscape: Media Library Dashboard Polish

**Domain:** Automated media library management (Plex/Sonarr/Radarr ecosystem)
**Researched:** 2026-01-22
**Overall Confidence:** HIGH (patterns well-established across home server apps)

## Executive Summary

Polish features for automated media management dashboards fall into four categories: visual formatting, transparency/trust, notifications, and settings UX. The critical differentiator for Prunerr is **trust through transparency** — users need confidence that automated deletion is working correctly. This means exceptional activity logging, health indicators, and "dry run" previews are not optional polish but table stakes for production readiness.

The home server ecosystem (Sonarr, Radarr, Tautulli, Overseerr) has established strong patterns for what users expect. Missing these patterns creates friction; implementing them well creates a professional feel that builds user confidence.

---

## Table Stakes

Features users expect. Missing = product feels incomplete or untrustworthy.

### Visual Formatting

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Human-readable file sizes** | "2.4 GB" not "2400000000 bytes" — instant comprehension | Low | Use formatters like `filesize` or built-in Intl.NumberFormat |
| **Relative dates** | "2 hours ago" vs "2026-01-22T14:32:00Z" | Low | `date-fns` already in stack, use `formatDistanceToNow` |
| **Number formatting** | "1,234,567" with locale-appropriate separators | Low | `Intl.NumberFormat` built into JS |
| **Consistent date formats** | User-configurable preference (US/EU/ISO) | Low | Store preference, apply consistently across all views |
| **Tabular/monospace numbers** | Right-aligned numeric columns in tables for easy comparison | Low | CSS font-variant-numeric: tabular-nums |

### Loading & Error States

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Skeleton loading states** | Visual placeholder while data loads, prevents layout shift | Medium | Sonarr/Radarr use spinners; skeletons feel more polished |
| **Error boundary with helpful messages** | "What went wrong, what you can do" not just "Error" | Medium | React error boundaries + toast/banner for API errors |
| **Empty states with guidance** | "No items match your filters" + suggested action | Low | Four types: first-use, no-results, user-cleared, errors |
| **Connection status indicators** | Show if Plex/Sonarr/Radarr reachable | Medium | Header or sidebar health indicators |
| **API timeout handling** | Graceful degradation when services slow/unreachable | Medium | Show stale data with "last updated" indicator |

### Health & Status Indicators

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Service connection status** | Green/red dots showing Plex/Sonarr/Radarr connectivity | Low | Tautulli and Dashy established this pattern |
| **Last scan timestamp** | "Last scanned: 2 hours ago" | Low | Critical for trust — users need to know system is running |
| **Next scheduled run** | "Next scan in: 4 hours" | Low | Helps users understand when changes will be detected |
| **Consolidated health indicator** | Single "all systems healthy" or "issues detected" | Medium | Carbon Design: use highest-attention color for group status |

### Activity Logging

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Timestamped activity log** | Record of what system did and when | Medium | Reverse chronological, filterable by type |
| **Action attribution** | "Scan completed" vs "Manual deletion by user" | Low | Differentiate automated vs manual actions |
| **Error logging with context** | Not just "Failed" but "Failed to connect to Sonarr: timeout after 30s" | Medium | Critical for troubleshooting |
| **Deletion audit trail** | Permanent record of what was deleted, when, why | High | Required for trust in automated deletion system |

### Deletion Safety

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Dry run mode** | Preview what WOULD be deleted without executing | Medium | Google Cloud, rsync pattern — essential for dangerous operations |
| **Confirmation for destructive actions** | "Are you sure? This will delete 47 items" | Low | Type-to-confirm for batch deletions (GitHub pattern) |
| **Grace period before deletion** | Items sit in queue N days before permanent removal | Medium | Already in Prunerr — ensure clearly visible |
| **Rule match visibility** | "This item flagged because: Rule 'Old Movies' matched (unwatched > 180 days)" | Medium | Critical transparency — users need to know WHY |

---

## Differentiators

Features that set product apart. Not expected but valued — make it feel premium.

### Advanced Transparency

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Real-time log viewer** | Plex Dash pattern — see logs as they happen | High | WebSocket or polling for live updates |
| **Rule simulation/preview** | "Show me what this rule would match" before enabling | Medium | Helps users tune rules without risk |
| **Impact preview** | "Enabling this rule would flag 234 items (12.4 TB)" | Medium | Pre-calculate impact before rule activation |
| **Dashboard graphs** | Bandwidth, storage trends, deletion history over time | High | Tautulli-style analytics — impressive but time-consuming |

### Notification Excellence

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Discord webhooks** | Most popular notification method for home server users | Low | Bettarr-Notifications pattern, simple webhook POST |
| **Notification templates** | Customizable message format for different channels | Medium | Allow users to customize what info is included |
| **Digest mode** | Single daily summary vs real-time alerts | Medium | Reduces notification fatigue |
| **Severity levels** | Only alert on errors vs also info on success | Low | User preference for notification verbosity |

### Settings UX Excellence

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Settings search** | Find preferences quickly in complex settings | Medium | Useful when >15 settings |
| **Inline editing with auto-save** | Change value, see immediate feedback | Medium | Netflix pattern — no explicit save button needed |
| **Settings import/export** | Backup and restore configuration | Low | JSON export for disaster recovery |
| **Contextual help** | Explanatory text for each setting, not just labels | Low | "What does this do?" tooltips or descriptions |

### Polish Extras

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Dark mode** | Expected by 2026, most home server apps support | Medium | Tailwind dark: variants make this straightforward |
| **Keyboard shortcuts** | Power user efficiency | Medium | Navigate with j/k, actions with hotkeys |
| **Persistent filters** | Remember last view state across sessions | Low | localStorage or URL params |
| **Responsive mobile view** | Check status from phone | Medium | Not native app, just responsive web |

---

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Complex permissions/multi-user** | Home server runs on trusted network, single admin | Single-user model, optional password protection |
| **Real-time WebSocket push everywhere** | Adds complexity, polling sufficient for this use case | Polling with reasonable intervals (30s-5min) |
| **AI/ML-based recommendations** | Overkill, user-defined rules are predictable and trustworthy | Simple rule engine users can understand |
| **Media playback/preview** | That is what Plex is for, stay in your lane | Link to Plex for playback, don't duplicate |
| **Overly frequent notifications** | Alert fatigue makes users disable notifications entirely | Digest mode, severity filtering, reasonable defaults |
| **Auto-dismiss important alerts** | Toast notifications shouldn't disappear for critical issues | Use persistent banners for errors requiring action |
| **Color-only status indicators** | Accessibility issue — 8% of men are colorblind | Use shape + color + text (Carbon Design pattern) |
| **Rainbow of colors for status** | Visual noise, hard to parse quickly | Limit to 3-4 status colors max with clear meaning |
| **Confirmation dialogs for everything** | Users automate "click yes" behavior, defeats purpose | Reserve confirmation for genuinely destructive actions |
| **Settings that require restart** | Docker container restart is painful | Hot-reload configuration where possible |

---

## Feature Dependencies

```
Visual Formatting (standalone)
 - file sizes, dates, numbers — no dependencies

Loading States
 - Requires: API infrastructure
 - Enables: Better error handling UX

Health Indicators
 - Requires: Service health check endpoints
 - Enables: Trust dashboard

Activity Logging
 - Requires: Database schema for logs
 - Enables: Audit trail, notifications
 - Enables: Real-time log viewer (differentiator)

Notifications
 - Requires: Activity logging (what to notify about)
 - Requires: Settings infrastructure (user preferences)
 - Enables: Discord/email channels

Settings UX
 - Requires: API endpoints for preferences
 - Enables: Notification preferences
 - Enables: Display preferences

Deletion Safety
 - Requires: Activity logging (audit trail)
 - Requires: Rule match visibility
 - Enables: User trust in automation
```

### Recommended Implementation Order

1. **Visual formatting** — Quick wins, immediate polish visible on every page
2. **Loading/error states** — Foundation for all async operations
3. **Health indicators** — Small scope, high trust impact
4. **Activity logging infrastructure** — Enables notifications and audit trail
5. **Deletion safety features** — Critical for production trust
6. **Notifications** — Builds on activity logging
7. **Settings UX improvements** — Polish layer on existing settings

---

## MVP Recommendation

For production-ready release, prioritize:

### Must Have (Production Blockers)
1. Human-readable formatting (file sizes, dates, numbers)
2. Loading states with skeletons or spinners
3. Error states with helpful messages
4. Service connection status indicators
5. Last scan / next scan timestamps
6. Activity log with deletion audit trail
7. Dry run mode preview
8. Confirmation for batch deletions
9. Rule match visibility ("why was this flagged?")

### Should Have (Expected Polish)
1. Discord webhook notifications
2. Email notifications (already partially implemented)
3. Settings for display preferences (date format, etc.)
4. Empty states with guidance
5. Dark mode support

### Nice to Have (Defer to Post-MVP)
1. Real-time log viewer
2. Dashboard graphs and analytics
3. Settings search
4. Keyboard shortcuts
5. Rule simulation/preview

---

## Sources

### Dashboard Design & UX Patterns
- [Dashboard UI Design Principles Guide](https://www.designstudiouiux.com/blog/dashboard-ui-design-guide/)
- [Dashboard Design UX Patterns - Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards)
- [SaaS Dashboard Templates - TailAdmin](https://tailadmin.com/blog/saas-dashboard-templates)

### Home Server Ecosystem
- [Dashy Dashboard](https://dashy.to/) - status indicators, search patterns
- [Tautulli](https://tautulli.com/) - Plex monitoring dashboard patterns
- [Bettarr-Notifications](https://github.com/NiNiyas/Bettarr-Notifications) - notification patterns for Sonarr/Radarr
- [Slant: Best Dashboard for Homeservers](https://www.slant.co/topics/36224/~dashboard-for-homeservers)

### Activity Log Design
- [Activity Log Pattern - alguidelines.dev](https://alguidelines.dev/docs/navpatterns/patterns/activity-log/)
- [Designing Chronological Activity Feeds - Aubergine](https://www.aubergine.co/insights/a-guide-to-designing-chronological-activity-feeds)

### Notification Patterns
- [Toast Notifications Best Practices - LogRocket](https://blog.logrocket.com/ux-design/toast-notifications/)
- [The 3 Types of Alerts - UX Movement](https://uxmovement.com/forms/the-3-types-of-alerts-and-how-to-use-them-correctly/)
- [Notification Pattern - Carbon Design System](https://carbondesignsystem.com/patterns/notification-pattern/)

### Loading & Error States
- [Loading Patterns - Carbon Design System](https://carbondesignsystem.com/patterns/loading-pattern/)
- [Empty States UX - Eleken](https://www.eleken.co/blog-posts/empty-state-ux)
- [Empty States Pattern - Carbon Design System](https://carbondesignsystem.com/patterns/empty-states-pattern/)

### Status Indicators
- [Status Indicator Pattern - Carbon Design System](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
- [Status Indicator - HPE Design System](https://design-system.hpe.design/templates/status-indicator)

### Deletion Safety
- [Delete with Additional Confirmation - Cloudscape](https://cloudscape.design/patterns/resource-management/delete/delete-with-additional-confirmation/)
- [Confirmation Dialogs - Nielsen Norman Group](https://www.nngroup.com/articles/confirmation-dialog/)
- [Delete Button UI Best Practices - Design Monks](https://www.designmonks.co/blog/delete-button-ui)

### Settings UX
- [App Settings UI Design - Setproduct](https://www.setproduct.com/blog/settings-ui-design)
- [How to Improve App Settings UX - Toptal](https://www.toptal.com/designers/ux/settings-ux)
- [Settings Pattern - Material Design](https://m1.material.io/patterns/settings.html)

### Data Table Design
- [Data Table Design UX Patterns - Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)
- [Ultimate Guide to Designing Data Tables - UIPrep](https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables)

---

*Research completed: 2026-01-22*
*Confidence: HIGH — patterns established across mature home server ecosystem*
