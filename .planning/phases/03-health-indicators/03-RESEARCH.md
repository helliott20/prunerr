# Phase 3: Health Indicators - Research

**Researched:** 2026-01-22
**Domain:** Service health checks, scheduling, React status indicators
**Confidence:** HIGH

## Summary

This phase implements health indicators showing service connection status, last scan timestamp, and next scheduled run time. The research reveals the existing codebase is well-positioned for this feature:

1. **All services already have `testConnection()` methods** - Plex, Radarr, Sonarr, Tautulli, and Overseerr services all implement connection testing that returns boolean status. These methods are proven and just need to be exposed via a new API endpoint.

2. **The scheduler already tracks job status** - The `Scheduler` class maintains `JobStatus` objects with `lastRun`, `nextRun`, and `schedule` information. The `getNextRunTime()` method exists but has a simplified implementation that should be upgraded to use `cron-parser` for accurate calculations.

3. **Scan history is already stored** - The `scanHistoryRepo` has `getLatest()` which returns the most recent scan including `completed_at` timestamp. This just needs to be exposed to the frontend.

**Primary recommendation:** Add a single `/api/health/status` endpoint that aggregates service connection tests, scheduler status, and scan history into one response. Use TanStack Query's `refetchInterval` for 30-60 second polling on the frontend.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cron-parser | ^5.4.0 | Parse cron expressions and calculate next run times | Standard library for cron parsing, TypeScript support, 933 dependents |
| @tanstack/react-query | ^5.90.19 | Data fetching with polling support | Already in use, has `refetchInterval` for status polling |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | ^4.1.0 | Format relative timestamps | Already in use for `formatRelativeTime` |
| lucide-react | ^0.562.0 | Status indicator icons | Already in use for UI icons |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| cron-parser | croner | croner has more features but cron-parser is lighter and sufficient for next-run calculation |
| Polling | WebSockets | WebSockets would be real-time but adds complexity; 30-60s polling is sufficient for health status |

**Installation:**
```bash
cd server && npm install cron-parser
```

## Architecture Patterns

### Recommended Project Structure
```
server/src/
├── routes/
│   └── health.ts           # Extend existing with /api/health/status endpoint
├── scheduler/
│   └── index.ts            # Upgrade getNextRunTime() to use cron-parser
└── services/
    └── *.ts                # Existing testConnection() methods - no changes needed

client/src/
├── hooks/
│   └── useApi.ts           # Add useHealthStatus() hook with polling
├── components/
│   └── Health/
│       ├── ServiceStatusIndicator.tsx   # Individual service status dot + label
│       ├── SystemHealthCard.tsx         # Dashboard card showing all services
│       └── ScheduleInfoCard.tsx         # Last scan + next run display
└── types/
    └── index.ts            # Add HealthStatus types
```

### Pattern 1: Aggregated Health Endpoint
**What:** Single endpoint that calls all service connection tests and returns combined status
**When to use:** Dashboard health display, settings page connection verification
**Example:**
```typescript
// Source: Based on existing health.ts pattern
interface ServiceHealthStatus {
  service: string;
  configured: boolean;
  connected: boolean;
  responseTimeMs?: number;
  error?: string;
  lastChecked: string;
}

interface SystemHealthResponse {
  services: ServiceHealthStatus[];
  scheduler: {
    isRunning: boolean;
    lastScan: string | null;
    nextRun: string | null;
    scanSchedule: string;
  };
  overall: 'healthy' | 'degraded' | 'unhealthy';
}

// GET /api/health/status
router.get('/status', async (_req: Request, res: Response) => {
  const serviceResults = await Promise.allSettled([
    checkService('plex', plexService),
    checkService('radarr', radarrService),
    checkService('sonarr', sonarrService),
    checkService('tautulli', tautulliService),
    checkService('overseerr', overseerrService),
  ]);

  const scheduler = getScheduler();
  const latestScan = scanHistoryRepo.getLatest();

  res.json({
    success: true,
    data: {
      services: serviceResults.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason }),
      scheduler: {
        isRunning: scheduler.isSchedulerRunning(),
        lastScan: latestScan?.completed_at || null,
        nextRun: scheduler.getJobStatus('scanLibraries')?.nextRun?.toISOString() || null,
        scanSchedule: scheduler.getConfig().schedules.scanLibraries,
      },
      overall: determineOverallHealth(serviceResults),
    },
  });
});
```

### Pattern 2: Service Status Indicator Component
**What:** Reusable component showing colored dot + service name + optional tooltip
**When to use:** Any place showing service connection status
**Example:**
```typescript
// Source: Based on existing Badge and color patterns in Dashboard.tsx
interface ServiceStatusIndicatorProps {
  name: string;
  configured: boolean;
  connected: boolean;
  error?: string;
  loading?: boolean;
}

function ServiceStatusIndicator({ name, configured, connected, error, loading }: ServiceStatusIndicatorProps) {
  const status = !configured ? 'unconfigured' : connected ? 'connected' : 'disconnected';

  const statusConfig = {
    unconfigured: { color: 'bg-surface-500', text: 'text-surface-400', label: 'Not configured' },
    connected: { color: 'bg-emerald-500', text: 'text-emerald-400', label: 'Connected' },
    disconnected: { color: 'bg-ruby-500', text: 'text-ruby-400', label: 'Disconnected' },
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        'w-2 h-2 rounded-full',
        loading ? 'bg-amber-500 animate-pulse' : config.color
      )} />
      <span className="text-sm text-surface-200">{name}</span>
      <span className={cn('text-xs', config.text)}>{loading ? 'Checking...' : config.label}</span>
    </div>
  );
}
```

### Pattern 3: Polling with TanStack Query
**What:** Automatic background polling using `refetchInterval`
**When to use:** Health status that needs periodic updates without manual refresh
**Example:**
```typescript
// Source: https://tanstack.com/query/v4/docs/framework/react/reference/useQuery
export function useHealthStatus() {
  return useQuery({
    queryKey: ['health', 'status'],
    queryFn: healthApi.getStatus,
    refetchInterval: 30000, // Poll every 30 seconds
    refetchIntervalInBackground: false, // Stop when tab is inactive
    staleTime: 15000, // Consider data stale after 15 seconds
    retry: 1, // Only retry once on failure
  });
}
```

### Anti-Patterns to Avoid
- **Sequential service checks:** Call all service tests in parallel with `Promise.allSettled` to avoid slow response times
- **Polling too frequently:** 30-60 seconds is appropriate for health status; more frequent wastes resources
- **Blocking on connection tests:** Use timeouts on service tests to prevent slow/unresponsive services from hanging the endpoint
- **Caching health status too long:** Health status should have short stale time (15s) to reflect actual state

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron next-run calculation | Manual date math from cron string | `cron-parser` | Edge cases: DST, month boundaries, leap years, timezone handling |
| Relative time display | Custom "2 hours ago" function | `date-fns` `formatDistanceToNow` | Already in use as `formatRelativeTime`, handles all edge cases |
| Service connection testing | New test methods | Existing `testConnection()` | Already implemented in all 5 services with proper error handling |
| Polling state management | `setInterval` + useState | TanStack Query `refetchInterval` | Handles stale data, background tabs, error states automatically |

**Key insight:** The existing codebase already has 90% of the functionality needed. This phase is primarily about exposing existing capabilities through a new endpoint and creating frontend components to display them.

## Common Pitfalls

### Pitfall 1: Sequential Service Checks Causing Slow Response
**What goes wrong:** Calling services one-by-one makes endpoint slow (5x service timeout)
**Why it happens:** Developer uses `await` in a loop instead of parallel execution
**How to avoid:** Use `Promise.allSettled()` for parallel execution with individual error handling
**Warning signs:** Health endpoint takes >10 seconds to respond

### Pitfall 2: Connection Tests Without Timeouts
**What goes wrong:** One unresponsive service hangs the entire health check
**Why it happens:** Service tests use default axios timeout (30s) which is too long for health checks
**How to avoid:** Override timeout to 5-10 seconds for health checks specifically
**Warning signs:** Dashboard shows "loading" indefinitely when one service is down

### Pitfall 3: Polling Continues When Tab Not Visible
**What goes wrong:** Battery drain, unnecessary API calls when user not looking
**Why it happens:** Default polling behavior doesn't check visibility
**How to avoid:** Set `refetchIntervalInBackground: false` in TanStack Query
**Warning signs:** High API traffic from idle clients

### Pitfall 4: Incorrect Next Run Time Due to Timezone
**What goes wrong:** "Next scan at 3 AM" shows wrong time for user's timezone
**Why it happens:** Server calculates next run in UTC, displays without conversion
**How to avoid:** Return ISO timestamp from server, format in user's timezone on frontend
**Warning signs:** Next run time doesn't match when scan actually runs

### Pitfall 5: Missing Loading States for Slow Checks
**What goes wrong:** UI shows stale data without indicating refresh in progress
**Why it happens:** Only checking `isLoading` not `isFetching` for background updates
**How to avoid:** Use `isFetching` to show subtle loading indicator during background refresh
**Warning signs:** Status appears stale but no visual indication of refresh

## Code Examples

Verified patterns from official sources:

### Cron Expression Parsing with cron-parser
```typescript
// Source: https://github.com/harrisiirak/cron-parser
import { CronExpressionParser } from 'cron-parser';

function getNextRunTime(cronExpression: string, timezone?: string): Date | null {
  try {
    const options = {
      currentDate: new Date(),
      tz: timezone || 'UTC',
    };

    const interval = CronExpressionParser.parse(cronExpression, options);
    return interval.next().toDate();
  } catch (error) {
    logger.error('Failed to parse cron expression', { cronExpression, error });
    return null;
  }
}

// Usage in scheduler
getNextRunTime('0 3 * * *', 'America/New_York'); // Next occurrence of 3 AM Eastern
```

### TanStack Query Polling Hook
```typescript
// Source: https://tanstack.com/query/v4/docs/framework/react/reference/useQuery
import { useQuery } from '@tanstack/react-query';

export const queryKeys = {
  healthStatus: ['health', 'status'] as const,
};

export function useHealthStatus() {
  return useQuery({
    queryKey: queryKeys.healthStatus,
    queryFn: async () => {
      const response = await api.get<ApiResponse<SystemHealthResponse>>('/health/status');
      return response.data.data!;
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    staleTime: 15000,
    retry: 1,
    // Show previous data while fetching new data
    placeholderData: (previousData) => previousData,
  });
}
```

### Status Indicator with Animation
```typescript
// Source: Based on existing Dashboard.tsx patterns
function ConnectionStatusDot({
  status,
  loading
}: {
  status: 'connected' | 'disconnected' | 'unconfigured';
  loading?: boolean;
}) {
  const colors = {
    connected: 'bg-emerald-500',
    disconnected: 'bg-ruby-500',
    unconfigured: 'bg-surface-500',
  };

  return (
    <span className={cn(
      'w-2 h-2 rounded-full transition-colors',
      loading ? 'bg-amber-500 animate-pulse' : colors[status]
    )} />
  );
}
```

### Promise.allSettled for Parallel Service Checks
```typescript
// Source: Standard JavaScript pattern
async function checkAllServices(): Promise<ServiceHealthStatus[]> {
  const serviceConfigs = [
    { name: 'plex', service: getPlexService() },
    { name: 'radarr', service: getRadarrService() },
    { name: 'sonarr', service: getSonarrService() },
    { name: 'tautulli', service: getTautulliService() },
    { name: 'overseerr', service: getOverseerrService() },
  ];

  const checks = serviceConfigs.map(async ({ name, service }) => {
    if (!service) {
      return { service: name, configured: false, connected: false };
    }

    const startTime = Date.now();
    try {
      const connected = await service.testConnection();
      return {
        service: name,
        configured: true,
        connected,
        responseTimeMs: Date.now() - startTime,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return {
        service: name,
        configured: true,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date().toISOString(),
      };
    }
  });

  const results = await Promise.allSettled(checks);
  return results.map(r => r.status === 'fulfilled' ? r.value : { error: 'Check failed' });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual cron date math | cron-parser library | 2020+ | Handles DST, timezones, complex expressions correctly |
| setInterval polling | TanStack Query refetchInterval | 2022+ | Automatic stale/error handling, background tab awareness |
| Individual health endpoints | Aggregated health endpoint | Current best practice | Single request for all health data, better UX |

**Deprecated/outdated:**
- `node-cron` getNextDate: The built-in method is simplified and doesn't handle all cron expressions correctly. Use `cron-parser` for accurate next-run calculation.

## Open Questions

Things that couldn't be fully resolved:

1. **Connection Test Timeout Override**
   - What we know: Existing services use 30s timeout; health checks should be faster
   - What's unclear: Whether to modify axios instance or create new client for health checks
   - Recommendation: Create wrapper function that races test with 5s timeout, avoids modifying service internals

2. **Health Check Frequency in Production**
   - What we know: 30s polling is reasonable; background polling should be disabled
   - What's unclear: Whether heavy Unraid installations with many disks need longer intervals
   - Recommendation: Start with 30s, make configurable if users report issues

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis - `/server/src/services/*.ts` testConnection methods
- Existing codebase analysis - `/server/src/scheduler/index.ts` JobStatus interface
- Existing codebase analysis - `/server/src/db/repositories/scanHistoryRepo.ts` getLatest()
- [cron-parser GitHub](https://github.com/harrisiirak/cron-parser) - API documentation and TypeScript types

### Secondary (MEDIUM confidence)
- [TanStack Query useQuery Reference](https://tanstack.com/query/v4/docs/framework/react/reference/useQuery) - refetchInterval and polling options
- [cron-parser npm](https://www.npmjs.com/package/cron-parser) - Version and dependency information

### Tertiary (LOW confidence)
- Web search results for React health check patterns - General patterns, verify with implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - cron-parser is well-established, TanStack Query already in use
- Architecture: HIGH - Patterns derived directly from existing codebase
- Pitfalls: HIGH - Based on common issues observed in similar implementations

**Research date:** 2026-01-22
**Valid until:** 30 days (stable domain, libraries mature)
