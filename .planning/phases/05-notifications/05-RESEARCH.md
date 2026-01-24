# Phase 05: Notifications - Research

**Researched:** 2026-01-24
**Domain:** Discord Webhook Notifications
**Confidence:** HIGH

## Summary

This phase implements Discord webhook notifications for library scan completions and errors. The codebase already contains a comprehensive notification service (`server/src/notifications/`) with Discord support, rich embed templates, and multi-channel architecture (Discord, Email, Telegram). The primary work involves:

1. Wiring the existing notification service to read the webhook URL from database settings (stored via Settings UI from Phase 4)
2. Adding a "test notification" button in the Settings UI
3. Adding an error notification event type for scan/deletion failures
4. Ensuring notifications are triggered at the appropriate points in the scheduler tasks

The existing `NotificationService` class already handles Discord webhook POST requests with proper error handling. The templates module already includes `SCAN_COMPLETE`, `DELETION_COMPLETE`, and `DELETION_IMMINENT` events with rich Discord embed formatting.

**Primary recommendation:** Wire the existing notification infrastructure to database settings and add UI test functionality. Add `SCAN_ERROR` and `DELETION_ERROR` events for failure notifications.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` | Built-in (Node 18+) | HTTP requests to Discord | Already used in notification service, no external deps needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | Existing | URL validation | Validate Discord webhook URL format |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native fetch | axios | axios adds dependency; fetch is sufficient for simple POST |
| Custom retry | p-retry | Only needed if frequent rate limiting; overkill for low-volume notifications |

**Installation:**
```bash
# No new packages needed - uses existing native fetch
```

## Architecture Patterns

### Recommended Project Structure
```
server/src/
├── notifications/
│   ├── index.ts         # NotificationService (EXISTS - modify)
│   └── templates.ts     # Message templates (EXISTS - add ERROR events)
├── scheduler/
│   └── tasks.ts         # Task functions (EXISTS - already calls notify())
└── routes/
    └── settings.ts      # Settings API (EXISTS - add test endpoint)

client/src/components/
└── Settings/
    └── Settings.tsx     # Settings UI (EXISTS - add test button)
```

### Pattern 1: Settings-Driven Configuration (Already Implemented)
**What:** Read notification webhook URL from database settings, not environment variables
**When to use:** When configuration should be changeable at runtime via UI
**Example:**
```typescript
// Source: Existing pattern in server/src/services/scanner.ts
// Read from database settings first, fall back to env var
const discordWebhook = settingsRepo.getValue('notifications_discordWebhook')
  || config.discord.webhookUrl;
```

### Pattern 2: Event-Driven Notifications
**What:** Notification service is injected into scheduler tasks via dependency injection
**When to use:** Decouples notification logic from business logic
**Example:**
```typescript
// Source: Existing pattern in server/src/scheduler/tasks.ts
if (dependencies.notificationService) {
  await dependencies.notificationService.notify('SCAN_COMPLETE', {
    itemsScanned: evaluationSummary.itemsEvaluated,
    itemsFlagged: evaluationSummary.itemsFlagged,
    // ...
  });
}
```

### Pattern 3: Rich Discord Embeds
**What:** Use Discord embed objects for structured, visually appealing messages
**When to use:** All notification types except simple test messages
**Example:**
```typescript
// Source: Existing pattern in server/src/notifications/templates.ts
const embed: DiscordEmbed = {
  title: 'Library Scan Complete',
  color: 0x2ecc71,  // Decimal color value (green)
  description: `Scanned **${data.itemsScanned}** items.`,
  timestamp: new Date().toISOString(),
  footer: { text: 'Prunerr Media Library Manager' },
  fields: [
    { name: 'Items Scanned', value: data.itemsScanned.toString(), inline: true },
  ],
};
```

### Anti-Patterns to Avoid
- **Hardcoding webhook URL:** Always read from settings, not config file
- **Ignoring rate limit headers:** Check X-RateLimit-Remaining before sending bursts
- **Blocking on notification failures:** Notifications should never fail the main operation
- **Sending sensitive data:** Never include API keys or tokens in notification messages

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Discord message formatting | Custom markdown | Existing `templates.ts` embed builders | Already handles colors, fields, formatting |
| Webhook URL validation | Regex pattern | Discord webhook URL format check | URL must match `https://discord.com/api/webhooks/ID/TOKEN` |
| Rate limiting | Custom queue | Simple retry-after handling | Low notification volume doesn't need queue system |

**Key insight:** The existing notification service already handles Discord webhooks correctly. Focus on wiring configuration and adding error events, not rebuilding the notification layer.

## Common Pitfalls

### Pitfall 1: Rate Limiting (429 Responses)
**What goes wrong:** Discord returns 429 when exceeding 5 requests per 2 seconds per webhook
**Why it happens:** Rapid sequential notifications or shared webhook across multiple sources
**How to avoid:**
- Notifications are low-volume (scan completes once per scheduled run)
- If 429 occurs, read `Retry-After` header and wait
- Never retry immediately on 429
**Warning signs:** Multiple notifications in tight loops, batch operations triggering per-item notifications

### Pitfall 2: Invalid Webhook URL
**What goes wrong:** User pastes incorrect URL, notifications silently fail
**Why it happens:** No validation when saving settings
**How to avoid:**
- Validate URL format matches Discord webhook pattern
- Provide "Test Notification" button in UI
- Show clear error if test fails
**Warning signs:** Notifications configured but user never receives them

### Pitfall 3: Notification Service Not Re-reading Settings
**What goes wrong:** User changes webhook URL but old URL still used
**Why it happens:** NotificationService caches config at initialization
**How to avoid:**
- Read webhook URL from settings repo at send time, not construction time
- Or reinitialize notification service when settings change
**Warning signs:** Settings show new URL but notifications go to old destination

### Pitfall 4: Blocking Main Operations on Notification Failure
**What goes wrong:** Scan fails because Discord is down
**Why it happens:** Awaiting notification without try/catch
**How to avoid:**
- Wrap notification calls in try/catch
- Log notification failures but don't throw
- Main operation should succeed even if notification fails
**Warning signs:** Operations failing with network errors from Discord

### Pitfall 5: Missing Error Event Type
**What goes wrong:** Scan fails but no notification sent
**Why it happens:** Only `SCAN_COMPLETE` event exists, no `SCAN_ERROR`
**How to avoid:**
- Add `SCAN_ERROR` and `DELETION_ERROR` event types
- Trigger error notifications in catch blocks of scheduler tasks
**Warning signs:** User configured notifications but never hears about failures

## Code Examples

### Discord Webhook POST (Already Implemented)
```typescript
// Source: server/src/notifications/index.ts (lines 248-279)
async sendDiscord(webhookUrl: string, message: DiscordMessage): Promise<boolean> {
  if (!webhookUrl) {
    logger.warn('Discord webhook URL not configured');
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    return true;
  } catch (error) {
    logger.error('Failed to send Discord notification:', error);
    return false;
  }
}
```

### Reading Settings at Send Time
```typescript
// Pattern for dynamic webhook URL reading
async notify(event: NotificationEvent, data: NotificationData): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];

  // Read current settings at notification time
  const discordEnabled = settingsRepo.getBoolean('notifications_discordEnabled', false);
  const discordWebhook = settingsRepo.getValue('notifications_discordWebhook');

  if (discordEnabled && discordWebhook) {
    try {
      const message = getDiscordMessage(event, data);
      const result = await this.sendDiscord(discordWebhook, message);
      results.push({
        channel: 'discord',
        success: result,
        error: result ? undefined : 'Failed to send Discord message',
      });
    } catch (error) {
      // Log but don't throw - notification failure shouldn't break main operation
      logger.error('Discord notification error:', error);
      results.push({ channel: 'discord', success: false, error: String(error) });
    }
  }

  return results;
}
```

### Test Notification Endpoint
```typescript
// Pattern for test notification endpoint
router.post('/test/discord', async (req: Request, res: Response) => {
  const webhookUrl = req.body.webhookUrl
    || settingsRepo.getValue('notifications_discordWebhook');

  if (!webhookUrl) {
    return res.status(400).json({
      success: false,
      error: 'No Discord webhook URL configured'
    });
  }

  // Validate URL format
  if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Discord webhook URL format'
    });
  }

  try {
    const notificationService = getNotificationService();
    const result = await notificationService.sendDiscordText(
      webhookUrl,
      'Test notification from Prunerr!'
    );

    res.json({
      success: result,
      message: result ? 'Test notification sent!' : 'Failed to send notification'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
```

### Error Notification Template
```typescript
// Pattern for error notification event
export interface ScanErrorData {
  error: string;
  phase: string;  // 'scanning' | 'evaluating' | 'persisting'
  itemsScannedBeforeError?: number;
  timestamp: string;
}

export function getScanErrorDiscord(data: ScanErrorData): DiscordMessage {
  return {
    embeds: [{
      title: 'Scan Failed',
      color: 0xe74c3c,  // Red
      description: `The library scan encountered an error during ${data.phase}.`,
      fields: [
        { name: 'Error', value: data.error.substring(0, 1024), inline: false },
        ...(data.itemsScannedBeforeError
          ? [{ name: 'Items Before Error', value: String(data.itemsScannedBeforeError), inline: true }]
          : []),
      ],
      timestamp: data.timestamp,
      footer: { text: 'Prunerr Media Library Manager' },
    }],
    username: 'Prunerr',
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Environment variables | Database settings | Phase 4 | Webhook URL configurable via UI |
| Hardcoded service init | Dependency injection | Current architecture | Testable, configurable notifications |

**Deprecated/outdated:**
- Environment variable `DISCORD_WEBHOOK_URL`: Still supported as fallback, but database settings take precedence

## Open Questions

1. **Should notifications include action links?**
   - What we know: Discord embeds support URL fields and buttons
   - What's unclear: Whether to link back to Prunerr dashboard
   - Recommendation: Start without links; add if users request

2. **Notification frequency for batch operations**
   - What we know: Rate limit is 5 requests per 2 seconds
   - What's unclear: If multiple items flagged, one notification or many?
   - Recommendation: One summary notification per scan, not per item

## Sources

### Primary (HIGH confidence)
- Existing codebase: `server/src/notifications/index.ts`, `templates.ts` - verified implementation
- Existing codebase: `server/src/scheduler/tasks.ts` - verified notification integration
- Existing codebase: `server/src/routes/settings.ts` - verified settings API

### Secondary (MEDIUM confidence)
- [Discord Webhooks Guide - Rate Limits](https://birdie0.github.io/discord-webhooks-guide/other/rate_limits.html) - 5 requests per 2 seconds, X-RateLimit headers
- [Discord Webhooks Guide - JSON Structure](https://birdie0.github.io/discord-webhooks-guide/json.html) - Embed format, color as decimal
- [Hookdeck Guide to Discord Webhooks](https://hookdeck.com/webhooks/platforms/guide-to-discord-webhooks-features-and-best-practices) - Best practices, rate limit handling

### Tertiary (LOW confidence)
- GitHub issues on Discord API rate limiting - 429 responses may lack headers when Cloudflare-blocked

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed, using existing native fetch
- Architecture: HIGH - Existing notification service is well-designed, minimal changes needed
- Pitfalls: HIGH - Based on official Discord rate limit documentation and codebase analysis

**Research date:** 2026-01-24
**Valid until:** 60 days (stable API, no expected changes)
