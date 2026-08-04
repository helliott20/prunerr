import logger from '../../utils/logger';
import settingsRepo from '../../db/repositories/settings';
import config from '../../config';
import { PlexService } from '../plex';
import { PlexUsersService } from '../plexUsers';
import { JellyfinService } from '../jellyfin';
import {
  MEDIA_SERVER_LABELS,
  isMediaServerType,
  type MediaServerService,
  type MediaServerType,
  type MediaServerUsersService,
} from './types';

export * from './types';

export interface MediaServerCredentials {
  type: MediaServerType;
  url: string;
  /** Plex token, or Jellyfin/Emby API key. */
  credential: string;
}

/**
 * Which backend the user has configured.
 *
 * Defaults to Plex when unset so existing installs — which only ever had Plex
 * settings — keep working untouched after upgrading.
 */
export function getConfiguredServerType(): MediaServerType {
  const stored = settingsRepo.getValue('media_server_type') ?? config.mediaServer.type;
  if (isMediaServerType(stored)) return stored;

  if (stored) {
    logger.warn(`Unknown media_server_type "${stored}", falling back to Plex`);
  }
  return 'plex';
}

/**
 * Resolve the configured backend's URL and credential.
 *
 * Settings take precedence over environment variables, matching how every
 * other service in Prunerr resolves its config. Returns null when the backend
 * has not been set up yet.
 */
export function getMediaServerCredentials(): MediaServerCredentials | null {
  const type = getConfiguredServerType();

  if (type === 'plex') {
    const url = settingsRepo.getValue('plex_url') || config.plex.url;
    const credential = settingsRepo.getValue('plex_token') || config.plex.token;
    return url && credential ? { type, url, credential } : null;
  }

  // Jellyfin and Emby share a settings namespace — a given install talks to one
  // or the other, and `media_server_type` disambiguates which.
  const url = settingsRepo.getValue('jellyfin_url') || config.jellyfin.url;
  const credential = settingsRepo.getValue('jellyfin_apiKey') || config.jellyfin.apiKey;
  return url && credential ? { type, url, credential } : null;
}

/** Build a media server client for an explicit set of credentials. */
export function createMediaServer(
  type: MediaServerType,
  url: string,
  credential: string
): MediaServerService {
  switch (type) {
    case 'plex':
      return new PlexService(url, credential);
    case 'jellyfin':
    case 'emby':
      return new JellyfinService(url, credential, type);
    default: {
      // Exhaustiveness guard — a new MediaServerType must be handled here.
      const exhaustive: never = type;
      throw new Error(`Unsupported media server type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Build the users service matching a backend.
 *
 * Plex needs its own client because accounts live on plex.tv rather than on the
 * server; Jellyfin and Emby serve `/Users` from the server itself, so the media
 * server client doubles as the users service.
 */
export function createMediaServerUsers(
  server: MediaServerService,
  url: string,
  credential: string
): MediaServerUsersService {
  if (server.serverType === 'plex') {
    return new PlexUsersService(url, credential);
  }
  return server as unknown as MediaServerUsersService;
}

/** Build the configured backend, or null if it has not been set up. */
export function createConfiguredMediaServer(): MediaServerService | null {
  const creds = getMediaServerCredentials();
  if (!creds) return null;
  return createMediaServer(creds.type, creds.url, creds.credential);
}

export function getMediaServerLabel(type: MediaServerType = getConfiguredServerType()): string {
  return MEDIA_SERVER_LABELS[type];
}
