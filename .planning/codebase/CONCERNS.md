# Codebase Concerns

**Analysis Date:** 2026-01-22

## Tech Debt

**Incomplete Notification Service Implementation:**
- Issue: Notification service is stubbed out with a TODO comment but not fully wired up
- Files: `server/src/services/init.ts` (line 201)
- Impact: Email notifications configured in settings won't be sent; users will not be alerted about deletions or system events
- Fix approach: Complete `server/src/notifications/index.ts` implementation and uncomment/implement the notificationService dependency wiring in `init.ts`

**TypeScript `any` Type Overuse:**
- Issue: 35 instances of `any` type casting throughout server code, primarily in deletion service and repositories
- Files: `server/src/services/deletion.ts` (lines 161, 236, 386), `server/src/services/init.ts` (lines 100, 109, 122, 123), `server/src/routes/media.ts`
- Impact: Type safety is compromised; refactoring becomes risky; runtime errors possible from incorrect type assumptions
- Fix approach: Replace `any` casts with proper interfaces; create type-safe adapter layer between database and application types

**Environment Configuration Loading Order Issues:**
- Issue: Three sequential dotenv.config() calls in `server/src/index.ts` (lines 5-7) attempting to load from different paths
- Files: `server/src/index.ts`
- Impact: Confusing loading precedence; may load stale values from wrong .env file; difficult to debug which env vars are actually used
- Fix approach: Consolidate to single, explicit .env path resolution; document which file takes precedence

**Hardcoded Plex Token in Image URLs:**
- Issue: Plex authentication tokens are included directly in image URLs (server/src/services/plex.ts line 390)
- Files: `server/src/services/plex.ts` (line 385-391)
- Impact: If URLs are logged, exposed in error messages, or cached by proxies, auth tokens could be leaked; violates security best practice of not including secrets in URLs
- Fix approach: Implement server-side image proxy that serves authenticated images without exposing tokens to client; use secure cookie-based authentication instead

**Request Parameter Validation Gaps:**
- Issue: Some query parameters parsed with parseInt() without bounds checking; history search uses raw query parameters
- Files: `server/src/routes/stats.ts` (limit, unwatchedDays), `server/src/routes/history.ts` (search, dateRange)
- Impact: Unbounded integers could cause memory issues; unsanitized search strings could expose information in logs or error messages
- Fix approach: Add Zod validation schemas for all query parameters with min/max constraints; sanitize search inputs

**Missing Error Context in Catch Blocks:**
- Issue: Many catch blocks lack specific error type checking; generic error handling with `error as AxiosError`
- Files: `server/src/services/plex.ts`, `server/src/services/tautulli.ts`, `server/src/rules/conditions.ts`
- Impact: Difficult to distinguish between different failure modes (network, auth, data); hard to recover from specific errors
- Fix approach: Implement custom error classes; add type guards in catch blocks; log context about what was being attempted

## Known Bugs

**Timezone Handling in Deletion Grace Period:**
- Symptoms: Grace period calculation uses local timezone but doesn't account for daylight saving time; inconsistent behavior across deployments
- Files: `server/src/services/deletion.ts` (lines 150-152)
- Trigger: Mark item for deletion on day 1, check remaining days after DST transition
- Workaround: Always calculate days remaining fresh from current date rather than cached values

**Incomplete .env File in Repository:**
- Symptoms: `.env` file exists in repo with just `PORT=3001` while `.env.example` has full configuration
- Files: `/home/harry/projects/library-manager/.env` (2 lines)
- Trigger: Checking git history or deploying to new environment
- Workaround: Copy and configure .env.example manually; ensure .env is properly gitignored

**Query Cache Invalidation Timing Issues:**
- Symptoms: React Query invalidation occurs immediately after mutation, but backend scan runs asynchronously; UI shows stale data until next refetch
- Files: `client/src/hooks/useApi.ts` (lines 92-100, useSync​Library polling strategy)
- Trigger: Trigger library sync, immediately check dashboard stats
- Workaround: Increase polling intervals or implement WebSocket-based real-time updates

**Missing Service Connection Initialization Order:**
- Symptoms: DeletionService dependencies set up in initializeServices() but some services may not be initialized if config is incomplete
- Files: `server/src/services/init.ts` (lines 129-176)
- Trigger: Missing Sonarr/Radarr config results in silently skipped deletion operations
- Workaround: Log warning about which services are not configured; document which features require which services

## Security Considerations

**Exposed API Tokens in Error Messages:**
- Risk: Plex tokens, API keys may be logged when axios requests fail; error responses might include Authorization headers
- Files: `server/src/services/plex.ts`, `server/src/services/tautulli.ts`, `server/src/services/sonarr.ts`, `server/src/services/radarr.ts`
- Current mitigation: winston logger in production doesn't expose stack traces; Tautulli logging masks API key (substring to 4 chars)
- Recommendations: Implement request/response sanitization middleware; never log Authorization headers; mask all API keys in logs; sanitize error messages for production

**SMTP Password in Settings:**
- Risk: SMTP password stored in unencrypted database; accessible through settings API if not properly protected
- Files: `server/src/db/repositories/settings.ts`, `server/src/routes/settings.ts`
- Current mitigation: Settings API exists but auth protection not visible in routes; SMTP password not used until notifications implemented
- Recommendations: Encrypt sensitive settings at rest; implement auth middleware on settings routes; use environment variables for SMTP credentials instead of database

**Rate Limiting Not Implemented:**
- Risk: No rate limiting on API endpoints; scanner can make unlimited Plex API calls; deletion queue can process unlimited items
- Files: `server/src/routes/library.ts`, `server/src/routes/queue.ts`
- Current mitigation: Plex service has 429 rate limit handling with exponential backoff; no other services implement rate limiting
- Recommendations: Add express-rate-limit middleware; implement per-user rate limits; add backoff strategy for external service calls

**CORS Configuration Too Permissive:**
- Risk: In development, CORS origin is set to `true` (allow all); in production, falls back to env var which may not be set
- Files: `server/src/index.ts` (lines 37-44)
- Current mitigation: Production mode requires CORS_ORIGIN env var or defaults to true
- Recommendations: Never allow all origins in production; default to localhost; whitelist specific origins

## Performance Bottlenecks

**Synchronous Database Initialization in Shutdown Handlers:**
- Problem: Database and shutdown handlers registered globally on module import in `server/src/db/index.ts`; handlers don't wait for existing transactions
- Files: `server/src/db/index.ts` (lines 65-73)
- Cause: Process.on('SIGINT') calls closeDatabase() immediately without draining connection pool; in-flight queries may be interrupted
- Improvement path: Use async handlers; implement graceful shutdown queue; wait for all active queries before closing connection

**Full Library Scan on Every Sync:**
- Problem: Scanner fetches all items from Plex, Tautulli, Sonarr, Radarr on every manual sync; no incremental updates
- Files: `server/src/services/scanner.ts` (entire file ~700 lines)
- Cause: Simple implementation; caches are local to scan and cleared after completion
- Improvement path: Implement delta sync based on timestamps; cache matched series/movies across scans; add ability to scan specific libraries only

**In-Memory Deletion Queue Sorting:**
- Problem: DeletionService.getQueue() filters and sorts all pending items in memory; no pagination or limits
- Files: `server/src/services/deletion.ts` (lines 217-257)
- Cause: Assumes queue size stays small; no query-level filtering
- Improvement path: Paginate queue queries; move sorting to database level; add indices on status and delete_after columns

**Missing Database Indices:**
- Problem: No information on database indices visible in schema; common queries (getByStatus, getByMediaType) may do table scans
- Files: `server/src/db/schema.ts` (not examined)
- Cause: SQLite with better-sqlite3; indices need explicit creation
- Improvement path: Create indices on frequently queried columns (status, type, file_size, marked_at, delete_after)

**React Query Polling Without Backoff:**
- Problem: Dashboard refetches every 30 seconds; useSync​Library polls at fixed intervals (5s, 15s, 30s, 60s)
- Files: `client/src/hooks/useApi.ts` (lines 47, 94-100)
- Cause: Linear polling; no exponential backoff; wastes requests if sync completes quickly
- Improvement path: Implement adaptive polling that slows down based on previous response; use WebSocket for real-time updates

## Fragile Areas

**Rules Engine JSON Parsing:**
- Files: `server/src/rules/engine.ts` (lines 75-97)
- Why fragile: Rule conditions stored as JSON string; parse errors silently caught and logged but conditions default to empty array; rule evaluation then silently succeeds with no conditions matched
- Safe modification: Add strict schema validation before storing; return error on parse failure instead of silent fallback; log warnings if rule has no conditions
- Test coverage: No validation that rules with empty conditions aren't accidentally created; no tests for JSON parsing edge cases

**Deletion Service Dependency Injection:**
- Files: `server/src/services/deletion.ts` (lines 86-110), `server/src/services/init.ts` (lines 90-203)
- Why fragile: Optional dependencies passed as undefined if services not configured; methods silently skip operations if repo/service is null; easy to accidentally call methods that do nothing
- Safe modification: Throw errors if required dependencies missing rather than silently skipping; separate Deletion service into multiple service classes with explicit required dependencies
- Test coverage: No tests ensuring all deletion action types work correctly with missing services; no validation that overseerr reset actually occurs

**Media Item Status Transitions:**
- Files: `server/src/db/repositories/mediaItems.ts`, `server/src/services/deletion.ts` (lines 410-415)
- Why fragile: Item status changes to 'deleted' after execution but can be unmarked; deleting 'deleted' items succeeds but behaves differently; no state machine validation
- Safe modification: Define explicit allowed transitions; validate before each update; log status changes with audit trail
- Test coverage: No tests for status transition edge cases; no validation that deleted items can't be remarked

**Overseerr Reset Failure Handling:**
- Files: `server/src/services/deletion.ts` (lines 370-394)
- Why fragile: Overseerr reset failures are logged as warnings but deletion proceeds; no way to rollback main deletion if reset fails; inconsistent state possible
- Safe modification: Make reset optional and non-blocking; log separately that reset failed; implement transaction rollback if reset is critical
- Test coverage: No tests for overseerr reset failure scenarios; unclear what happens if reset throws vs returns false

## Scaling Limits

**SQLite Database Concurrency:**
- Current capacity: SQLite with WAL mode supports moderate concurrent reads; write contention at 5-10MB database size
- Limit: Single writer; high contention during large scans with many item insertions; will timeout under load
- Scaling path: Migrate to PostgreSQL for production; implement connection pooling; add write queue for bulk operations

**In-Memory Service Caches:**
- Current capacity: ScannerService maintains Maps for series/movies (estimated 100-1000 items depending on library size)
- Limit: No cache invalidation strategy; memory grows unbounded if scan runs repeatedly; no cache size limits
- Scaling path: Implement LRU cache with max size; add cache TTL; clear caches on service restart

**API Response Pagination:**
- Current capacity: Library items endpoint doesn't enforce pagination; can return 10,000+ items
- Limit: Client memory issues; slow browser rendering; timeout on large responses
- Scaling path: Enforce pagination on all list endpoints; add limit/offset validation; reduce default page size

**Deletion Queue Processing:**
- Current capacity: processPendingDeletions() loops through all items sequentially; takes N seconds for N deletions
- Limit: Blocking operation; if 1000 items ready, processing takes too long; no concurrency control
- Scaling path: Implement batch deletion with configurable concurrency; add worker queue pattern; implement resumable deletion

## Dependencies at Risk

**better-sqlite3 (Critical):**
- Risk: Native module with platform-specific binaries; requires compilation on install; can break on Node version upgrades or OS changes
- Impact: Container builds may fail; deployments to different architectures break; blocking dependency for development
- Migration plan: Keep current but add prebuilt binary downloads; document compatibility; test Docker builds on target platform; consider postgres migration for scale

**fast-xml-parser (Plex Parsing):**
- Risk: XML parsing is complex; parser settings affect security (XXE attacks); no active security patching visible
- Impact: Plex API response changes break parsing; malformed XML causes crashes; potential XXE if parser not configured securely
- Migration plan: Review parser configuration for XXE prevention; add schema validation; add fallback parsing; test with real Plex responses

**axios (HTTP Client):**
- Risk: Timeout handling is manual; no built-in circuit breaker; external service timeouts block operations
- Impact: Slow Plex/Sonarr servers cause frontend to hang; no graceful degradation
- Migration plan: Add circuit breaker pattern; implement connection pooling; add request timeout limits; implement fallback strategies

**React Query (Frontend):**
- Risk: Caching strategy may cause stale data display; polling doesn't account for errors; no offline support
- Impact: Users see outdated deletion queue; sync results cached and not refreshed; no indication server is unavailable
- Migration plan: Implement error states; add real-time updates via WebSocket; persist critical data to IndexedDB; add offline mode indicator

## Missing Critical Features

**Audit Trail/Logging:**
- Problem: Deletions executed without detailed audit log; can't trace who/why item was deleted; no accountability
- Blocks: Compliance requirements; forensic analysis of deletion decisions; user accountability

**Dry-Run Mode for Rules:**
- Problem: Can't preview what rules would delete before applying; must mark items manually to test
- Blocks: Safe rule testing; confidence in rule logic before affecting library

**Scheduled Scan Cancellation:**
- Problem: Running scan can't be cancelled; if stuck on slow API, blocks all other operations
- Blocks: Emergency stop capability; responsive UI during slow scans

**Backup/Restore of Database:**
- Problem: No built-in backup mechanism; users must manually copy .db files
- Blocks: Data recovery from corruption; safe testing in production environment

**Multi-User Support:**
- Problem: Application assumes single user; no user isolation or permissions; deletion history doesn't track who authorized deletion
- Blocks: Shared library management; compliance with audit requirements; family use cases

## Test Coverage Gaps

**No Unit Tests for Core Logic:**
- What's not tested: RulesEngine evaluation, DeletionService execution, deletion action implementations
- Files: `server/src/rules/engine.ts`, `server/src/services/deletion.ts`
- Risk: Refactoring creates regression bugs; new rule types break silently; deletion side effects not verified
- Priority: High - these are mission-critical deletion operations

**No Integration Tests for External Services:**
- What's not tested: Actual Plex/Sonarr/Radarr/Overseerr API interactions; token refresh; error scenarios
- Files: `server/src/services/plex.ts`, `server/src/services/sonarr.ts`, `server/src/services/radarr.ts`
- Risk: Service integration breaks without detection; API changes go unnoticed until production; auth failures not caught
- Priority: High - external APIs can change at any time

**No E2E Tests:**
- What's not tested: Full workflow (library sync -> rules evaluation -> queue -> deletion); UI interactions
- Files: entire application flow
- Risk: User workflows break without detection; frontend-backend integration bugs not caught; deployment regressions
- Priority: Medium - critical workflows should be tested

**No Error Scenario Tests:**
- What's not tested: Network failures, timeout handling, partial failures in bulk operations, database errors during deletion
- Files: `server/src/services/deletion.ts`, `server/src/services/scanner.ts`
- Risk: Unhandled error states crash application or leave inconsistent data; users don't know what went wrong
- Priority: High - robustness is critical for automatic deletion

**No Performance Tests:**
- What's not tested: Scan time with 10,000+ items; deletion queue processing with large batches; database query performance
- Files: `server/src/services/scanner.ts`, `server/src/services/deletion.ts`
- Risk: Scaling issues discovered in production; degraded performance undetected; customer experience suffers on large libraries
- Priority: Medium - important as users scale

---

*Concerns audit: 2026-01-22*
