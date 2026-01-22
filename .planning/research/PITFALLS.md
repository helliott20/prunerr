# Domain Pitfalls

**Domain:** Media library management tool with automated deletion (Prunerr)
**Researched:** 2026-01-22
**Focus:** Polish, notifications, settings/preferences, Unraid deployment

## Critical Pitfalls

Mistakes that cause lost user trust, data loss, or require major rework.

### Pitfall 1: Notification Fatigue Leading to Ignored Alerts

**What goes wrong:** Users receive too many notifications (every scan, every flagged item, every minor status change). They become habituated and start dismissing all notifications without reading them. When something actually important happens (like an unexpected bulk deletion or a service connection failure), users miss it because they've trained themselves to ignore alerts.

**Why it happens:** Developers enable notifications for everything during development to verify the system works. This gets shipped without tuning. Additionally, there's a tendency to notify for "success" when only "failure" or "action required" truly needs attention.

**Consequences:**
- Users disable notifications entirely, defeating the purpose
- Critical errors go unnoticed (service disconnection, failed deletions)
- User trust erodes when they discover problems they weren't meaningfully warned about

**Warning signs:**
- Notification count exceeds 1-2 per day on average
- Users asking how to disable notifications
- Multiple notification types for the same underlying event

**Prevention:**
- Default to summary/digest notifications (daily or weekly) rather than per-event
- Implement notification severity levels: only HIGH priority notifications by default
- Never notify for routine success - only deviations from expected behavior
- Provide granular controls: users can opt into verbose notifications if desired
- Test with real-world scenarios: "Would I want to receive this at 3 AM?"

**Phase mapping:** Notifications phase - implement severity levels and digest options from the start

**Sources:** [MagicBell - Help Your Users Avoid Notification Fatigue](https://www.magicbell.com/blog/help-your-users-avoid-notification-fatigue), [NinjaOne - What Is Alert Fatigue](https://www.ninjaone.com/blog/what-is-alert-fatigue/), [Smashing Magazine - Design Guidelines For Better Notifications UX](https://www.smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux/)

---

### Pitfall 2: Deletion Without Adequate Recovery Path

**What goes wrong:** Automated deletion happens, user realizes they wanted that content, but there's no way to recover. Even if the deletion was "correct" by the rules, users feel burned and lose trust in the system.

**Why it happens:** Focus on the deletion mechanism without equal focus on the recovery mechanism. "It worked as designed" doesn't comfort users who lost content.

**Consequences:**
- User loses media they actually wanted
- User disables automation entirely (defeats the product's purpose)
- Negative reviews citing data loss
- Users stop trusting the grace period because it "didn't feel long enough"

**Warning signs:**
- Users asking "can I get this back?"
- Users setting extremely long grace periods (90+ days) out of fear
- Feature requests for "undo deletion"

**Prevention:**
- Implement soft delete pattern: items marked as "deleted" can be recovered for X days
- Provide clear recovery instructions in deletion notifications
- Show "Recently Deleted" section in UI with restore option
- For permanent deletion, require explicit confirmation ("I understand this cannot be undone")
- Consider integration with Sonarr/Radarr to allow re-requesting deleted content

**Phase mapping:** Backend reliability phase - implement soft delete before shipping notifications that announce deletions

**Sources:** [GitLab Pajamas - Destructive Actions](https://design.gitlab.com/patterns/destructive-actions/), [NN/g - Confirmation Dialogs Can Prevent User Errors](https://www.nngroup.com/articles/confirmation-dialog/)

---

### Pitfall 3: Unraid Template Rejected or Causes Installation Failures

**What goes wrong:** Template submitted to Community Applications gets rejected, or worse, gets accepted but causes installation failures for users. Common issues: missing required fields, incorrect path mappings, Support link pointing to GitHub instead of Unraid forum, outdated XML format.

**Why it happens:** Unraid templates have specific requirements that aren't obvious from other Docker deployment experience. The official documentation exists but isn't prominently surfaced.

**Consequences:**
- Rejection delays app availability
- Installation failures create negative first impressions
- Users can't get help because Support link goes to wrong place
- Configuration doesn't persist across container updates

**Warning signs:**
- `DateInstalled` or `MyIP` tags present (should be removed)
- Support URL pointing to GitHub issues instead of Unraid forum thread
- Icon URL using HTTP instead of HTTPS
- Missing PUID/PGID configuration
- WebUI format not following `http://[IP]:[PORT:####]/` pattern

**Prevention:**
- Remove auto-generated tags: `DateInstalled`, `Shell` (unless certain), `MyIP`, `Networking`, `Data`, `Environment`
- Create Unraid forum support thread before submission
- Use HTTPS for all external URLs (Icon, TemplateURL)
- Follow WebUI format exactly: `http://[IP]:[PORT:3000]/`
- Test installation on actual Unraid system before submission
- Mark sensitive variables with `Mask="true"` (API keys, passwords)
- Use appropriate Display values: "always" for essential, "advanced" for optional
- Include TemplateURL pointing to raw GitHub XML

**Phase mapping:** Unraid deployment phase - validate against checklist before submission

**Sources:** [Selfhosters.net - Writing a template compatible for Unraid](https://selfhosters.net/docker/templating/templating/), [Unraid Docs - Community Applications](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/community-applications/)

---

### Pitfall 4: No Dry Run / Preview Mode for Automated Actions

**What goes wrong:** Users configure rules and enable automation, but have no way to see what would happen before it happens. First automated run deletes content the user didn't expect, destroying trust immediately.

**Why it happens:** Dry run feels like "extra work" when the core functionality works. The deletion queue with grace period is seen as sufficient preview.

**Consequences:**
- User's first experience with automation is unexpected deletions
- Users refuse to enable automation, use only manual mode
- Support requests asking "why did it delete X?"
- Rules get disabled rather than refined because users can't safely test them

**Warning signs:**
- Users asking "what will this rule actually delete?"
- High rate of users using manual-only mode
- Feature requests for "test rule" functionality

**Prevention:**
- Implement dry run mode that shows exactly what would be flagged without flagging
- Rule builder should show live preview of matching items
- First-time automation setup should require reviewing dry run results
- Consider "simulation mode" setting that runs rules but only logs, never acts
- Show rule match counts on dashboard even when rules are disabled

**Phase mapping:** Settings phase - dry run should be part of rule configuration UX

**Sources:** [G-Research - Enhancing Software Tools With --dry-run](https://www.gresearch.com/news/in-praise-of-dry-run/), [Nick Janetakis - CLI Tools That Support Previews](https://nickjanetakis.com/blog/cli-tools-that-support-previews-dry-runs-or-non-destructive-actions)

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or poor user experience.

### Pitfall 5: Inconsistent UI Formatting Across Pages

**What goes wrong:** File sizes shown as "1073741824 bytes" on one page and "1 GB" on another. Dates formatted differently. Spacing inconsistent between components. Users perceive the app as unpolished or untrustworthy.

**Why it happens:** Different developers (or same developer at different times) implement formatting ad-hoc. No shared formatting utilities. Styling copied rather than extracted to components.

**Consequences:**
- App feels amateur/untrustworthy
- Users have to mentally translate between formats
- Bug reports about "display issues" that are really consistency issues
- Technical debt accumulates as fixes are applied inconsistently

**Warning signs:**
- Same data type (size, date, duration) formatted differently on different pages
- Spacing values that don't follow a consistent system (7px here, 9px there)
- Color variations that aren't intentional (different shades of gray)

**Prevention:**
- Create shared formatting utilities used everywhere:
  - `formatFileSize(bytes)` - consistent GB/MB/KB display
  - `formatDate(date)` - relative dates with tooltip for absolute
  - `formatNumber(n)` - thousand separators for large numbers
  - `formatDuration(minutes)` - "2h 15m" style
- Audit all pages for format consistency before polish phase ends
- Use 8pt spacing system (all spacing divisible by 8)
- Extract colors to CSS variables/theme tokens
- Code review should flag raw number/date display

**Phase mapping:** UI polish phase - implement utilities first, then audit/apply

**Sources:** [Lost Pixel - Maintain UI Consistency in Design](https://www.lost-pixel.com/blog/ui-consistency-in-design), [Supercharge Design - 20 Common Typography Mistakes](https://supercharge.design/blog/20-common-typography-mistakes-in-ui-design)

---

### Pitfall 6: Settings That Don't Explain Consequences

**What goes wrong:** User changes a setting without understanding the impact. For example: reducing grace period from 7 days to 1 day on a Saturday, Monday morning all grace-period items are deleted. Or: enabling "aggressive mode" without understanding it bypasses protection rules.

**Why it happens:** Settings UI focuses on what the setting does, not when it applies or what the consequences are. Developer assumes user understands the system.

**Consequences:**
- Unexpected deletions when settings take effect
- Users afraid to change settings
- Support requests asking "what does X setting actually do?"
- Users reverting to defaults because they don't trust changes

**Warning signs:**
- Settings with boolean toggles that have non-obvious effects
- No confirmation or warning when changing destructive settings
- Settings that apply immediately vs. on next run, with no indication which

**Prevention:**
- Every setting should explain: what it does, when it takes effect, what the consequences are
- Dangerous settings need confirmation: "Reducing grace period will affect X items currently in queue. They will be eligible for deletion sooner."
- Show preview of impact where possible: "This would affect X items currently in queue"
- Group settings by risk level: Safe, Advanced, Dangerous
- Log all settings changes with before/after values

**Phase mapping:** Settings phase - design settings UX with consequences in mind

**Sources:** [Toptal - How to Improve App Settings UX](https://www.toptal.com/designers/ux/settings-ux), [UI-Patterns - Settings Design Pattern](https://ui-patterns.com/patterns/settings)

---

### Pitfall 7: Service Connection Failures Silent or Unclear

**What goes wrong:** Plex/Sonarr/Radarr connection fails, but the user isn't clearly informed. Scan runs but returns no items. User thinks system is broken or empty when really it's just disconnected.

**Why it happens:** Error handling returns empty results instead of errors to prevent crashes. UI designed for happy path doesn't have clear error states.

**Consequences:**
- Users think app is broken when it's a configuration issue
- Support requests that are really "your Plex URL is wrong"
- Scans appear successful but actually failed
- Users lose trust because they don't know when things work vs. don't work

**Warning signs:**
- Dashboard shows "0 items" without indicating if that's accurate or an error
- Last scan shows "completed" even if all services failed
- No distinction between "no items match" and "couldn't connect"

**Prevention:**
- Dashboard health indicators showing connection status for each service
- Clear error states distinct from empty states ("No items match your filters" vs. "Could not connect to Plex")
- Test connection button for each service in settings
- Scan results should include service connection status
- Notifications for connection failures (but not every retry - see notification fatigue)

**Phase mapping:** Backend reliability phase - implement clear error states and health checks

**Sources:** Based on common patterns in Sonarr/Radarr/Overseerr issue trackers, [Unraid Forums - Overseerr Connection Issues](https://forums.unraid.net/topic/109049-overseerr-requests-wont-send-to-sonarr-and-radarr/)

---

### Pitfall 8: Timezone Handling Causes Unexpected Behavior

**What goes wrong:** User in PST configures schedule for 3 AM. Container runs in UTC. Scan happens at 11 PM PST. Or: "days since watched" calculation is off by a day because timestamps compared without timezone normalization.

**Why it happens:** Dates stored and compared without consistent timezone handling. Schedule uses server time without user-facing indication.

**Consequences:**
- Scans run at unexpected times
- Rule evaluation gives inconsistent results
- "7 day grace period" is actually 6 or 8 days depending on timing
- User frustration with behavior that seems random

**Warning signs:**
- User reports of "it ran at the wrong time"
- Off-by-one day issues in grace period
- Inconsistent behavior for users in different timezones

**Prevention:**
- Store all timestamps in UTC internally
- Display times in user's configured timezone
- Schedule configuration should show "next run" in local time
- Grace period calculation should use consistent timezone
- Document timezone behavior in settings
- Test with non-UTC system time

**Phase mapping:** Backend reliability phase - audit all date/time handling

---

## Minor Pitfalls

Mistakes that cause annoyance but are quickly fixable.

### Pitfall 9: Loading States Missing or Inconsistent

**What goes wrong:** User clicks button, nothing happens for 2 seconds, user clicks again, now two requests in flight. Or: page shows old data while loading new data, creating confusion about what's current.

**Why it happens:** Loading states added reactively when users complain, not proactively designed.

**Consequences:**
- Double-submissions of actions
- User uncertainty about whether action worked
- Perceived sluggishness even when operations are fast

**Warning signs:**
- Users reporting "I had to click twice"
- Console showing duplicate API requests
- Stale data visible during refresh

**Prevention:**
- Every async action needs: loading state, success state, error state
- Buttons should disable during submission
- Use optimistic updates for non-destructive actions
- Show skeleton loaders for data fetching
- Toast notifications for action completion

**Phase mapping:** UI polish phase - audit all interactive elements for states

---

### Pitfall 10: Overusing Confirmation Dialogs

**What goes wrong:** Every action requires confirmation. Users become habituated to clicking "OK" without reading. When a truly dangerous action comes along, they confirm it automatically.

**Why it happens:** Confirmation added to every action "just to be safe" without considering the cost of dialog fatigue.

**Consequences:**
- Confirmation loses its protective power
- Users frustrated by constant interruptions
- Dangerous actions not distinguished from routine ones

**Warning signs:**
- More than 2-3 confirmation dialogs in a typical user session
- Confirmations for reversible actions
- Users complaining about "too many popups"

**Prevention:**
- Reserve confirmation for irreversible or high-impact actions only
- Use undo instead of confirmation for reversible actions
- Dangerous confirmations should require friction (type to confirm, delay before button active)
- Audit all confirmation dialogs: is this truly necessary?

**Phase mapping:** UI polish phase - audit confirmation usage

**Sources:** [NN/g - Confirmation Dialogs Can Prevent User Errors (If Not Overused)](https://www.nngroup.com/articles/confirmation-dialog/), [UX Movement - How to Design Destructive Actions](https://uxmovement.com/buttons/how-to-design-destructive-actions-that-prevent-data-loss/)

---

### Pitfall 11: Activity Log Without Useful Context

**What goes wrong:** Activity log shows "Deleted: Movie Title" but doesn't show why (which rule matched), when it was flagged, how long it was in the queue, or what the file path was. Users can't debug unexpected behavior.

**Why it happens:** Logging added as afterthought. Logs what happened but not why.

**Consequences:**
- Users can't understand why items were deleted
- Can't verify rules are working as intended
- Support requests for information that should be self-service

**Warning signs:**
- Users asking "why was X deleted?"
- Activity log entries with minimal context
- No way to filter/search activity history

**Prevention:**
- Activity log entries should include: what, when, why (rule name), relevant metadata
- Link from activity to related entities (rule, media item)
- Filterable/searchable activity log
- Export capability for detailed analysis
- Retention policy for activity log (don't keep forever, but keep long enough)

**Phase mapping:** Transparency phase - design activity log schema with context in mind

**Sources:** [HubiFi - 10 Best Audit Trail Software Picks](https://www.hubifi.com/blog/automated-audit-trail-software), [Keeper Security - What Is an Audit Trail](https://www.keepersecurity.com/blog/2025/01/10/what-is-an-audit-trail-importance-and-steps-to-implement-it/)

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| UI Polish | Inconsistent formatting (#5) | Create formatting utilities first, then audit all pages |
| UI Polish | Missing loading states (#9) | Audit all async operations for complete state handling |
| UI Polish | Overused confirmations (#10) | Confirmation audit: only irreversible actions |
| Notifications | Alert fatigue (#1) | Default to digest, implement severity levels |
| Notifications | Vague notification copy | Specific, actionable messages only |
| Settings | Consequences unclear (#6) | Every setting explains impact and timing |
| Settings | No dry run for rules (#4) | Rule preview shows matching items before enabling |
| Backend Reliability | Silent service failures (#7) | Health indicators and clear error states |
| Backend Reliability | Timezone issues (#8) | UTC storage, local display, documented behavior |
| Backend Reliability | No recovery path (#2) | Soft delete pattern with restore capability |
| Transparency | Useless activity log (#11) | Log why, not just what |
| Unraid Deployment | Template rejection (#3) | Validate against checklist, test on real Unraid |

---

## Prunerr-Specific Warnings

Given that Prunerr is an **automated deletion tool** where trust is critical, these pitfalls are especially important:

### Trust-Critical Design Principles

1. **Transparency over automation**: Users should always know what the system is doing and why. Never delete silently.

2. **Recoverable by default**: Implement soft delete. The grace period isn't enough - users need ability to recover after deletion.

3. **Dry run first**: New rules should be testable without risk. Simulation mode should be the default for new users.

4. **Fail safe, not fail silent**: If a service connection fails, don't proceed with partial data. Make failures obvious and logged.

5. **Audit everything**: Every deletion should be traceable: when flagged, which rule, how long in queue, who/what triggered final deletion.

### What Makes Users Trust Automation

From research on similar tools (Sonarr, Radarr, Overseerr):

- **Predictability**: Same inputs always produce same outputs. No surprises.
- **Visibility**: Dashboard clearly shows what's happening, what's pending, what ran.
- **Control**: Easy to pause, easy to exclude, easy to revert.
- **Confirmation before consequences**: First run should require human review.
- **Clear documentation**: Users understand what they're enabling.

### Anti-Patterns to Avoid

- "Smart" behavior that does unexpected things
- Default-on aggressive settings
- Notifications that cry wolf
- Settings that take effect in non-obvious ways
- Error messages that don't help users fix the problem

---

*Pitfalls research completed: 2026-01-22*

*Sources: Community patterns from Unraid forums, UX research from NN/g and Smashing Magazine, notification design best practices, destructive action design patterns*
