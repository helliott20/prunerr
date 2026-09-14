import crypto from 'crypto';
import axios from 'axios';

import config from '../config';
import logger from '../utils/logger';
import settingsRepo from '../db/repositories/settings';
import { getAppVersion } from '../utils/version';

/**
 * Anonymous install-count telemetry.
 *
 * The only question this answers is "how many Prunerr installs are still
 * running?". A heartbeat carries a random install ID and the Prunerr version,
 * and nothing else — no library contents, no service URLs or credentials, no
 * paths, no hostname, no user identity. The install ID is random, so it maps
 * back to no one; turning telemetry off deletes it outright.
 *
 * Every failure here is swallowed. Telemetry must never delay startup, fail a
 * scheduled run, or surface an error to someone whose media server is working
 * perfectly well.
 */

// Setting keys. `telemetry_install_id` is deliberately excluded from settings
// export/import — see routes/settings.ts — so restoring a backup onto a second
// machine creates a second install rather than a duplicate of the first.
export const TELEMETRY_ENABLED_KEY = 'telemetry_enabled';
export const TELEMETRY_INSTALL_ID_KEY = 'telemetry_install_id';
export const TELEMETRY_NOTICE_SEEN_KEY = 'telemetry_notice_seen';
export const TELEMETRY_LAST_PING_KEY = 'telemetry_last_ping_at';

/** Give up quickly: a hung endpoint must not hold a scheduled task open. */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Don't re-ping within this window. Heartbeats are daily, but a container that
 * restart-loops would otherwise ping on every boot.
 */
const MIN_PING_INTERVAL_MS = 20 * 60 * 60 * 1000;

export interface TelemetryState {
  /** Whether a heartbeat would actually be sent right now. */
  enabled: boolean;
  /**
   * True when the deployment disabled telemetry via TELEMETRY_ENABLED=false.
   * The in-app toggle cannot override this, so the UI renders it as locked
   * rather than pretending the switch still works.
   */
  lockedByEnv: boolean;
  /** Whether the first-run notice has been acknowledged. */
  noticeSeen: boolean;
  /** The exact payload value, so the UI can show what actually gets sent. */
  installId: string | null;
  version: string;
  endpoint: string;
  lastPingAt: string | null;
}

/** The complete heartbeat payload. If it isn't in here, it isn't sent. */
export interface HeartbeatPayload {
  installId: string;
  version: string;
}

/**
 * Whether telemetry is on. The environment variable wins: a `false` there is a
 * hard off switch for people who do not want their container talking to
 * anything, and no stored setting can re-enable it.
 */
export function isTelemetryEnabled(): boolean {
  if (!config.telemetry.enabled) return false;
  if (!config.telemetry.endpoint) return false;
  return settingsRepo.getBoolean(TELEMETRY_ENABLED_KEY, true);
}

/** True when TELEMETRY_ENABLED=false took the decision out of the UI's hands. */
export function isLockedByEnv(): boolean {
  return !config.telemetry.enabled;
}

/**
 * The install's random ID, created on first use.
 *
 * Random, not derived: nothing about the machine, the library or any
 * credential feeds into it, so it identifies the install only for as long as
 * the install chooses to keep it.
 */
export function getOrCreateInstallId(): string {
  const existing = settingsRepo.getValue(TELEMETRY_INSTALL_ID_KEY);
  if (existing) return existing;

  const installId = crypto.randomUUID();
  settingsRepo.set({ key: TELEMETRY_INSTALL_ID_KEY, value: installId });
  logger.info('Generated anonymous telemetry install ID');
  return installId;
}

/** The stored ID, without creating one. Used for read-only state reporting. */
export function peekInstallId(): string | null {
  return settingsRepo.getValue(TELEMETRY_INSTALL_ID_KEY);
}

export function getTelemetryState(): TelemetryState {
  return {
    enabled: isTelemetryEnabled(),
    lockedByEnv: isLockedByEnv(),
    noticeSeen: settingsRepo.getBoolean(TELEMETRY_NOTICE_SEEN_KEY, false),
    installId: peekInstallId(),
    version: getAppVersion(),
    endpoint: config.telemetry.endpoint,
    lastPingAt: settingsRepo.getValue(TELEMETRY_LAST_PING_KEY),
  };
}

/**
 * Turn telemetry on or off.
 *
 * Switching off discards the install ID, so the promise made in the UI — "we
 * forget the ID" — is literally true rather than a flag we agree to respect.
 * Switching back on mints a fresh one; the old install simply ages out of the
 * count.
 */
export function setTelemetryEnabled(enabled: boolean): TelemetryState {
  settingsRepo.set({ key: TELEMETRY_ENABLED_KEY, value: enabled ? 'true' : 'false' });

  if (!enabled) {
    settingsRepo.delete(TELEMETRY_INSTALL_ID_KEY);
    settingsRepo.delete(TELEMETRY_LAST_PING_KEY);
    logger.info('Telemetry disabled — install ID discarded');
  } else {
    logger.info('Telemetry enabled');
  }

  return getTelemetryState();
}

/** Record that the first-run notice has been shown and dismissed. */
export function markNoticeSeen(): TelemetryState {
  settingsRepo.set({ key: TELEMETRY_NOTICE_SEEN_KEY, value: 'true' });
  return getTelemetryState();
}

/** Whether enough time has passed since the last heartbeat to send another. */
function isDue(now: number): boolean {
  const last = settingsRepo.getValue(TELEMETRY_LAST_PING_KEY);
  if (!last) return true;

  const lastMs = Date.parse(last);
  if (Number.isNaN(lastMs)) return true;

  return now - lastMs >= MIN_PING_INTERVAL_MS;
}

export interface HeartbeatResult {
  sent: boolean;
  /** Why nothing was sent, for logs and the scheduler's task message. */
  reason?: 'disabled' | 'not-due' | 'failed';
}

/**
 * Send one heartbeat.
 *
 * `force` skips the interval check — used by the "send a test ping" path, not
 * by the schedule.
 */
export async function sendHeartbeat(force = false): Promise<HeartbeatResult> {
  if (!isTelemetryEnabled()) {
    return { sent: false, reason: 'disabled' };
  }

  const now = Date.now();
  if (!force && !isDue(now)) {
    return { sent: false, reason: 'not-due' };
  }

  const payload: HeartbeatPayload = {
    installId: getOrCreateInstallId(),
    version: getAppVersion(),
  };

  try {
    await axios.post(config.telemetry.endpoint, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Prunerr/${payload.version}`,
      },
    });

    settingsRepo.set({
      key: TELEMETRY_LAST_PING_KEY,
      value: new Date(now).toISOString(),
    });
    logger.debug('Telemetry heartbeat sent');
    return { sent: true };
  } catch (error) {
    // Offline installs are the normal case, not an error worth alarming
    // anyone about. Nothing retries; the next daily run is the retry.
    logger.debug(
      `Telemetry heartbeat failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return { sent: false, reason: 'failed' };
  }
}

/**
 * Fire the startup heartbeat without blocking boot.
 *
 * Deliberately not awaited by the caller: a slow or unreachable endpoint must
 * not add seconds to startup.
 */
export function sendStartupHeartbeat(): void {
  if (!isTelemetryEnabled()) return;

  void sendHeartbeat().catch(() => {
    /* sendHeartbeat already swallows its own failures. */
  });
}
