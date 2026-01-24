import logger from '../utils/logger';
import { getDeletionService } from './deletion';
import { SonarrService } from './sonarr';
import { RadarrService } from './radarr';
import { OverseerrService } from './overseerr';
import { PlexService } from './plex';
import { TautulliService } from './tautulli';
import mediaItemsRepo from '../db/repositories/mediaItems';
import rulesRepo from '../db/repositories/rules';
import settingsRepo from '../db/repositories/settings';
import historyRepo from '../db/repositories/historyRepo';
import type { MediaItem } from '../types';

// Service instances (singletons)
let sonarrService: SonarrService | null = null;
let radarrService: RadarrService | null = null;
let overseerrService: OverseerrService | null = null;
let plexService: PlexService | null = null;
let tautulliService: TautulliService | null = null;

/**
 * Get service credentials from database settings
 */
function getServiceConfig(serviceName: string): { url: string | null; apiKey: string | null } {
  const url = settingsRepo.getValue(`${serviceName}_url`);
  // Settings use camelCase: sonarr_apiKey, radarr_apiKey, etc.
  const apiKey = settingsRepo.getValue(`${serviceName}_apiKey`);
  return { url, apiKey };
}

/**
 * Get or create Sonarr service instance
 */
export function getSonarrService(): SonarrService | null {
  if (!sonarrService) {
    const { url, apiKey } = getServiceConfig('sonarr');
    if (url && apiKey) {
      sonarrService = new SonarrService(url, apiKey);
      logger.info('Sonarr service initialized');
    }
  }
  return sonarrService;
}

/**
 * Get or create Radarr service instance
 */
export function getRadarrService(): RadarrService | null {
  if (!radarrService) {
    const { url, apiKey } = getServiceConfig('radarr');
    if (url && apiKey) {
      radarrService = new RadarrService(url, apiKey);
      logger.info('Radarr service initialized');
    }
  }
  return radarrService;
}

/**
 * Get or create Overseerr service instance
 */
export function getOverseerrService(): OverseerrService | null {
  if (!overseerrService) {
    const { url, apiKey } = getServiceConfig('overseerr');
    if (url && apiKey) {
      overseerrService = new OverseerrService(url, apiKey);
      logger.info('Overseerr service initialized');
    }
  }
  return overseerrService;
}

/**
 * Get Plex credentials from database settings (uses token, not apiKey)
 */
function getPlexConfig(): { url: string | null; token: string | null } {
  const url = settingsRepo.getValue('plex_url');
  const token = settingsRepo.getValue('plex_token');
  return { url, token };
}

/**
 * Get or create Plex service instance
 */
export function getPlexService(): PlexService | null {
  if (!plexService) {
    const { url, token } = getPlexConfig();
    if (url && token) {
      plexService = new PlexService(url, token);
      logger.info('Plex service initialized');
    }
  }
  return plexService;
}

/**
 * Get or create Tautulli service instance
 */
export function getTautulliService(): TautulliService | null {
  if (!tautulliService) {
    const { url, apiKey } = getServiceConfig('tautulli');
    if (url && apiKey) {
      tautulliService = new TautulliService(url, apiKey);
      logger.info('Tautulli service initialized');
    }
  }
  return tautulliService;
}

/**
 * Clear cached service instances (call when settings change)
 */
export function refreshServices(): void {
  sonarrService = null;
  radarrService = null;
  overseerrService = null;
  plexService = null;
  tautulliService = null;
  logger.info('Service instances cleared, will reinitialize on next access');
}

/**
 * Initialize all services and wire up dependencies
 */
export async function initializeServices(): Promise<void> {
  logger.info('Initializing services...');

  // Initialize service instances based on config
  const sonarr = getSonarrService();
  const radarr = getRadarrService();
  const overseerr = getOverseerrService();

  // Wire up the deletion service with all dependencies
  const deletionService = getDeletionService();

  deletionService.setDependencies({
    // Media item repository adapter
    mediaItemRepository: {
      async getById(id: number): Promise<MediaItem | null> {
        return mediaItemsRepo.getById(id) as MediaItem | null;
      },
      async update(id: number, data: Partial<MediaItem>): Promise<void> {
        mediaItemsRepo.update(id, data as any);
      },
      async delete(id: number): Promise<void> {
        mediaItemsRepo.delete(id);
      },
      async getByStatus(status: string): Promise<MediaItem[]> {
        if (status === 'pending_deletion') {
          return mediaItemsRepo.getPendingDeletion() as MediaItem[];
        }
        const result = mediaItemsRepo.getAll({ status: status as any, limit: 10000 });
        return result.data as MediaItem[];
      },
    },

    // Rules repository adapter
    ruleRepository: {
      async getById(id: number) {
        const rule = rulesRepo.rules.getById(id);
        if (!rule) return null;
        return {
          id: rule.id,
          name: rule.name,
          deletion_action: (rule as any).deletion_action,
          reset_overseerr: (rule as any).reset_overseerr,
        };
      },
    },

    // Sonarr service (if configured)
    sonarrService: sonarr ? {
      async unmonitorSeries(seriesId: number): Promise<void> {
        await sonarr.unmonitorSeries(seriesId);
      },
      async deleteEpisodeFile(episodeFileId: number): Promise<void> {
        await sonarr.deleteEpisodeFile(episodeFileId);
      },
      async deleteAllEpisodeFiles(seriesId: number): Promise<{ deleted: number; failed: number }> {
        return await sonarr.deleteAllEpisodeFiles(seriesId);
      },
      async removeSeries(seriesId: number, deleteFiles: boolean): Promise<void> {
        await sonarr.removeSeries(seriesId, deleteFiles);
      },
    } : undefined,

    // Radarr service (if configured)
    radarrService: radarr ? {
      async unmonitorMovie(movieId: number): Promise<void> {
        await radarr.unmonitorMovie(movieId);
      },
      async deleteMovieFile(movieFileId: number): Promise<void> {
        await radarr.deleteMovieFile(movieFileId);
      },
      async deleteMovieFilesByMovieId(movieId: number): Promise<boolean> {
        return await radarr.deleteMovieFilesByMovieId(movieId);
      },
      async removeMovie(movieId: number, deleteFiles: boolean): Promise<void> {
        await radarr.removeMovie(movieId, deleteFiles);
      },
    } : undefined,

    // Overseerr service (if configured)
    overseerrService: overseerr ? {
      async resetMediaByTmdbId(tmdbId: number, type: 'movie' | 'tv'): Promise<boolean> {
        return await overseerr.resetMediaByTmdbId(tmdbId, type);
      },
      async getRequestedBy(tmdbId: number, type: 'movie' | 'tv'): Promise<string | null> {
        return await overseerr.getRequestedBy(tmdbId, type);
      },
      async notifyRequesterOfDeletion(
        tmdbId: number,
        type: 'movie' | 'tv',
        title: string,
        reason?: string
      ): Promise<boolean> {
        return await overseerr.notifyRequesterOfDeletion(tmdbId, type, title, reason);
      },
    } : undefined,

    // Deletion history repository
    deletionHistoryRepository: {
      async create(data: {
        media_item_id: number | null;
        title: string;
        type: 'movie' | 'show' | 'episode';
        file_size: number | null;
        deleted_at: string;
        deletion_type: 'automatic' | 'manual';
        deleted_by_rule_id: number | null;
        overseerr_reset?: number;
      }) {
        return historyRepo.create({
          media_item_id: data.media_item_id,
          title: data.title,
          type: data.type,
          file_size: data.file_size,
          deletion_type: data.deletion_type,
          deleted_by_rule_id: data.deleted_by_rule_id,
        });
      },
    },

    // TODO: Add notification service when implemented
    // notificationService: ...
  });

  // Log which services are configured
  const configuredServices: string[] = [];
  if (sonarr) configuredServices.push('Sonarr');
  if (radarr) configuredServices.push('Radarr');
  if (overseerr) configuredServices.push('Overseerr');

  if (configuredServices.length > 0) {
    logger.info(`Deletion service configured with: ${configuredServices.join(', ')}`);
  } else {
    logger.warn('No external services configured for deletion service. Deletions will only update database status.');
  }

  logger.info('Services initialized successfully');
}

/**
 * Test connections to all configured services
 */
export async function testServiceConnections(): Promise<{
  sonarr: boolean;
  radarr: boolean;
  overseerr: boolean;
}> {
  const results = {
    sonarr: false,
    radarr: false,
    overseerr: false,
  };

  const sonarr = getSonarrService();
  if (sonarr) {
    try {
      results.sonarr = await sonarr.testConnection();
    } catch (error) {
      logger.error('Sonarr connection test failed:', error);
    }
  }

  const radarr = getRadarrService();
  if (radarr) {
    try {
      results.radarr = await radarr.testConnection();
    } catch (error) {
      logger.error('Radarr connection test failed:', error);
    }
  }

  const overseerr = getOverseerrService();
  if (overseerr) {
    try {
      results.overseerr = await overseerr.testConnection();
    } catch (error) {
      logger.error('Overseerr connection test failed:', error);
    }
  }

  return results;
}

export default {
  initializeServices,
  testServiceConnections,
  refreshServices,
  getSonarrService,
  getRadarrService,
  getOverseerrService,
  getPlexService,
  getTautulliService,
};
