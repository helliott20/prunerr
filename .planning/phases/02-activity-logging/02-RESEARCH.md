# Phase 2: Activity Logging - Research

**Researched:** 2026-01-22
**Domain:** Activity logging infrastructure, audit trails, action attribution
**Confidence:** HIGH

## Summary

This research investigates the activity logging requirements for Prunerr, focusing on providing users complete visibility into system actions. The codebase already has partial infrastructure in place:

- **Deletion history exists**: `deletion_history` table tracks all deletions with timestamps, deletion type (automatic/manual), and rule attribution
- **Scan history exists**: `scan_history` table tracks scan operations with status and results
- **Activity endpoint exists**: `/api/activity/recent` aggregates data from multiple tables into a unified activity feed
- **History UI exists**: `History.tsx` displays deletion history with search, filtering, and pagination

The main gaps are:

1. **No dedicated activity log table**: Activities are reconstructed from other tables rather than logged directly
2. **Incomplete action attribution**: `deletion_type` distinguishes automatic/manual but lacks consistent actor tracking
3. **Scattered activity data**: Activities live in multiple tables making querying/filtering inefficient
4. **Frontend activity view missing**: Dashboard shows recent activity but there's no dedicated Activity Log page

**Primary recommendation:** Create a unified `activity_log` table that captures all system events with consistent schema, then build a dedicated Activity Log UI component that provides filtering, pagination, and clear action attribution.

## Standard Stack

The project already uses these libraries - minimal new dependencies needed:

### Core (Already Installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| better-sqlite3 | ^12.6.2 | SQLite database with sync API | Already used throughout |
| date-fns | ^4.1.0 | Date formatting and relative time | Already used via utils.ts |
| @tanstack/react-query | ^5.90.19 | Server state, pagination, infinite scroll | Already used throughout |
| lucide-react | ^0.562.0 | Icons (Clock, Activity, Trash, etc.) | Already used throughout |
| tailwind-merge | ^3.4.0 | CSS class composition | Already used via cn() |

### Optional Additions (NOT Required)
| Library | Purpose | Recommendation |
|---------|---------|----------------|
| @tanstack/react-virtual | Virtual scrolling for long lists | Consider if activity list exceeds 1000+ items |

**Installation:** No new packages required. All functionality can be built with existing stack.

## Architecture Patterns

### Existing Project Structure (Relevant)
```
server/src/
├── db/
│   ├── schema.ts                    # Add activity_log migration here
│   └── repositories/
│       ├── rules.ts                 # Has deletionHistory, scanHistory - pattern to follow
│       └── history.ts               # Pagination pattern to follow
├── routes/
│   └── activity.ts                  # Exists - needs enhancement
└── services/
    ├── deletion.ts                  # Logs to deletion_history - needs activity_log integration
    └── scanner.ts                   # Writes to scan_history - needs activity_log integration

client/src/
├── components/
│   ├── History/History.tsx          # Pattern to follow for Activity Log UI
│   └── common/
│       ├── EmptyState.tsx           # Use for empty activity states
│       └── ErrorState.tsx           # Use for error handling
└── hooks/
    └── useApi.ts                    # Add useActivityLog hook here
```

### Pattern 1: Unified Activity Log Table
**What:** Single table capturing all system events with consistent schema
**When to use:** Any action the user should see in the activity log
**Why:** Current reconstruction approach is slow and makes filtering difficult

```sql
-- Source: SQLite best practices for activity logs
CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,           -- 'scan', 'deletion', 'rule_match', 'protection', 'manual_action'
    action TEXT NOT NULL,               -- 'started', 'completed', 'failed', 'item_flagged', 'item_deleted'
    actor_type TEXT NOT NULL,           -- 'scheduler', 'user', 'rule'
    actor_id TEXT,                      -- rule_id for rules, 'system' for scheduler, null for user
    actor_name TEXT,                    -- Human-readable: "Daily Scan", "Unwatched 90 Days Rule", "Manual"
    target_type TEXT,                   -- 'media_item', 'rule', 'scan', null
    target_id INTEGER,                  -- media_item_id, rule_id, scan_id
    target_title TEXT,                  -- Cached for display without joins
    metadata TEXT,                      -- JSON: { fileSize, deletionType, matchedConditions, etc. }
    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Indexes for common queries
    CONSTRAINT valid_event_type CHECK (event_type IN ('scan', 'deletion', 'rule_match', 'protection', 'manual_action', 'error'))
);

CREATE INDEX idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX idx_activity_log_event_type ON activity_log(event_type);
CREATE INDEX idx_activity_log_actor_type ON activity_log(actor_type);
CREATE INDEX idx_activity_log_target_id ON activity_log(target_id);
```

### Pattern 2: Action Attribution
**What:** Clear distinction between automated scheduler actions, rule-triggered actions, and manual user actions
**When to use:** Every logged activity
**Current gap:** `deletion_type` in deletion_history only has 'automatic' vs 'manual'

```typescript
// Source: Current codebase pattern analysis
type ActorType = 'scheduler' | 'user' | 'rule';

interface ActivityLogEntry {
  eventType: 'scan' | 'deletion' | 'rule_match' | 'protection' | 'manual_action' | 'error';
  action: string;
  actorType: ActorType;
  actorId?: string;        // rule_id, 'scheduler', null for user
  actorName: string;       // "Scheduled Scan", "Unwatched 90+ Days", "Manual Action"
  targetType?: 'media_item' | 'rule' | 'scan';
  targetId?: number;
  targetTitle?: string;    // Denormalized for display
  metadata?: Record<string, unknown>;
}
```

### Pattern 3: Activity Repository with Pagination
**What:** Repository following existing history.ts pattern with filtering and pagination
**When to use:** For activity log API endpoint

```typescript
// Source: Existing server/src/db/repositories/history.ts pattern
export interface ActivityQueryParams {
  eventTypes?: string[];    // Filter by event type
  actorTypes?: string[];    // Filter by actor type
  page?: number;
  limit?: number;
  dateRange?: '24h' | '7d' | '30d' | 'all';
  search?: string;          // Search in target_title
}

export interface ActivityQueryResult {
  items: ActivityLogEntry[];
  total: number;
  page: number;
  limit: number;
}
```

### Pattern 4: TanStack Query Pagination
**What:** Standard pagination using existing useQuery pattern
**When to use:** Activity Log component data fetching
**Current usage:** Already used in History.tsx

```typescript
// Source: Existing client/src/hooks/useApi.ts pattern
export function useActivityLog(filters: ActivityFilters) {
  return useQuery({
    queryKey: ['activity', 'log', filters],
    queryFn: () => activityApi.getLog(filters),
  });
}
```

### Anti-Patterns to Avoid
- **Reconstructing activity from multiple tables at query time** - Current approach in activity.ts is slow
- **Missing actor attribution** - Every activity must specify who/what caused it
- **Overly complex joins** - Denormalize frequently-displayed data (titles, names)
- **Unbounded queries** - Always paginate activity results
- **Deleting activity logs** - Audit trail must be permanent

## Don't Hand-Roll

Problems that have existing solutions in the codebase:

| Problem | Don't Build | Use Instead | Location |
|---------|-------------|-------------|----------|
| Date formatting | Custom formatter | `formatRelativeTime()`, `formatDate()` | `lib/utils.ts` |
| File size display | Custom formatter | `formatBytes()` | `lib/utils.ts` |
| Pagination logic | Custom implementation | Existing pattern | `history.ts` repository |
| Empty states | Inline JSX | `EmptyState` component | `common/EmptyState.tsx` |
| Error handling | Ad-hoc try/catch | `ErrorState` component | `common/ErrorState.tsx` |
| Query state | Manual loading/error | TanStack Query hooks | `useApi.ts` |
| Table UI | Custom table | Existing table patterns | `History.tsx` |

**Key insight:** The History component already implements the exact UI pattern needed. The Activity Log can follow the same structure with different data schema.

## Common Pitfalls

### Pitfall 1: Logging Too Little vs Too Much
**What goes wrong:** Either missing critical events or overwhelming users with noise
**Why it happens:** No clear criteria for what constitutes a loggable event
**How to avoid:** Define explicit event categories aligned with requirements:
- LOG-01: All system actions (scans, queue processing, deletions)
- LOG-02: Attribution (scheduler vs manual vs rule)
- LOG-03: Deletion audit trail (permanent, detailed)
**Warning signs:** Users asking "what happened to X?" or log drowning in noise

### Pitfall 2: Expensive Queries on Growing Tables
**What goes wrong:** Activity page becomes slow as log grows
**Why it happens:** Missing indexes, unbounded queries, aggregation at query time
**How to avoid:**
- Index `created_at DESC` for reverse chronological queries
- Index `event_type` and `actor_type` for filtering
- Always limit results with pagination
- Consider retention policy for non-audit entries
**Warning signs:** Activity page taking >500ms to load

### Pitfall 3: Losing Attribution Context
**What goes wrong:** "Item deleted" with no indication of why or by what
**Why it happens:** Attribution stored separately or lost during async processing
**How to avoid:**
- Pass attribution context through entire deletion flow
- Store actor info at time of action, not reconstruction
- Include rule name in log, not just rule_id
**Warning signs:** Audit entries showing "Unknown" or empty actor fields

### Pitfall 4: Inconsistent Timestamps
**What goes wrong:** Events appear out of order or with wrong times
**Why it happens:** Mixing server time, client time, different formats
**How to avoid:**
- Always use `datetime('now')` in SQLite or `new Date().toISOString()` in code
- Store all timestamps as ISO 8601 strings
- Display using consistent formatting (formatRelativeTime)
**Warning signs:** "2 hours ago" followed by "3 hours ago" in list

### Pitfall 5: Missing Deletion Audit Permanence
**What goes wrong:** Deletion records lost when related data deleted
**Why it happens:** CASCADE DELETE on foreign keys, or accidental purging
**How to avoid:**
- Use `ON DELETE SET NULL` for foreign keys in activity_log
- Store denormalized copies of critical data (title, file size, rule name)
- Never provide "clear audit log" functionality
**Warning signs:** Orphaned deletion records with null references

## Code Examples

Verified patterns from the existing codebase:

### Existing Activity Route Structure
```typescript
// Source: server/src/routes/activity.ts (current implementation)
interface ActivityItem {
  id: string;
  type: 'scan' | 'delete' | 'rule' | 'restore';
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// Current approach reconstructs from multiple tables - to be replaced
router.get('/recent', (req: Request, res: Response) => {
  const activities: ActivityItem[] = [];

  // Gets from scan_history, deletion_history, media_items (flagged), media_items (protected)
  // Merges and sorts by timestamp
  // Returns limited results
});
```

### Existing Deletion History Schema
```sql
-- Source: server/src/db/schema.ts
CREATE TABLE deletion_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('movie', 'show', 'episode')),
  file_size INTEGER,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  deletion_type TEXT NOT NULL CHECK (deletion_type IN ('automatic', 'manual')),
  deleted_by_rule_id INTEGER,
  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE SET NULL,
  FOREIGN KEY (deleted_by_rule_id) REFERENCES rules(id) ON DELETE SET NULL
);
```

### Existing History Repository Pattern
```typescript
// Source: server/src/db/repositories/history.ts
export function getHistory(params: HistoryQueryParams): HistoryQueryResult {
  const db = getDatabase();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const offset = (page - 1) * limit;
  const dateRangeFilter = getDateRangeFilter(params.dateRange || 'all');

  // Build query with filters
  // Execute paginated query
  // Return with stats
  return { items, total, page, limit, stats };
}
```

### Existing History UI Pattern
```typescript
// Source: client/src/components/History/History.tsx
export default function History() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d'>('30d');

  const { data, isLoading, isError, error, refetch } = useDeletionHistory({
    search, page, limit: 20, dateRange,
  });

  // Loading skeleton
  // Error state
  // Empty state (filtered vs no data)
  // Table with pagination
}
```

## State of the Art

| Old Approach | Current Approach | Status in Codebase |
|--------------|------------------|-------------------|
| Scattered activity data | Unified activity_log table | Needs implementation |
| Reconstructing at query time | Direct table queries | Needs implementation |
| Binary automatic/manual | Full actor attribution | Partial (deletion_history has deletion_type) |
| No filtering | Event type + actor filtering | Needs implementation |
| Basic list | Filterable, paginated UI | Partial (History has this, Activity doesn't) |

**Gap analysis:**
- Deletion history tracks deletions with rule attribution - GOOD
- Scan history tracks scans - GOOD
- Activity aggregation exists but reconstructs data - NEEDS IMPROVEMENT
- No dedicated activity_log table - NEEDS IMPLEMENTATION
- No Activity Log page (only dashboard widget) - NEEDS IMPLEMENTATION

## Requirements Mapping

| Requirement | Implementation Approach |
|-------------|------------------------|
| LOG-01: Timestamped activity log in reverse chronological order | `activity_log` table with `created_at DESC` index, paginated API |
| LOG-02: Distinguish automated from manual actions | `actor_type` field: 'scheduler', 'user', 'rule' with `actor_name` for display |
| LOG-03: Permanent deletion audit trail | Existing `deletion_history` table + enhanced activity_log entries with denormalized data |

## Open Questions

Things that couldn't be fully resolved:

1. **Retention policy for activity_log**
   - What we know: Deletion history should be permanent (audit trail requirement)
   - What's unclear: Should all activity types be permanent, or can older scan/flag events be pruned?
   - Recommendation: Keep all entries; storage is cheap, audit value is high. Revisit if table exceeds 100K rows.

2. **Real-time activity updates**
   - What we know: Dashboard activity widget refreshes every 30 seconds
   - What's unclear: Should Activity Log page have real-time updates?
   - Recommendation: Start with manual refresh / refetch on return; add WebSocket later if needed.

3. **Activity log export**
   - What we know: History has CSV export
   - What's unclear: Does Activity Log need export?
   - Recommendation: Consider for Phase 2 or defer; deletion_history export may be sufficient for audit.

## Sources

### Primary (HIGH confidence)
- Local codebase analysis: `server/src/db/schema.ts`, `server/src/routes/activity.ts`, `server/src/db/repositories/history.ts`
- Local codebase analysis: `client/src/components/History/History.tsx`, `client/src/hooks/useApi.ts`
- [TanStack Query Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries) - Pagination patterns

### Secondary (MEDIUM confidence)
- [Understanding User Activity Logs in SQLite](https://peerdh.com/blogs/programming-insights/understanding-user-activity-logs-in-sqlite-databases) - SQLite logging patterns
- [Step-by-Step Guide to Implementing Node.js Audit Trail](https://dev.to/williamsgqdev/step-by-step-guide-to-implementing-nodejs-audit-trail-jic) - Audit trail schema design
- [Guide to Building Audit Logs for Application Software](https://medium.com/@tony.infisical/guide-to-building-audit-logs-for-application-software-b0083bb58604) - Actor/action/target pattern
- [SQLite Best Practices](https://www.dragonflydb.io/databases/best-practices/sqlite) - Indexing and performance

### Tertiary (LOW confidence)
- [shadcn/ui Activity Log Table Block](https://www.shadcn.io/blocks/tables-activity-log) - UI component patterns (reference only, not using this library)
- [React-Admin ra-audit-log](https://react-admin-ee.marmelab.com/documentation/ra-audit-log) - Commercial library patterns (reference only)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Direct codebase inspection confirms all libraries available
- Architecture: HIGH - Patterns extracted from existing code and established SQLite practices
- Requirements mapping: HIGH - Clear alignment between requirements and proposed implementation
- Pitfalls: MEDIUM - Based on industry best practices and codebase patterns

**Research date:** 2026-01-22
**Valid until:** 60 days (stable patterns, established codebase)
