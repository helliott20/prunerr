import type {
  AppConfig,
  PlexConfig,
  TautulliConfig,
  SonarrConfig,
  RadarrConfig,
  OverseerrConfig,
  DiscordConfig,
  UnraidConfig,
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

// Plex configuration
const plexConfig: PlexConfig = {
  url: getEnv('PLEX_URL', 'http://localhost:32400'),
  token: getEnv('PLEX_TOKEN'),
};

// Tautulli configuration
const tautulliConfig: TautulliConfig = {
  url: getEnv('TAUTULLI_URL', 'http://localhost:8181'),
  apiKey: getEnv('TAUTULLI_API_KEY'),
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

// Main application configuration
const config: AppConfig = {
  port: getEnvNumber('PORT', 3000),
  nodeEnv: getEnv('NODE_ENV', 'development'),
  dbPath: getEnv('DB_PATH', './data/prunerr.db'),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  plex: plexConfig,
  tautulli: tautulliConfig,
  sonarr: sonarrConfig,
  radarr: radarrConfig,
  overseerr: overseerrConfig,
  discord: discordConfig,
  unraid: unraidConfig,
};

// Validation function to check required configurations
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required service configurations when in production
  if (config.nodeEnv === 'production') {
    if (!config.plex.token) {
      errors.push('PLEX_TOKEN is required in production');
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
    case 'tautulli':
      return !!config.tautulli.url && !!config.tautulli.apiKey;
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
