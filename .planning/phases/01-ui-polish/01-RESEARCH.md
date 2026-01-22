# Phase 1: UI Polish - Research

**Researched:** 2026-01-22
**Domain:** React UI/UX patterns for loading, error, and empty states
**Confidence:** HIGH

## Summary

This research investigates the UI polish requirements for the library-manager (Prunerr) application, a React/TypeScript media cleanup tool using Vite, TailwindCSS, TanStack React Query, and date-fns. The application already has substantial infrastructure in place:

- **Formatting utilities exist**: `formatBytes()` and `formatRelativeTime()` are implemented in `client/src/lib/utils.ts` and are already used throughout the app
- **Skeleton loading exists**: Basic shimmer skeletons are implemented in several components (Library, Dashboard, Queue, History) using a `skeleton-shimmer` CSS class
- **Toast system exists**: A complete toast notification system is in place via `ToastProvider` and `useToast()`
- **Empty states exist**: Several components already have empty state handling (Library, Queue, History, Dashboard)

**Primary recommendation:** Audit existing implementations for consistency and completeness rather than building from scratch. Focus on standardizing patterns across all views and filling gaps where the existing patterns haven't been applied.

## Standard Stack

The project already uses these libraries - no new dependencies needed:

### Core (Already Installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| date-fns | ^4.1.0 | Date formatting and relative time | Already used via `formatRelativeTime()` |
| @tanstack/react-query | ^5.90.19 | Server state, loading/error states | Already used throughout |
| tailwind-merge | ^3.4.0 | CSS class composition | Already used via `cn()` |
| clsx | ^2.1.1 | Conditional classes | Already used via `cn()` |
| lucide-react | ^0.562.0 | Icons | Already used throughout |

### Optional Additions (NOT Required)
| Library | Purpose | Recommendation |
|---------|---------|----------------|
| react-error-boundary | Error boundary component | Consider if adding global error handling |

**Installation:** No new packages required.

## Architecture Patterns

### Existing Project Structure
```
client/src/
├── components/
│   ├── common/           # Reusable UI components
│   │   ├── Badge.tsx     # Styled badges
│   │   ├── Button.tsx    # Button variants
│   │   ├── Card.tsx      # Card container
│   │   ├── Input.tsx     # Form inputs
│   │   ├── Modal.tsx     # Modal dialogs
│   │   └── Toast.tsx     # Toast notifications
│   ├── Dashboard/        # Dashboard view
│   ├── Library/          # Library browser
│   ├── Queue/            # Deletion queue
│   ├── History/          # Deletion history
│   ├── Rules/            # Rule management
│   └── Settings/         # Settings page
├── hooks/
│   └── useApi.ts         # TanStack Query hooks
├── lib/
│   └── utils.ts          # Utility functions (formatBytes, formatRelativeTime, etc.)
├── services/
│   └── api.ts            # Axios API client
└── types/
    └── index.ts          # TypeScript types
```

### Pattern 1: Consistent Query State Handling
**What:** Use TanStack Query's `isLoading`, `isError`, `error`, and `data` consistently
**When to use:** Every component that fetches data
**Current Usage:** Most components check `isLoading` then render data, but inconsistent error handling

```typescript
// Source: TanStack Query documentation
// Current pattern in codebase (e.g., Library.tsx)
const { data, isLoading, isFetching } = useLibrary(filters);

// Render pattern
{isLoading ? (
  <LoadingSkeleton />
) : data?.items && data.items.length > 0 ? (
  <ContentView />
) : (
  <EmptyState />
)}

// MISSING: Error state handling in most components
```

### Pattern 2: Skeleton Component Structure
**What:** Match skeleton dimensions to actual content to prevent layout shift
**When to use:** All data-loading states
**Current Usage:** Inline skeletons with `skeleton-shimmer` class

```typescript
// Source: Current codebase (Library.tsx)
function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'grid') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {[...Array(24)].map((_, i) => (
          <div key={i} className="aspect-[2/3] skeleton-shimmer rounded-xl" />
        ))}
      </div>
    );
  }
  // Table skeleton...
}
```

### Pattern 3: Empty State Structure
**What:** Three-part empty state: icon, headline, description, optional CTA
**When to use:** When data arrays are empty or filters return no results
**Current Usage:** Implemented but inconsistent messaging

```typescript
// Source: Current codebase (Dashboard.tsx)
function EmptyState({ icon: Icon, title, description, variant = 'default' }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className={cn('w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center', ...)}>
        <Icon className={cn('w-8 h-8', ...)} />
      </div>
      <p className="text-surface-200 font-medium">{title}</p>
      <p className="text-sm text-surface-500 mt-1">{description}</p>
    </div>
  );
}
```

### Anti-Patterns to Avoid
- **Inconsistent skeleton dimensions:** Skeletons must match real content size to prevent layout shift
- **Missing error states:** Components should handle API failures gracefully
- **Generic error messages:** "An error occurred" provides no actionable guidance
- **Empty states without context:** Always explain WHY it's empty and WHAT to do next

## Don't Hand-Roll

Problems that have existing solutions in the codebase:

| Problem | Don't Build | Use Instead | Location |
|---------|-------------|-------------|----------|
| Human-readable file sizes | Custom formatter | `formatBytes()` | `lib/utils.ts` |
| Relative time display | Custom time logic | `formatRelativeTime()` | `lib/utils.ts` |
| Date formatting | Custom date logic | `formatDate()` | `lib/utils.ts` |
| Days calculation | Custom math | `getDaysUntil()`, `getDaysSince()` | `lib/utils.ts` |
| CSS class merging | String concatenation | `cn()` | `lib/utils.ts` |
| Toast notifications | Alert/confirm | `useToast()` | `components/common/Toast.tsx` |
| Loading shimmer | CSS animation | `skeleton-shimmer` class | `index.css` |

**Key insight:** The formatting and display utilities already exist. The task is to ensure they're used consistently everywhere, not to create new utilities.

## Common Pitfalls

### Pitfall 1: Inconsistent Formatting Usage
**What goes wrong:** Some components display raw bytes/timestamps instead of formatted values
**Why it happens:** Copy-paste development, different developers, incremental feature addition
**How to avoid:** Audit all components for raw data display; create linting rules if needed
**Warning signs:** Numbers like `2400000000` or ISO timestamps `2024-01-15T10:30:00Z` in UI

### Pitfall 2: Layout Shift During Loading
**What goes wrong:** Content jumps when data loads because skeleton dimensions differ from content
**Why it happens:** Skeletons created without measuring actual content dimensions
**How to avoid:** Match skeleton height/width to real component dimensions; use `aspect-[2/3]` for posters
**Warning signs:** Visible "jumping" when transitioning from loading to loaded state

### Pitfall 3: Missing Error States
**What goes wrong:** API failures show blank screens or crash the UI
**Why it happens:** Happy-path development; error handling added as afterthought
**How to avoid:** Always handle `isError` from React Query; design error UI first
**Warning signs:** Components only checking `isLoading` without `isError`

### Pitfall 4: Empty States Without Guidance
**What goes wrong:** Users see empty screens with no explanation or next steps
**Why it happens:** Empty state treated as edge case rather than part of user journey
**How to avoid:** Three types of empty states: informational (explain why empty), guidance (what to do), celebratory (success/completion)
**Warning signs:** Empty state shows only "No items" without context or actions

### Pitfall 5: Inconsistent Error Messages
**What goes wrong:** Technical error messages like "ENOENT" or "500 Internal Server Error" shown to users
**Why it happens:** Backend errors propagated directly to UI without transformation
**How to avoid:** API interceptor should transform errors; UI should have user-friendly fallbacks
**Warning signs:** Error messages containing HTTP codes, file paths, or technical terms

## Code Examples

### Existing formatBytes Implementation
```typescript
// Source: client/src/lib/utils.ts (already implemented)
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
```

### Existing formatRelativeTime Implementation
```typescript
// Source: client/src/lib/utils.ts (already implemented)
export function formatRelativeTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return formatDistanceToNow(dateObj, { addSuffix: true });
}
```

### Existing Skeleton CSS
```css
/* Source: client/src/index.css (already implemented) */
.skeleton-shimmer {
  @apply relative overflow-hidden bg-surface-800 rounded-lg;
}

.skeleton-shimmer::after {
  content: '';
  @apply absolute inset-0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.04),
    transparent
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

### Recommended Error State Component Pattern
```typescript
// Pattern to implement (not currently in codebase)
interface ErrorStateProps {
  error: Error;
  title?: string;
  retry?: () => void;
}

function ErrorState({ error, title = "Something went wrong", retry }: ErrorStateProps) {
  // Map technical errors to user-friendly messages
  const userMessage = getUserFriendlyMessage(error);

  return (
    <div className="card p-12 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-ruby-500/10 flex items-center justify-center">
        <AlertCircle className="w-8 h-8 text-ruby-400" />
      </div>
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      <p className="text-surface-400 mb-4">{userMessage}</p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </Button>
      )}
    </div>
  );
}
```

### Recommended Complete Query State Pattern
```typescript
// Pattern to standardize across all views
function DataView() {
  const { data, isLoading, isError, error, refetch } = useQuery();

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError) {
    return <ErrorState error={error} retry={refetch} />;
  }

  if (!data || data.items.length === 0) {
    return <EmptyState />;
  }

  return <ContentView data={data} />;
}
```

## State of the Art

| Old Approach | Current Approach | Status in Codebase |
|--------------|------------------|-------------------|
| `moment.js` for dates | `date-fns` (tree-shakeable) | Already using date-fns v4 |
| Custom loading spinners | Skeleton screens | Already implemented |
| Alert/confirm dialogs | Toast notifications | Already implemented |
| Prop drilling for state | TanStack Query | Already implemented |
| Manual retry logic | React Query's built-in retry | Already configured |

**Already current:** The codebase uses modern patterns throughout.

## Audit Findings

### Components Already Using formatBytes Correctly
- Dashboard.tsx (multiple places)
- Library.tsx (selection bar)
- Queue.tsx (stats, item rows)
- History.tsx (stats, table rows)
- MediaCard.tsx
- MediaTable.tsx

### Components Already Using formatRelativeTime Correctly
- Dashboard.tsx (activity items, deletions)
- History.tsx (table rows)
- Queue.tsx (queue items)
- Sidebar.tsx (disk stats)

### Components with Skeleton Loading
- Library.tsx: Grid and table skeletons
- Dashboard.tsx: Card skeletons, activity skeletons
- Queue.tsx: List skeletons
- History.tsx: Table skeletons

### Components with Empty States
- Library.tsx: EmptyLibrary component (search vs. no data)
- Dashboard.tsx: EmptyState component (reusable)
- Queue.tsx: Empty queue state
- History.tsx: No history state

### Gaps Identified
1. **Error states:** Most components don't handle `isError` from React Query
2. **Error message quality:** Current API interceptor shows raw error messages
3. **Skeleton consistency:** Some skeletons may not perfectly match content dimensions
4. **Empty state messaging:** Some empty states lack actionable guidance

## Open Questions

Things that couldn't be fully resolved:

1. **Error message mapping**
   - What we know: API returns technical errors; interceptor exists in api.ts
   - What's unclear: What user-friendly messages should replace technical ones?
   - Recommendation: Define error message mapping during planning

2. **Loading state granularity**
   - What we know: Some components have view-mode-aware skeletons (Library)
   - What's unclear: Should all views have equally detailed skeletons?
   - Recommendation: Prioritize most-used views; simpler skeletons acceptable for less-used pages

## Sources

### Primary (HIGH confidence)
- Local codebase analysis: `client/src/lib/utils.ts`, `client/src/index.css`, component files
- TanStack Query documentation: Error handling patterns
- date-fns v4 documentation: `formatDistanceToNow` usage

### Secondary (MEDIUM confidence)
- [TkDodo's React Query Error Handling](https://tkdodo.eu/blog/react-query-error-handling) - Error boundary patterns
- [LogRocket: Loading States with Skeleton](https://blog.logrocket.com/handling-react-loading-states-react-loading-skeleton/) - Skeleton best practices
- [Eleken: Empty State UX](https://www.eleken.co/blog-posts/empty-state-ux) - Empty state design patterns

### Tertiary (LOW confidence)
- General React patterns from web search (need validation against React 18+ practices)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Direct codebase inspection confirms all libraries in use
- Architecture: HIGH - Patterns extracted directly from existing code
- Pitfalls: MEDIUM - Based on industry best practices and codebase audit
- Code examples: HIGH - All "existing" examples pulled from actual codebase

**Research date:** 2026-01-22
**Valid until:** 60 days (stable patterns, established codebase)
