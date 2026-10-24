import settingsRepo from '../db/repositories/settings';
import logger from '../utils/logger';

// Service connections documented as environment variables (README,
// docker-compose.yml, the Unraid template). Most of the app reads connections
// from the settings table only, so these are copied into the table rather than
// read separately; otherwise an install configured purely through the
// environment comes up looking blank (issue #93).
const ENV_TO_SETTING: Array<[env: string, key: string]> = [
  ['PLEX_URL', 'plex_url'],
  ['PLEX_TOKEN', 'plex_token'],
  ['JELLYFIN_URL', 'jellyfin_url'],
  ['JELLYFIN_API_KEY', 'jellyfin_apiKey'],
  ['TAUTULLI_URL', 'tautulli_url'],
  ['TAUTULLI_API_KEY', 'tautulli_apiKey'],
  ['TRACEARR_URL', 'tracearr_url'],
  ['TRACEARR_API_KEY', 'tracearr_apiKey'],
  ['SONARR_URL', 'sonarr_url'],
  ['SONARR_API_KEY', 'sonarr_apiKey'],
  ['RADARR_URL', 'radarr_url'],
  ['RADARR_API_KEY', 'radarr_apiKey'],
  ['OVERSEERR_URL', 'overseerr_url'],
  ['OVERSEERR_API_KEY', 'overseerr_apiKey'],
  ['UNRAID_URL', 'unraid_url'],
  ['UNRAID_API_KEY', 'unraid_apiKey'],
];

/**
 * CONFIG_FROM_ENV=true makes the environment the source of truth for every
 * service variable that is set: the value is re-applied on each start and the
 * matching Settings fields are read-only. Without it, variables only fill in
 * settings that have never been saved, and the UI owns them after that.
 */
export function isConfigFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['CONFIG_FROM_ENV']?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

/** Setting keys locked to an environment variable (none unless CONFIG_FROM_ENV is on). */
export function getEnvManagedKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!isConfigFromEnv(env)) return [];
  return ENV_TO_SETTING.filter(([envName]) => env[envName]?.trim()).map(([, key]) => key);
}

export function isEnvManaged(key: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return getEnvManagedKeys(env).includes(key);
}

/**
 * Write service variables into the settings table (issue #93). With
 * CONFIG_FROM_ENV on, each variable that is set replaces the stored value;
 * otherwise it is only used when that setting has never been saved, so
 * anything set in the UI (including a cleared field) wins. Returns the keys
 * it changed.
 */
export function applyEnvSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = isConfigFromEnv(env);
  const changed: string[] = [];
  for (const [envName, key] of ENV_TO_SETTING) {
    const value = env[envName]?.trim();
    if (!value) continue;
    if (override ? settingsRepo.getValue(key) === value : settingsRepo.getByKey(key)) continue;
    settingsRepo.set({ key, value });
    changed.push(key);
  }
  if (changed.length > 0) {
    logger.info(`Applied settings from environment variables: ${changed.join(', ')}`);
  }
  return changed;
}
