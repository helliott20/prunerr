import settingsRepo from '../db/repositories/settings';
import logger from '../utils/logger';

// Service connections documented as environment variables (README,
// docker-compose.yml, the Unraid template). Most of the app reads connections
// from the settings table only, so without this an install configured purely
// through the environment came up looking blank (issue #93).
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
 * Copy service connections from environment variables into the settings
 * table, for any setting that has never been stored. Anything already saved
 * (including a value cleared in Settings) wins, so the UI stays the place to
 * change a connection after first start. Returns the keys it wrote.
 */
export function seedSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const seeded: string[] = [];
  for (const [envName, key] of ENV_TO_SETTING) {
    const value = env[envName]?.trim();
    if (!value || settingsRepo.getByKey(key)) continue;
    settingsRepo.set({ key, value });
    seeded.push(key);
  }
  if (seeded.length > 0) {
    logger.info(`Imported settings from environment variables: ${seeded.join(', ')}`);
  }
  return seeded;
}
