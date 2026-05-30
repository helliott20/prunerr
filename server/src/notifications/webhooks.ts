import crypto from 'crypto';
import logger from '../utils/logger';
import settingsRepo from '../db/repositories/settings';
import type { NotificationData, NotificationEvent } from './templates';

// ============================================================================
// Types
// ============================================================================

export interface WebhookTarget {
  id: string;
  name?: string;
  url: string;
  /** Events this target opts into. Empty array = no events (effectively off). */
  events: NotificationEvent[];
  enabled: boolean;
  /** Optional shared secret; when set, requests are signed with HMAC-SHA256. */
  secret?: string;
}

export interface WebhookEnvelope {
  event: NotificationEvent | string;
  timestamp: string;
  source: 'prunerr';
  version: 1;
  data: NotificationData;
}

const SETTINGS_KEY = 'webhooks_targets';
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1500];

// ============================================================================
// Loading
// ============================================================================

/**
 * Load configured webhook targets from settings. Tolerates malformed data.
 */
export function loadWebhookTargets(): WebhookTarget[] {
  const raw = settingsRepo.getJson<WebhookTarget[]>(SETTINGS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((t) => t && typeof t.url === 'string' && t.url.length > 0);
}

// ============================================================================
// Sending
// ============================================================================

function sign(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WebhookSendResult {
  success: boolean;
  status?: number;
  error?: string;
}

/**
 * POST a single envelope to a webhook target. Retries on network errors,
 * 5xx, and 429 (never on other 4xx). Never throws.
 *
 * @param attempts override the max attempt count (e.g. 1 for the Test button)
 */
export async function sendWebhook(
  target: Pick<WebhookTarget, 'url' | 'secret' | 'name'>,
  envelope: WebhookEnvelope,
  attempts: number = MAX_ATTEMPTS
): Promise<WebhookSendResult> {
  if (!target.url) {
    return { success: false, error: 'Webhook URL not configured' };
  }

  // Serialize once so the signature matches the exact bytes we send.
  const body = JSON.stringify(envelope);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Prunerr-Webhook/1',
    'X-Prunerr-Event': String(envelope.event),
  };
  if (target.secret) {
    headers['X-Prunerr-Signature'] = sign(target.secret, body);
  }

  let lastError = '';
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(target.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        // Do NOT follow redirects: a target must not be able to bounce us into
        // an internal endpoint (SSRF). A 3xx surfaces as an opaqueredirect.
        redirect: 'manual',
      });
      lastStatus = response.status;

      // redirect:'manual' yields an opaque response (status 0) for any 3xx.
      if (response.type === 'opaqueredirect' || response.status === 0) {
        clearTimeout(timer);
        return { success: false, error: 'Webhook target attempted a redirect, which is not followed' };
      }

      if (response.ok) {
        return { success: true, status: response.status };
      }

      // 4xx (except 429) are client errors that won't be fixed by retrying.
      const retryable = response.status >= 500 || response.status === 429;
      lastError = `HTTP ${response.status}`;
      if (!retryable) {
        return { success: false, status: response.status, error: lastError };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) {
      await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!);
    }
  }

  logger.warn(`Webhook to ${target.name || target.url} failed after ${attempts} attempt(s): ${lastError}`);
  return { success: false, status: lastStatus, error: lastError };
}

/**
 * Fan an event out to every enabled target that opted into it. Fire-and-forget:
 * builds one envelope, posts to all matching targets in parallel, never throws.
 */
export async function fanOutWebhooks(
  event: NotificationEvent | string,
  data: NotificationData,
  timestamp: string
): Promise<void> {
  const targets = loadWebhookTargets().filter(
    (t) => t.enabled && Array.isArray(t.events) && t.events.includes(event as NotificationEvent)
  );

  if (targets.length === 0) return;

  const envelope: WebhookEnvelope = {
    event,
    timestamp,
    source: 'prunerr',
    version: 1,
    data,
  };

  const results = await Promise.allSettled(targets.map((t) => sendWebhook(t, envelope)));
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
  logger.info(`Webhook fan-out for ${event}: ${ok}/${targets.length} delivered`);
}
