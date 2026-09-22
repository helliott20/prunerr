import dotenv from 'dotenv';
import path from 'path';

// Load .env here rather than relying on the entrypoint having done it first.
// tsc emits CommonJS requires in source order, so index.ts's dotenv call lands
// first in production — but tsx (used by `npm run dev`) hoists imports, so this
// module would otherwise read process.env before any .env file was applied, and
// local dev would silently ignore it. Loading here works under both.
// dotenv does not override variables already set, so a real environment
// variable — how Docker actually configures this — still wins.
for (const candidate of ['../../.env', '../../../.env']) {
  dotenv.config({ path: path.resolve(__dirname, candidate) });
}
dotenv.config();

import type {
  AppConfig,
  MediaServerConfig,
  JellyfinConfig,
  PlexConfig,
  TautulliConfig,
  TracearrConfig,
  SonarrConfig,
  RadarrConfig,
  OverseerrConfig,
  DiscordConfig,
  UnraidConfig,
  TelemetryConfig,
  AnnouncementsConfig,
} from '../types';

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return '';
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

// Media server selection — which backend Prunerr reads the library from.
// Defaults to Plex so existing installs are unaffected by the upgrade.
const mediaServerConfig: MediaServerConfig = {
  type: getEnv('MEDIA_SERVER_TYPE', 'plex').toLowerCase(),
};

// Plex configuration
const plexConfig: PlexConfig = {
  url: getEnv('PLEX_URL', 'http://localhost:32400'),
  token: getEnv('PLEX_TOKEN'),
};

// Jellyfin/Emby configuration (one settings namespace; MEDIA_SERVER_TYPE picks
// which of the two dialects to speak).
const jellyfinConfig: JellyfinConfig = {
  url: getEnv('JELLYFIN_URL', 'http://localhost:8096'),
  apiKey: getEnv('JELLYFIN_API_KEY'),
};

// Tautulli configuration
const tautulliConfig: TautulliConfig = {
  url: getEnv('TAUTULLI_URL', 'http://localhost:8181'),
  apiKey: getEnv('TAUTULLI_API_KEY'),
};

// Tracearr configuration
const tracearrConfig: TracearrConfig = {
  url: getEnv('TRACEARR_URL', 'http://localhost:3004'),
  apiKey: getEnv('TRACEARR_API_KEY'),
};

// Sonarr configuration
const sonarrConfig: SonarrConfig = {
  url: getEnv('SONARR_URL', 'http://localhost:8989'),
  apiKey: getEnv('SONARR_API_KEY'),
};

// Radarr configuration
const radarrConfig: RadarrConfig = {
  url: getEnv('RADARR_URL', 'http://localhost:7878'),
  apiKey: getEnv('RADARR_API_KEY'),
};

// Overseerr configuration
const overseerrConfig: OverseerrConfig = {
  url: getEnv('OVERSEERR_URL', 'http://localhost:5055'),
  apiKey: getEnv('OVERSEERR_API_KEY'),
};

// Discord configuration
const discordConfig: DiscordConfig = {
  webhookUrl: getEnv('DISCORD_WEBHOOK_URL'),
};

// Unraid configuration
const unraidConfig: UnraidConfig = {
  url: getEnv('UNRAID_URL', 'http://localhost'),
  apiKey: getEnv('UNRAID_API_KEY'),
};

// Anonymous install-count telemetry.
//
// The endpoint that receives heartbeats. Its source lives in this repo under
// packaging/telemetry — deploy that Worker, then put its URL here (Cloudflare
// hands out a free *.workers.dev subdomain, so no domain purchase is needed).
//
// While this is empty no heartbeat is ever sent, whatever the in-app setting
// says. That is the safe default: an unconfigured build must not be able to
// pick up a URL somebody else controls.
const DEFAULT_TELEMETRY_ENDPOINT = 'https://prunerr-telemetry.harryelliott16.workers.dev/v1/ping';

const telemetryConfig: TelemetryConfig = {
  endpoint: getEnv('TELEMETRY_URL', DEFAULT_TELEMETRY_ENDPOINT).trim(),
  // Hard off switch. TELEMETRY_ENABLED=false means no ping and no install ID,
  // regardless of the toggle in Settings.
  enabled: getEnvBoolean('TELEMETRY_ENABLED', true),
};

// The in-app "What's new" feed. Served by the same Worker as the heartbeat
// (packaging/telemetry), governed by the same toggle, and inert while empty.
const DEFAULT_ANNOUNCEMENTS_ENDPOINT =
  'https://prunerr-telemetry.harryelliott16.workers.dev/v1/announcements';

const announcementsConfig: AnnouncementsConfig = {
  endpoint: getEnv('ANNOUNCEMENTS_URL', DEFAULT_ANNOUNCEMENTS_ENDPOINT).trim(),
};

// Main application configuration
const config: AppConfig = {
  port: getEnvNumber('PORT', 3000),
  nodeEnv: getEnv('NODE_ENV', 'development'),
  dbPath: getEnv('DB_PATH', './data/prunerr.db'),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  mediaServer: mediaServerConfig,
  plex: plexConfig,
  jellyfin: jellyfinConfig,
  tautulli: tautulliConfig,
  tracearr: tracearrConfig,
  sonarr: sonarrConfig,
  radarr: radarrConfig,
  overseerr: overseerrConfig,
  discord: discordConfig,
  unraid: unraidConfig,
  telemetry: telemetryConfig,
  announcements: announcementsConfig,
};

// Validation function to check required configurations
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required service configurations when in production. Which
  // credential is mandatory depends on the selected media server — a
  // Jellyfin/Emby install has no Plex token to give.
  //
  // Only env vars are visible here; a user who configured the server through
  // the Settings UI has their credentials in the database instead, so a miss
  // is not necessarily fatal and startup does not hard-fail on it.
  if (config.nodeEnv === 'production') {
    if (config.mediaServer.type === 'plex' && !config.plex.token) {
      errors.push('PLEX_TOKEN is required in production');
    }
    if (config.mediaServer.type !== 'plex' && !config.jellyfin.apiKey) {
      errors.push('JELLYFIN_API_KEY is required in production');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Helper to check if a service is configured
export function isServiceConfigured(service: keyof AppConfig): boolean {
  switch (service) {
    case 'plex':
      return !!config.plex.url && !!config.plex.token;
    case 'jellyfin':
      return !!config.jellyfin.url && !!config.jellyfin.apiKey;
    case 'tautulli':
      return !!config.tautulli.url && !!config.tautulli.apiKey;
    case 'tracearr':
      return !!config.tracearr.url && !!config.tracearr.apiKey;
    case 'sonarr':
      return !!config.sonarr.url && !!config.sonarr.apiKey;
    case 'radarr':
      return !!config.radarr.url && !!config.radarr.apiKey;
    case 'overseerr':
      return !!config.overseerr.url && !!config.overseerr.apiKey;
    case 'discord':
      return !!config.discord.webhookUrl;
    case 'unraid':
      return !!config.unraid.url && !!config.unraid.apiKey;
    default:
      return false;
  }
}

export default config;
