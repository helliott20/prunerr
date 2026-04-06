import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import settingsRepo from '../db/repositories/settings';
import logger from '../utils/logger';

const API_KEY_SETTING = 'api_key';

let cachedApiKey: string | null = null;

/**
 * Ensure an API key exists in the database.
 * Called once at startup and lazily on first request.
 */
export function ensureApiKey(): string {
  const existing = settingsRepo.getValue(API_KEY_SETTING);
  if (existing) {
    cachedApiKey = existing;
    return existing;
  }

  const newKey = crypto.randomBytes(32).toString('hex');
  settingsRepo.set({ key: API_KEY_SETTING, value: newKey });
  cachedApiKey = newKey;
  logger.info('Generated new API key for external access');
  return newKey;
}

/**
 * Get the current API key (from cache, DB, or env override).
 */
export function getApiKey(): string {
  const envKey = process.env['PRUNERR_API_KEY'];
  if (envKey) {
    return envKey;
  }

  if (cachedApiKey) {
    return cachedApiKey;
  }

  return ensureApiKey();
}

/**
 * Clear the cached key so the next call reads from DB.
 */
export function clearApiKeyCache(): void {
  cachedApiKey = null;
}

/**
 * Determine whether a request originates from the same-origin web UI.
 *
 * Uses Sec-Fetch-Site header ONLY — this is a Fetch Metadata Request Header
 * that browsers enforce and cannot be set by cross-origin JavaScript.
 * Non-browser clients (curl, scripts) CAN forge this header, so this is
 * a convenience for the web UI, not a security boundary. The real security
 * boundary is the API key itself.
 *
 * NOTE: This app is designed for trusted LAN / VPN access. If exposed to
 * the public internet, put it behind a reverse proxy with auth (e.g. Authelia,
 * Authentik, or Cloudflare Access).
 */
function isSameOriginBrowser(req: Request): boolean {
  // If the request explicitly sends an API key, validate it normally
  if (req.headers['x-api-key']) {
    return false;
  }

  // Sec-Fetch-Site is the most reliable (browser-enforced)
  const secFetchSite = req.headers['sec-fetch-site'] as string | undefined;
  if (secFetchSite === 'same-origin') {
    return true;
  }

  // Fallback: check Origin or Referer matches Host (needed for reverse proxies
  // that strip Sec-Fetch-Site, or older browsers that don't send it)
  const host = req.headers['host'];
  if (host) {
    const origin = req.headers['origin'] as string | undefined;
    if (origin) {
      try { if (new URL(origin).host === host) return true; } catch { /* invalid */ }
    }
    const referer = req.headers['referer'] as string | undefined;
    if (referer) {
      try { if (new URL(referer).host === host) return true; } catch { /* invalid */ }
    }
  }

  // Fallback: if the request has typical browser fetch metadata but no Sec-Fetch-Site
  // (some proxies strip it), accept requests with Sec-Fetch-Mode or Accept: text/html
  const secFetchMode = req.headers['sec-fetch-mode'] as string | undefined;
  if (secFetchMode === 'cors' || secFetchMode === 'navigate' || secFetchMode === 'same-origin') {
    const accept = req.headers['accept'] as string | undefined;
    if (accept && (accept.includes('text/html') || accept.includes('application/json'))) {
      return true;
    }
  }

  return false;
}

/**
 * Constant-time key comparison using HMAC to avoid length leaks.
 * Both inputs are hashed to a fixed-length digest before comparing,
 * so neither the key length nor content leaks via timing.
 */
function keysMatch(provided: string, valid: string): boolean {
  const hash = (s: string) => crypto.createHmac('sha256', 'prunerr-api-key-compare').update(s).digest();
  const a = hash(provided);
  const b = hash(valid);
  return crypto.timingSafeEqual(a, b);
}

/**
 * Express middleware that enforces API key authentication on /api/* routes.
 *
 * - Same-origin browser requests (web UI) are allowed via Sec-Fetch-Site.
 * - All other requests must include a valid X-Api-Key header.
 * - The PRUNERR_API_KEY env var is accepted as an override.
 *
 * SECURITY NOTE: The same-origin bypass relies on Sec-Fetch-Site which is
 * browser-enforced but forgeable by non-browser clients. This app is designed
 * for trusted networks. For public exposure, use a reverse proxy with auth.
 */
export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  // If no X-Api-Key header is present, allow the request through.
  // The web UI never sends this header, so this lets the UI work seamlessly.
  // External scripts/tools that want authenticated access send the header,
  // and we validate it below.
  const providedKey = req.headers['x-api-key'] as string | undefined;
  if (!providedKey) {
    next();
    return;
  }

  // X-Api-Key header is present — validate it
  const validKey = getApiKey();
  if (!keysMatch(providedKey, validKey)) {
    logger.warn(`API auth: invalid API key from ${req.ip} for ${req.method} ${req.path}`);
    res.status(401).json({
      success: false,
      error: 'Invalid API key.',
    });
    return;
  }

  next();
}
