import { readFileSync } from 'fs';
import { join } from 'path';
import logger from './logger';

const FALLBACK_VERSION = '1.0.0';

let cachedVersion: string | null = null;

/**
 * The running Prunerr version.
 *
 * Docker builds inject APP_VERSION, which is authoritative. Outside Docker
 * (local dev, `npm start` from a checkout) there is no such variable, so fall
 * back to the version in package.json. Resolved once and cached — this is read
 * on every health check and on every telemetry heartbeat.
 */
export function getAppVersion(): string {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  const fromEnv = process.env['APP_VERSION'];
  if (fromEnv && fromEnv !== FALLBACK_VERSION) {
    cachedVersion = fromEnv;
    return cachedVersion;
  }

  try {
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    cachedVersion = packageJson.version || FALLBACK_VERSION;
  } catch {
    logger.warn('Could not read version from package.json');
    cachedVersion = FALLBACK_VERSION;
  }

  return cachedVersion ?? FALLBACK_VERSION;
}

/** Test seam — drops the memoised value so a changed env var is picked up. */
export function resetVersionCache(): void {
  cachedVersion = null;
}
