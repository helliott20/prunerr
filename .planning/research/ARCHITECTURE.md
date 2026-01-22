# Architecture Patterns

**Domain:** Media Library Management - Polish/Integration Phase
**Researched:** 2026-01-22
**Confidence:** HIGH (based on existing codebase analysis + industry patterns)

## Current Architecture Analysis

The existing Prunerr codebase follows a well-structured monorepo pattern with clear separation:

```
library-manager/
  server/           # Express backend (TypeScript)
    src/
      config/       # Configuration management
      db/           # SQLite with better-sqlite3, repositories
      notifications/# Partially implemented notification service
      routes/       # Express route handlers
      rules/        # Rule engine for media evaluation
      scheduler/    # Task scheduling (node-cron)
      services/     # External service integrations (Plex, Sonarr, etc.)
      utils/        # Logger (Winston), helpers
  client/           # React frontend (TypeScript + Vite)
    src/
      components/   # React components
      hooks/        # TanStack Query hooks
      services/     # API client
```

### Existing Patterns (Strengths)

1. **Repository Pattern** - Database access via repositories (`db/repositories/`)
2. **Service Layer** - External integrations as services (`services/`)
3. **Singleton Services** - `getDeletionService()`, `getNotificationService()`
4. **Hook-based API** - TanStack Query for server state (`hooks/useApi.ts`)
5. **Zod Validation** - Schema validation on settings routes

## Recommended Architecture for Polish Features

### Component Boundaries

| Component | Responsibility | Location | Communicates With |
|-----------|---------------|----------|-------------------|
| **NotificationService** | Send email/Discord/Telegram | `server/src/notifications/` | Config, External APIs |
| **ActivityLogRepository** | Persist activity events | `server/src/db/repositories/` | Database |
| **SettingsService** | CRUD + validation for settings | `server/src/services/` | SettingsRepository, NotificationService |
| **HealthService** | Aggregate service statuses | `server/src/services/` | All external services |
| **SettingsUI** | Form state, validation, save | `client/src/components/Settings/` | Settings API |
| **DashboardHealth** | Display service indicators | `client/src/components/Dashboard/` | Health API |

---

## Pattern 1: Event-Driven Notification Integration

**What:** Use event notification pattern where system events trigger notifications through a central dispatcher.

**Current State:** Notification service exists (`server/src/notifications/index.ts`) but is not wired into the application. Tasks in `scheduler/tasks.ts` reference `notificationService.notify()` but dependencies are not injected.

**Integration Pattern:**

```typescript
// Pattern: Event-based notification dispatch
// Location: server/src/notifications/dispatcher.ts

export type NotificationEvent =
  | 'SCAN_COMPLETE'
  | 'DELETION_COMPLETE'
  | 'DELETION_IMMINENT'
  | 'SERVICE_ERROR'
  | 'RULE_TRIGGERED';

interface EventPayload {
  event: NotificationEvent;
  data: Record<string, unknown>;
  timestamp: Date;
}

// Emit from anywhere in the app
eventDispatcher.emit('SCAN_COMPLETE', {
  itemsScanned: 100,
  itemsFlagged: 5,
});

// NotificationService subscribes to these events
notificationService.subscribe((event) => {
  this.notify(event.type, event.data);
});
```

**Where it fits in existing code:**
- Wire into `scheduler/tasks.ts` - replace direct `notify()` calls with event emission
- Wire into `services/deletion.ts` - emit on deletion completion
- Wire into `routes/scan.ts` - emit on manual scan completion

**Why this pattern:** Decouples notification logic from business logic. Existing code already has the structure (`TaskDependencies.notificationService`) - just needs proper wiring.

---

## Pattern 2: Activity Logging Architecture

**Decision: SQLite over Flat Files**

| Criteria | SQLite | Flat File |
|----------|--------|-----------|
| Query flexibility | HIGH - SQL queries | LOW - parse entire file |
| Pagination | Native LIMIT/OFFSET | Manual implementation |
| Filtering by type/date | Native WHERE clauses | Custom parsing |
| Concurrent access | WAL mode handles it | Lock contention |
| Existing infrastructure | Already using SQLite | New system needed |
| Rotation/cleanup | SQL DELETE statements | File rotation logic |

**Recommendation:** Use SQLite. The codebase already uses SQLite with better-sqlite3 and WAL mode. Adding an `activity_log` table is trivial.

**Schema Pattern:**

```sql
-- New table for activity logging
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,           -- 'scan', 'delete', 'rule', 'restore', 'error'
  severity TEXT NOT NULL DEFAULT 'info', -- 'debug', 'info', 'warn', 'error'
  message TEXT NOT NULL,
  metadata TEXT,                       -- JSON for flexible extra data
  related_item_id INTEGER,             -- FK to media_items if applicable
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_activity_log_type ON activity_log(event_type);
CREATE INDEX idx_activity_log_created ON activity_log(created_at);
CREATE INDEX idx_activity_log_severity ON activity_log(severity);
```

**Current vs Proposed Activity Logging:**

The current `/api/activity/recent` endpoint reconstructs activity from multiple tables (scan_history, deletion_history, media_items). This is:
- Slow (multiple table scans)
- Limited (only certain event types)
- Hard to extend

**Proposed:** Single `activity_log` table with repository:

```typescript
// Pattern: Activity Log Repository
// Location: server/src/db/repositories/activityLog.ts

export interface ActivityLogEntry {
  id: number;
  event_type: ActivityEventType;
  severity: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
  related_item_id?: number;
  created_at: string;
}

export function logActivity(entry: Omit<ActivityLogEntry, 'id' | 'created_at'>): void;
export function getRecentActivity(limit: number, filters?: ActivityFilters): ActivityLogEntry[];
export function pruneOldEntries(olderThanDays: number): number;
```

**Integration Points:**
- Add logging calls in `scheduler/tasks.ts` for scan/deletion events
- Add logging calls in `services/deletion.ts` for deletion actions
- Add logging calls in `routes/rules.ts` for rule changes
- Existing `/api/activity/recent` route queries new table instead

---

## Pattern 3: Settings Architecture

**Current State:** Settings use a flat key-value table with prefix conventions:
- `plex_url`, `plex_token`
- `notifications_emailEnabled`, `notifications_discordWebhook`
- `schedule_enabled`, `schedule_interval`

**This is a good pattern.** Keep it, but improve:

### Backend Settings Service

```typescript
// Pattern: Settings Service Layer
// Location: server/src/services/settings.ts

export interface SettingsSchema {
  services: {
    plex: { url: string; token: string };
    tautulli: { url: string; apiKey: string };
    sonarr: { url: string; apiKey: string };
    radarr: { url: string; apiKey: string };
    overseerr: { url: string; apiKey: string };
    unraid: { url: string; apiKey: string };
  };
  notifications: {
    emailEnabled: boolean;
    emailAddress?: string;
    discordEnabled: boolean;
    discordWebhook?: string;
    telegramEnabled: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
  };
  schedule: {
    enabled: boolean;
    interval: 'hourly' | 'daily' | 'weekly';
    time: string;
    autoProcess: boolean;
  };
}

// Validation with Zod
const SettingsSchema = z.object({
  services: z.object({ /* ... */ }),
  notifications: z.object({ /* ... */ }),
  schedule: z.object({ /* ... */ }),
});

// Typed getters/setters
export function getSettings(): SettingsSchema;
export function updateSettings(settings: Partial<SettingsSchema>): SettingsSchema;
export function validateSettings(settings: unknown): ValidationResult;
```

### Frontend Settings Pattern

**Current State:** `Settings.tsx` uses local state + TanStack Query. This is appropriate.

**Recommendation:** Keep current pattern but structure into sub-components:

```typescript
// Pattern: Settings Sub-components
// Location: client/src/components/Settings/

Settings.tsx                 // Main container, orchestrates save
  ServiceConnectionsCard.tsx // Plex, Tautulli, Sonarr, etc.
  NotificationsCard.tsx      // Email, Discord, Telegram toggles
  ScheduleCard.tsx           // Scan schedule configuration

// Shared form state via parent, passed down as props
// Save button at parent level triggers bulk save
```

**Why keep local state:** Settings forms are local UI state that syncs to server on save. TanStack Query handles server state. This matches [2026 best practices](https://www.c-sharpcorner.com/article/state-management-in-react-2026-best-practices-tools-real-world-patterns/) - use the right tool for the state type.

---

## Pattern 4: Health Indicators Architecture

**Current State:** `/api/health` endpoint exists, returns:
- Database status
- Service configuration flags (configured: true/false)

**Enhancement Pattern:**

```typescript
// Pattern: Health Aggregator
// Location: server/src/services/health.ts

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured';
  lastCheck: string;
  responseTimeMs?: number;
  error?: string;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  database: ServiceHealth;
  services: Record<string, ServiceHealth>;
  metrics: {
    uptime: number;
    lastScan?: string;
    pendingDeletions: number;
  };
}

// Background health checks (not on every request)
export class HealthService {
  private cache: Map<string, ServiceHealth> = new Map();
  private checkInterval = 60000; // 1 minute

  async checkService(name: string): Promise<ServiceHealth>;
  async checkAll(): Promise<SystemHealth>;
  getCached(): SystemHealth;
}
```

**Frontend Pattern:**

```typescript
// Pattern: Health Indicator Component
// Location: client/src/components/Dashboard/HealthIndicators.tsx

interface HealthIndicatorProps {
  services: ServiceHealth[];
}

// Uses react-query with refetchInterval for live updates
function useSystemHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: healthApi.getStatus,
    refetchInterval: 60000,
    staleTime: 30000,
  });
}
```

---

## Data Flow Diagram

```
User Action (UI)
       |
       v
React Component (client/src/components/)
       |
       v
TanStack Query Hook (client/src/hooks/useApi.ts)
       |
       v
API Client (client/src/services/api.ts)
       |
       | HTTP
       v
Express Router (server/src/routes/)
       |
       v
Service Layer (server/src/services/)
       |          |
       v          v
Repository    External APIs
(server/src/db/repositories/)
       |
       v
SQLite Database (better-sqlite3)
```

### Notification Flow

```
System Event (scan complete, deletion, error)
       |
       v
Event Dispatcher (emit event)
       |
       v
NotificationService (subscribed listener)
       |
       +---> Email (nodemailer)
       +---> Discord (webhook POST)
       +---> Telegram (Bot API)
       |
       v
Activity Log Repository (persist event)
```

---

## Build Order (Dependencies)

Based on component dependencies, implement in this order:

### Phase 1: Foundation (No Dependencies)
1. **Activity Log Table + Repository**
   - Add migration for `activity_log` table
   - Create `activityLog.ts` repository
   - No external dependencies

2. **Settings Service Enhancement**
   - Add Zod schema validation
   - Type the settings structure
   - Builds on existing settings repository

### Phase 2: Integration (Depends on Phase 1)
3. **Notification Service Wiring**
   - Wire NotificationService into scheduler tasks
   - Depends on: Activity Log (to log notification events)

4. **Health Service**
   - Aggregate health checks
   - Depends on: External services (already exist)

### Phase 3: UI (Depends on Phase 1 & 2)
5. **Settings UI Polish**
   - Notification configuration section
   - Depends on: Notification service wiring

6. **Dashboard Health Indicators**
   - Service status display
   - Depends on: Health service API

### Dependency Graph

```
[Activity Log] ----+
                   |
[Settings Service] +---> [Notification Wiring] ---> [Settings UI]
                   |
[Health Service] --+---------------------------> [Dashboard Health]
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Polling for Health on Every Request

**What:** Checking external service health on every dashboard load.

**Why bad:** Slow dashboard loads, unnecessary API calls, rate limiting issues.

**Instead:** Cache health status with background refresh:
```typescript
// Good: Background health checks
setInterval(() => healthService.checkAll(), 60000);
const cachedHealth = healthService.getCached();

// Bad: Check on every request
router.get('/health', async (req, res) => {
  const health = await checkAllServicesNow(); // Slow!
});
```

### Anti-Pattern 2: Storing Activity in Multiple Tables

**What:** Current pattern of reconstructing activity from scan_history + deletion_history + media_items.

**Why bad:** Multiple table scans, complex queries, hard to add new event types.

**Instead:** Single `activity_log` table with event type discriminator.

### Anti-Pattern 3: Global Notification Configuration Only

**What:** Single global notification config with no per-event customization.

**Why bad:** Users get notifications for everything or nothing.

**Instead:** Allow per-event-type notification preferences:
```typescript
// Better pattern
notifications: {
  channels: { email: true, discord: true },
  events: {
    scan_complete: { email: true, discord: false },
    deletion_imminent: { email: true, discord: true },
    service_error: { email: false, discord: true },
  }
}
```

### Anti-Pattern 4: Settings Form Without Optimistic Updates

**What:** Waiting for server response before updating UI on settings save.

**Why bad:** Sluggish UX, user uncertainty.

**Instead:** Use TanStack Query's optimistic updates:
```typescript
const saveMutation = useMutation({
  mutationFn: settingsApi.save,
  onMutate: async (newSettings) => {
    await queryClient.cancelQueries({ queryKey: ['settings'] });
    const previous = queryClient.getQueryData(['settings']);
    queryClient.setQueryData(['settings'], newSettings);
    return { previous };
  },
  onError: (err, newSettings, context) => {
    queryClient.setQueryData(['settings'], context.previous);
  },
});
```

---

## File Locations Summary

| New/Modified File | Purpose |
|------------------|---------|
| `server/src/db/schema.ts` | Add `activity_log` table migration |
| `server/src/db/repositories/activityLog.ts` | **NEW** - Activity log CRUD |
| `server/src/services/settings.ts` | **NEW** - Typed settings service |
| `server/src/services/health.ts` | **NEW** - Health aggregation service |
| `server/src/notifications/dispatcher.ts` | **NEW** - Event dispatcher |
| `server/src/notifications/index.ts` | Wire to dispatcher, add recipients |
| `server/src/scheduler/tasks.ts` | Inject notification dependencies |
| `server/src/routes/activity.ts` | Use new activityLog repository |
| `server/src/routes/health.ts` | Use new health service |
| `client/src/components/Settings/` | Refactor into sub-components |
| `client/src/components/Dashboard/HealthIndicators.tsx` | **NEW** - Health display |

---

## Scalability Considerations

| Concern | Current (Small Scale) | At Scale | Notes |
|---------|----------------------|----------|-------|
| Activity Log Growth | Keep all entries | Prune entries > 30 days | Add cleanup cron job |
| Health Check Frequency | Every 60s | Every 5min, on-demand | Background checks only |
| Settings Updates | Immediate refresh | Debounce/throttle | Already handled by TanStack Query |
| Notification Rate | Send all | Rate limit per channel | Discord has 30/min limit |

---

## Sources

- [Event-Driven Architecture in JavaScript](https://www.freecodecamp.org/news/event-based-architectures-in-javascript-a-handbook-for-devs/) - Event notification pattern
- [State Management in React 2026](https://www.c-sharpcorner.com/article/state-management-in-react-2026-best-practices-tools-real-world-patterns/) - Settings form patterns
- [React Health Dashboard](https://github.com/keetmalin/react-health-dashboard) - Health indicator component patterns
- [Discord Webhook Integration](https://javascript.plainenglish.io/discord-event-relay-bot-with-node-js-webhooks-and-postgresql-b6c252346ed2) - Webhook notification patterns
- [Express Database Integration](https://expressjs.com/en/guide/database-integration.html) - SQLite best practices
- [Webhooks Best Practices](https://thenewstack.io/webhooks-the-building-blocks-of-an-event-driven-architecture/) - Event notification architecture
