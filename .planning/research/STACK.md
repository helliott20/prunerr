# Technology Stack

**Project:** Prunerr - Polish & Production Readiness
**Researched:** 2026-01-22
**Overall Confidence:** HIGH

## Executive Summary

This stack research focuses on libraries needed to add professional polish, notifications, and Unraid deployment to the existing Prunerr application. The existing stack (React 18, Vite, Express 5, TypeScript, Tailwind CSS, React Query, date-fns) is solid and modern. Recommendations extend rather than replace it.

---

## Recommended Additions

### UI Polish - Number & Data Formatting

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `Intl.NumberFormat` | Native | Number/currency formatting | Built into JavaScript, zero bundle cost, locale-aware. No library needed. |
| `pretty-bytes` | ^7.1.0 | Human-readable file sizes | Lightweight (2KB), simple API, handles edge cases well. Better than filesize.js for simplicity. |
| `date-fns` (existing) | ^4.1.0 | Date/time formatting | Already installed. Use `formatDistance`, `formatDistanceToNow`, `format` for all date needs. |

**Rationale:** You already have date-fns installed. For file sizes, pretty-bytes is simpler than filesize.js when you just need human-readable output. Use native `Intl.NumberFormat` for numbers - it handles locale-specific thousands separators, currency, and percentages without any library.

**Confidence:** HIGH - Verified via npm registry and MDN documentation.

---

### UI Components - Settings Pages

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@radix-ui/react-switch` | ^1.2.6 | Toggle switches | Accessible, unstyled, pairs with Tailwind. Industry standard for React settings UIs. |
| `@radix-ui/react-tabs` | ^1.1.13 | Tab navigation | Accessible tabs for settings sections. Same ecosystem as switch. |
| `@radix-ui/react-select` | ^2.2.6 | Dropdown selects | Accessible, keyboard-navigable selects that work with Tailwind. |
| `@radix-ui/react-dialog` | ^1.1.15 | Modal dialogs | Confirmation dialogs, accessible by default. |
| `@radix-ui/react-tooltip` | ^1.2.8 | Tooltips | Help text, info indicators. |

**Rationale:** Radix UI primitives are the standard for accessible, unstyled React components. They integrate perfectly with Tailwind CSS - you style them yourself using `data-[state=...]` variants. This matches your existing Tailwind setup and avoids introducing a different styling paradigm.

**Alternative Considered:** Headless UI (from Tailwind team) - fewer components, less comprehensive. shadcn/ui - great but you'd be adopting their component patterns rather than building your own.

**Confidence:** HIGH - Radix UI is battle-tested, used by shadcn/ui, Vercel, and many production apps.

---

### Form Handling - Settings Validation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `react-hook-form` | ^7.71.1 | Form state management | Performance-focused, minimal re-renders. TypeScript-first. Industry standard. |
| `@hookform/resolvers` | ^5.2.2 | Validation resolver | Bridges react-hook-form with Zod (already in project). |

**Rationale:** You already have Zod (^4.3.5) in server/package.json. react-hook-form + @hookform/resolvers/zod gives you type-safe forms with runtime validation using the same schemas you define for your API. This creates a single source of truth for validation.

**Pattern:**
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const settingsSchema = z.object({
  plexUrl: z.string().url(),
  cleanupThreshold: z.number().min(0).max(100),
  notifyOnCleanup: z.boolean(),
});

type SettingsForm = z.infer<typeof settingsSchema>;

const { register, handleSubmit, formState: { errors } } = useForm<SettingsForm>({
  resolver: zodResolver(settingsSchema),
});
```

**Confidence:** HIGH - Verified versions via npm, extensive documentation available.

---

### Toast Notifications (In-App)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `sonner` | ^2.0.7 | Toast notifications | Modern, lightweight, TypeScript-first. Stacking animations. No setup required. |

**Rationale:** Sonner is the current gold standard for React toast notifications. Unlike react-hot-toast or react-toastify, Sonner requires zero configuration - just call `toast()` from anywhere. It's shadcn/ui's chosen toast library, which signals ecosystem adoption.

**Usage:**
```typescript
import { toast, Toaster } from 'sonner';

// In App.tsx - add <Toaster /> once
// Anywhere else:
toast.success('Settings saved');
toast.error('Failed to connect to Plex');
toast.promise(saveSettings(), {
  loading: 'Saving...',
  success: 'Settings saved',
  error: 'Failed to save settings',
});
```

**Alternative Considered:** react-hot-toast - also good, but Sonner has better animations and newer API design.

**Confidence:** HIGH - Verified version, widely adopted in 2026.

---

### External Notifications

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `nodemailer` (existing) | ^7.0.12 | Email notifications | Already installed. Use for email alerts. |
| Native `fetch` | Built-in | Discord webhooks | Discord webhooks are simple HTTP POST. No library needed. |

**Rationale:**

**Email:** nodemailer is already in your server dependencies. For HTML templates, use inline HTML strings or the `email-templates` package (^13.0.1) if you need Pug/EJS templating. Recommendation: Start with simple inline HTML, add templating later if emails become complex.

**Discord:** Discord webhooks are just HTTP POST requests with JSON. Using native fetch (available in Node.js 18+) is simpler and has zero dependencies compared to discord-webhook-node. The webhook URL contains all auth, so no OAuth needed.

**Discord Webhook Pattern:**
```typescript
async function sendDiscordNotification(webhookUrl: string, message: string) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: message,
      embeds: [{
        title: 'Prunerr Notification',
        description: message,
        color: 0x00ff00, // Green
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}
```

**Confidence:** HIGH for Discord (simple HTTP, well-documented API). HIGH for nodemailer (already installed).

---

### Health Check / Dashboard Monitoring

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Native implementation | N/A | Health endpoint | Simple Express route. No library needed. |

**Rationale:** Health check endpoints should be lightweight. A library adds complexity without benefit. Implement a `/api/health` endpoint that returns:

```typescript
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: {
    database: { status: string; responseTime?: number };
    plex: { status: string; connected: boolean };
    sonarr?: { status: string; connected: boolean };
    radarr?: { status: string; connected: boolean };
  };
  timestamp: string;
}
```

**Pattern:**
- Check database connectivity with a simple query
- Ping external services (Plex, Sonarr, Radarr) with timeout
- Cache results briefly (5-10 seconds) to avoid hammering services
- Return 200 for healthy, 503 for unhealthy

**Confidence:** HIGH - Standard pattern, well-documented.

---

### Unraid Docker Deployment

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Unraid XML Template | v2 schema | Container configuration | Required for Unraid Community Applications. |
| Dockerfile | Multi-stage | Container image | Standard Docker deployment. |

**Rationale:** Unraid uses XML templates for container configuration in Community Applications. This is the standard way to distribute Docker containers to Unraid users.

**Required Template Elements:**
- `<Name>` - Container name (prunerr)
- `<Repository>` - Docker Hub image reference
- `<Registry>` - Link to Docker Hub page
- `<Network>` - Usually `bridge`
- `<Overview>` - Description for users
- `<Icon>` - HTTPS URL to PNG icon
- `<WebUI>` - `http://[IP]:[PORT:3000]`

**Config Elements Needed:**
```xml
<!-- Port mapping -->
<Config Name="Web UI Port" Target="3000" Default="3000" Mode="tcp"
        Description="Port for the Prunerr web interface" Type="Port" Display="always" Required="true"/>

<!-- Volume mappings -->
<Config Name="Config" Target="/config" Default="/mnt/user/appdata/prunerr" Mode="rw"
        Description="Configuration and database storage" Type="Path" Display="always" Required="true"/>

<!-- Environment variables -->
<Config Name="Plex URL" Target="PLEX_URL" Default=""
        Description="URL to your Plex server" Type="Variable" Display="always" Required="false"/>
<Config Name="TZ" Target="TZ" Default="America/New_York"
        Description="Timezone" Type="Variable" Display="always" Required="false"/>
```

**Confidence:** HIGH - Official Unraid documentation and community template standards.

---

## Full Installation Commands

### Client (React) - New Dependencies

```bash
cd /home/harry/projects/library-manager/client
npm install pretty-bytes@^7.1.0 sonner@^2.0.7 react-hook-form@^7.71.1 @hookform/resolvers@^5.2.2
npm install @radix-ui/react-switch@^1.2.6 @radix-ui/react-tabs@^1.1.13 @radix-ui/react-select@^2.2.6 @radix-ui/react-dialog@^1.1.15 @radix-ui/react-tooltip@^1.2.8
```

### Server (Express) - No New Dependencies Needed

The server already has:
- `nodemailer` for email
- `zod` for validation
- Native `fetch` for Discord webhooks (Node.js 18+)

---

## What NOT to Add

| Library | Reason to Skip |
|---------|----------------|
| `filesize.js` | pretty-bytes is simpler for display-only formatting |
| `discord-webhook-node` | Native fetch is simpler, zero dependencies |
| `moment.js` | date-fns (already installed) is better, tree-shakeable |
| `express-healthcheck` | Simple custom implementation is more flexible |
| `email-templates` | Start simple; add later if email complexity grows |
| `shadcn/ui` | You'd be adopting their component structure; Radix primitives give more control |
| `react-toastify` | Larger, less modern than sonner |

---

## Tailwind Integration Notes

### Radix UI + Tailwind

Radix components expose `data-[state=...]` attributes that Tailwind can target directly:

```tsx
<Switch.Root className="data-[state=checked]:bg-blue-500 data-[state=unchecked]:bg-gray-300">
  <Switch.Thumb className="data-[state=checked]:translate-x-5" />
</Switch.Root>
```

No additional plugins needed - Tailwind's arbitrary data attributes work out of the box.

### Sonner + Tailwind

Sonner accepts `className` props and uses CSS variables for theming:

```tsx
<Toaster
  toastOptions={{
    classNames: {
      toast: 'bg-white border-gray-200',
      success: 'bg-green-50 border-green-200',
      error: 'bg-red-50 border-red-200',
    },
  }}
/>
```

---

## Sources

### Official Documentation
- [Intl.NumberFormat - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
- [Radix UI Primitives](https://www.radix-ui.com/primitives)
- [React Hook Form](https://react-hook-form.com/)
- [Sonner](https://sonner.emilkowal.ski/)
- [Discord Webhooks API](https://discord.com/developers/docs/resources/webhook)
- [Unraid Docker Template Schema](https://selfhosters.net/docker/templating/templating/)

### Version Verification (npm registry, 2026-01-22)
- react-hook-form: 7.71.1
- @hookform/resolvers: 5.2.2
- sonner: 2.0.7
- pretty-bytes: 7.1.0
- @radix-ui/react-switch: 1.2.6
- @radix-ui/react-tabs: 1.1.13
- @radix-ui/react-select: 2.2.6
- @radix-ui/react-dialog: 1.1.15
- @radix-ui/react-tooltip: 1.2.8

### Community Resources
- [Knock - Top React Notification Libraries 2026](https://knock.app/blog/the-top-notification-libraries-for-react)
- [Builder.io - Best React UI Libraries 2026](https://www.builder.io/blog/react-component-libraries-2026)
- [Microservices.io - Health Check Pattern](https://microservices.io/patterns/observability/health-check-api.html)
