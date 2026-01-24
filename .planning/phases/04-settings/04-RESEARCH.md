# Phase 4: Settings - Research

**Researched:** 2026-01-24
**Domain:** Settings UI, scan scheduling, display preferences, import/export
**Confidence:** HIGH

## Summary

This phase extends the existing Settings page to add three new capabilities: scan schedule configuration (SET-01), display preferences (SET-02), and settings import/export (SET-03). The research reveals the existing codebase is well-positioned:

1. **Comprehensive settings infrastructure exists** - The backend already has a `settings` table with key-value storage, a settings repository with typed accessors (`getBoolean`, `getNumber`, `getJson`), and a full REST API at `/api/settings`. The frontend has a `Settings.tsx` component with service configuration, a notifications section, and a basic schedule section that needs enhancement.

2. **Scheduler is already integrated** - The `Scheduler` class supports configuration via `updateSchedule()`, `enableTask()`, and `disableTask()` methods. It uses `node-cron` for scheduling with cron expressions and `cron-parser` for next-run calculation. The schedule settings are partially implemented but need UI enhancement.

3. **Display preferences require new infrastructure** - The codebase uses `date-fns` for formatting via utility functions in `utils.ts`. These functions need to be extended to support configurable formats and use a React context for global preferences.

**Primary recommendation:** Extend the existing Settings page with enhanced schedule configuration using human-readable interval selectors, add a new Display Preferences section with format pickers, and implement JSON export/import as a simple file download/upload pattern.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| date-fns | ^4.1.0 | Configurable date/time formatting | Already in use, comprehensive format options |
| zod | ^4.3.5 | Settings validation on import | Already in use for API validation |
| react | ^18.3.1 | Context for global preferences | Already in use, Context API built-in |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-query | ^5.90.19 | Settings fetch/save with cache invalidation | Already in use for settings |
| lucide-react | ^0.562.0 | Settings section icons | Already in use throughout app |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| date-fns | luxon/dayjs | date-fns already in use, switching adds no value |
| React Context | Zustand | Simple preferences don't need external state library |
| File download | Clipboard API | File is more reliable for backup/restore use case |

**Installation:**
```bash
# No new packages needed - all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
server/src/
├── routes/
│   └── settings.ts          # Extend with /api/settings/export and /api/settings/import
├── db/repositories/
│   └── settings.ts          # Existing - no changes needed
└── scheduler/
    └── index.ts             # Existing - configuration methods already available

client/src/
├── contexts/
│   └── DisplayPreferencesContext.tsx   # NEW: Global display format preferences
├── hooks/
│   └── useApi.ts            # Extend with export/import hooks
├── components/
│   └── Settings/
│       ├── Settings.tsx            # Existing - add sections
│       ├── ScheduleSection.tsx     # NEW: Enhanced schedule configuration
│       ├── DisplaySection.tsx      # NEW: Date/time/size format preferences
│       └── ImportExportSection.tsx # NEW: Export/import buttons
└── lib/
    └── utils.ts             # Extend formatters to use preferences context
```

### Pattern 1: Display Preferences Context
**What:** React context providing global format preferences (date format, time format, file size units)
**When to use:** Any component displaying dates, times, or file sizes
**Example:**
```typescript
// Source: Standard React Context pattern
interface DisplayPreferences {
  dateFormat: 'relative' | 'absolute' | 'iso';
  timeFormat: '12h' | '24h';
  fileSizeUnit: 'auto' | 'MB' | 'GB' | 'TB';
}

const DisplayPreferencesContext = createContext<{
  preferences: DisplayPreferences;
  setPreferences: (prefs: Partial<DisplayPreferences>) => void;
} | null>(null);

// Provider wraps App, loads from settings API on mount
function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings();
  const saveMutation = useSaveSettings();

  const [preferences, setLocalPreferences] = useState<DisplayPreferences>({
    dateFormat: 'relative',
    timeFormat: '24h',
    fileSizeUnit: 'auto',
  });

  // Sync from API on load
  useEffect(() => {
    if (settings?.display) {
      setLocalPreferences(settings.display);
    }
  }, [settings]);

  const setPreferences = (updates: Partial<DisplayPreferences>) => {
    const newPrefs = { ...preferences, ...updates };
    setLocalPreferences(newPrefs);
    // Persist to backend
    saveMutation.mutate({ display: newPrefs });
  };

  return (
    <DisplayPreferencesContext.Provider value={{ preferences, setPreferences }}>
      {children}
    </DisplayPreferencesContext.Provider>
  );
}
```

### Pattern 2: Schedule Configuration with Human-Readable Options
**What:** UI that translates user-friendly options (daily at 3 AM) to cron expressions
**When to use:** Schedule configuration in settings
**Example:**
```typescript
// Source: Based on existing schedule section in Settings.tsx
interface ScheduleConfig {
  enabled: boolean;
  frequency: 'hourly' | 'daily' | 'weekly';
  time: string;  // HH:MM format
  dayOfWeek?: number;  // 0-6 for weekly
}

// Convert user-friendly config to cron expression
function toCronExpression(config: ScheduleConfig): string {
  const [hour, minute] = config.time.split(':').map(Number);

  switch (config.frequency) {
    case 'hourly':
      return `${minute} * * * *`;  // Every hour at :MM
    case 'daily':
      return `${minute} ${hour} * * *`;  // Daily at HH:MM
    case 'weekly':
      return `${minute} ${hour} * * ${config.dayOfWeek || 0}`;  // Weekly
    default:
      return `${minute} ${hour} * * *`;  // Default daily
  }
}

// Validate the generated expression works
function validateCronExpression(expression: string): boolean {
  // node-cron's validate function is available on server
  // On client, basic regex validation is sufficient
  const cronRegex = /^(\d{1,2}|\*)\s+(\d{1,2}|\*)\s+(\*|\d{1,2})\s+(\*|\d{1,2})\s+(\*|\d{1,2})$/;
  return cronRegex.test(expression);
}
```

### Pattern 3: Settings Export/Import as JSON
**What:** Download all settings as JSON file, upload to restore
**When to use:** Backup/restore, migration between instances
**Example:**
```typescript
// Source: Standard file download/upload patterns

// Backend endpoint
router.get('/export', (_req: Request, res: Response) => {
  const settings = settingsRepo.getAll();
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {}),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=prunerr-settings.json');
  res.json(exportData);
});

// Backend import with validation
const ImportSchema = z.object({
  version: z.number(),
  settings: z.record(z.string(), z.string()),
});

router.post('/import', async (req: Request, res: Response) => {
  const parsed = ImportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: 'Invalid settings format' });
  }

  const { settings } = parsed.data;
  const imported = settingsRepo.setMultiple(
    Object.entries(settings).map(([key, value]) => ({ key, value }))
  );

  res.json({ success: true, data: { imported: imported.length } });
});

// Frontend download
async function exportSettings() {
  const response = await api.get('/settings/export', { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'prunerr-settings.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Frontend upload
async function importSettings(file: File) {
  const text = await file.text();
  const data = JSON.parse(text);
  await api.post('/settings/import', data);
}
```

### Anti-Patterns to Avoid
- **Storing cron expressions directly in UI:** Users shouldn't see/edit raw cron syntax; use human-readable selectors
- **No validation on import:** Always validate imported settings against schema before applying
- **Synchronous file reads:** Use async FileReader API for file uploads
- **Hardcoded format strings:** Use configurable formats from context, not hardcoded in components

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron expression validation | Regex validation | `node-cron.validate()` | Already in use on server, handles all valid expressions |
| Date formatting options | Custom format functions | `date-fns` format strings | Comprehensive, tested, handles edge cases |
| Settings persistence | Custom storage | Existing `settingsRepo` | Already handles CRUD, transactions, typed access |
| File download trigger | Manual blob handling | Standard download pattern | Browser-native, handles all file types |

**Key insight:** The settings infrastructure is already robust. This phase is about building UI to configure existing capabilities and adding display preference context.

## Common Pitfalls

### Pitfall 1: Schedule Changes Not Reflected Until Restart
**What goes wrong:** User saves schedule, but scheduler keeps using old schedule
**Why it happens:** Scheduler was initialized at startup with old settings, not updated
**How to avoid:** Call `scheduler.updateSchedule()` when settings are saved; endpoint already refreshes services
**Warning signs:** "Next run" time doesn't change after saving new schedule

### Pitfall 2: Import Overwrites Service Credentials
**What goes wrong:** Importing settings from another instance breaks service connections
**Why it happens:** API keys and URLs are included in export
**How to avoid:** Option to exclude service credentials from export, or confirmation before import
**Warning signs:** All services disconnect after import

### Pitfall 3: Display Format Context Not Available During Initial Render
**What goes wrong:** Components show wrong format briefly, then correct
**Why it happens:** Settings API call hasn't completed when components first render
**How to avoid:** Use sensible defaults, show skeleton during settings load
**Warning signs:** Flash of incorrect format on page load

### Pitfall 4: Time Picker Not Respecting User's Timezone
**What goes wrong:** User sets "3 AM" but scan runs at different local time
**Why it happens:** Time saved in UTC without timezone context
**How to avoid:** Store timezone preference, convert on display; scheduler already supports timezone
**Warning signs:** Scheduled tasks run at unexpected times

### Pitfall 5: Large Export Files Due to Logging
**What goes wrong:** Export file is unexpectedly large (MBs instead of KBs)
**Why it happens:** Accidentally including history or log data in export
**How to avoid:** Export only settings table, not history or activity logs
**Warning signs:** Export takes long time, file larger than 100KB

## Code Examples

Verified patterns from existing codebase:

### Existing Schedule Settings Structure
```typescript
// Source: /server/src/routes/settings.ts lines 61-71
// Current settings storage uses flat key-value with prefixes:
// schedule_enabled: 'true' | 'false'
// schedule_interval: 'hourly' | 'daily' | 'weekly'
// schedule_time: 'HH:MM'
// schedule_autoProcess: 'true' | 'false'

// GET /api/settings returns structured object:
{
  schedule: {
    enabled: boolean,
    interval: 'hourly' | 'daily' | 'weekly',
    time: string,
    autoProcess: boolean
  }
}
```

### Existing Toggle Switch Component
```typescript
// Source: /client/src/components/Settings/Settings.tsx lines 440-460
function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50',
        checked ? 'bg-accent-500' : 'bg-surface-600'
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transform ring-0 transition duration-200 ease-in-out',
        checked ? 'translate-x-5' : 'translate-x-0'
      )} />
    </button>
  );
}
```

### Existing Format Functions to Extend
```typescript
// Source: /client/src/lib/utils.ts lines 30-41
// These need to be extended to support configurable formats

export function formatDate(date: string | Date, formatStr = 'MMM d, yyyy'): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, formatStr);
}

export function formatRelativeTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return formatDistanceToNow(dateObj, { addSuffix: true });
}

// Extended version supporting preferences
export function formatDateWithPreference(
  date: string | Date,
  preference: 'relative' | 'absolute' | 'iso'
): string {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;

  switch (preference) {
    case 'relative':
      return formatDistanceToNow(dateObj, { addSuffix: true });
    case 'absolute':
      return format(dateObj, 'MMM d, yyyy h:mm a');
    case 'iso':
      return dateObj.toISOString();
    default:
      return formatDistanceToNow(dateObj, { addSuffix: true });
  }
}
```

### Select Component Already Available
```typescript
// Source: /client/src/components/common/Input.tsx lines 113-162
// Select component exists with label, error, options props
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, label, options, id, ...props }, ref) => {
    return (
      <div className="space-y-2">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-surface-200">
            {label}
          </label>
        )}
        <select ref={ref} id={inputId} className={cn('select', error && 'border-ruby-500/50', className)} {...props}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    );
  }
);
```

### Settings Types to Extend
```typescript
// Source: /client/src/types/index.ts lines 222-240
// Current ScheduleSettings interface
export interface ScheduleSettings {
  enabled: boolean;
  interval: 'hourly' | 'daily' | 'weekly';
  time: string;
  autoProcess: boolean;
}

// NEW: Add DisplaySettings interface
export interface DisplaySettings {
  dateFormat: 'relative' | 'absolute' | 'iso';
  timeFormat: '12h' | '24h';
  fileSizeUnit: 'auto' | 'MB' | 'GB' | 'TB';
}

// Extend Settings interface
export interface Settings {
  services: { /* existing */ };
  notifications?: NotificationSettings;
  schedule?: ScheduleSettings;
  display?: DisplaySettings;  // NEW
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw cron input | Human-readable selectors | Current best practice | Users don't need to learn cron syntax |
| Fixed date format | User-configurable format | Preference-based UX trend | Users can choose their preferred display |
| Manual backup | JSON export/import | Standard settings pattern | Easy backup and migration |

**Deprecated/outdated:**
- Raw cron string input in UI: Users should never see or edit cron expressions directly
- Browser localStorage for preferences: Use server-side storage for cross-device consistency

## Open Questions

Things that couldn't be fully resolved:

1. **Credentials in Export**
   - What we know: Export includes all settings including API keys/tokens
   - What's unclear: Whether users want credentials in export for full migration, or excluded for security
   - Recommendation: Include credentials by default (full backup), add checkbox to exclude sensitive values

2. **Timezone Handling**
   - What we know: Scheduler supports timezone via config, server runs in UTC
   - What's unclear: Whether to detect user's browser timezone or let them configure explicitly
   - Recommendation: Add timezone dropdown in schedule settings, default to browser timezone

3. **Schedule Granularity**
   - What we know: Current UI offers hourly/daily/weekly intervals
   - What's unclear: Whether users need more granular options (every 6 hours, every 2 days)
   - Recommendation: Start with current options, add custom interval if requested

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis - `/server/src/routes/settings.ts` full settings API
- Existing codebase analysis - `/server/src/db/repositories/settings.ts` repository methods
- Existing codebase analysis - `/server/src/scheduler/index.ts` configuration methods
- Existing codebase analysis - `/client/src/components/Settings/Settings.tsx` current UI
- Existing codebase analysis - `/client/src/lib/utils.ts` format functions
- Existing codebase analysis - `/client/src/types/index.ts` type definitions

### Secondary (MEDIUM confidence)
- date-fns format documentation - Format string options
- React Context API documentation - Standard context patterns
- Standard file download/upload patterns - Browser APIs

### Tertiary (LOW confidence)
- Web search for settings export patterns - General best practices

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, no new dependencies
- Architecture: HIGH - Patterns derived directly from existing codebase
- Pitfalls: HIGH - Based on existing settings implementation experience

**Research date:** 2026-01-24
**Valid until:** 60 days (stable domain, mature patterns)
