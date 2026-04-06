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
 * Heuristics:
 * - Has a Referer or Origin header pointing to the same host
 * - Does NOT have an X-Api-Key header (external consumers always send it)
 * - Has typical browser indicators (Accept includes text/html or Sec-Fetch-Site)
 */
function isSameOriginBrowser(req: Request): boolean {
  // If the request explicitly sends an API key, treat it as external
  if (req.headers['x-api-key']) {
    return false;
  }

  const origin = req.headers['origin'] as string | undefined;
  const referer = req.headers['referer'] as string | undefined;
  const secFetchSite = req.headers['sec-fetch-site'] as string | undefined;

  // Sec-Fetch-Site is the most reliable browser-set header
  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') {
    return true;
  }

  // Check Origin header matches the Host
  const host = req.headers['host'];
  if (origin && host) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) {
        return true;
      }
    } catch {
      // Invalid origin URL, fall through
    }
  }

  // Check Referer header matches the Host
  if (referer && host) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) {
        return true;
      }
    } catch {
      // Invalid referer URL, fall through
    }
  }

  return false;
}

/**
 * Express middleware that enforces API key authentication on /api/* routes.
 *
 * - Same-origin browser requests (web UI) are always allowed.
 * - All other requests must include a valid X-Api-Key header.
 * - The PRUNERR_API_KEY env var is accepted as an override.
 */
export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow same-origin browser requests (the web UI)
  if (isSameOriginBrowser(req)) {
    next();
    return;
  }

  // Check the X-Api-Key header
  const providedKey = req.headers['x-api-key'] as string | undefined;
  if (!providedKey) {
    logger.warn(`API auth: missing X-Api-Key header from ${req.ip} for ${req.method} ${req.path}`);
    res.status(401).json({
      success: false,
      error: 'API key required. Include X-Api-Key header.',
    });
    return;
  }

  const validKey = getApiKey();

  // Constant-time comparison to prevent timing attacks
  const providedBuf = Buffer.from(providedKey);
  const validBuf = Buffer.from(validKey);

  if (providedBuf.length !== validBuf.length || !crypto.timingSafeEqual(providedBuf, validBuf)) {
    logger.warn(`API auth: invalid API key from ${req.ip} for ${req.method} ${req.path}`);
    res.status(401).json({
      success: false,
      error: 'Invalid API key.',
    });
    return;
  }

  next();
}
