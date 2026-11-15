import logger from '../utils/logger';
import { getDeletionService, type RadarrDeletionService, type SonarrDeletionService } from './deletion';
import { SonarrService } from './sonarr';
import { RadarrService } from './radarr';
import { resolveArrLink, withoutStaleLink } from './arrLink';
import {
  ARR_TYPES,
  PRIMARY_INSTANCE_ID,
  arrTypeForItem,
  getArrInstanceConfigs,
  getStoredAdditionalInstances,
  instanceIdForItem,
  type ArrInstanceConfig,
} from './arrInstances';
import { OverseerrService } from './overseerr';
import {
  createConfiguredMediaServer,
  getMediaServerLabel,
  type MediaServerService,
} from './mediaServer';
import { TautulliService } from './tautulli';
import { TracearrService } from './tracearr';
import mediaItemsRepo from '../db/repositories/mediaItems';
import rulesRepo from '../db/repositories/rules';
import settingsRepo from '../db/repositories/settings';
import historyRepo from '../db/repositories/historyRepo';
import storageSnapshotsRepo from '../db/repositories/storageSnapshots';
import { getNotificationService } from '../notifications';
import { setTaskDependencies } from '../scheduler/tasks';
import { getScheduler } from '../scheduler';
import type { MediaItem } from '../types';

// Service instances (singletons)
let overseerrService: OverseerrService | null = null;
let mediaServerService: MediaServerService | null = null;
let tautulliService: TautulliService | null = null;
let tracearrService: TracearrService | null = null;

/**
 * Get service credentials from database settings
 */
function getServiceConfig(serviceName: string): { url: string | null; apiKey: string | null } {
  const url = settingsRepo.getValue(`${serviceName}_url`);
  // Settings use camelCase: sonarr_apiKey, radarr_apiKey, etc.
  const apiKey = settingsRepo.getValue(`${serviceName}_apiKey`);
  return { url, apiKey };
}

/** A configured Sonarr/Radarr instance and its client. */
export interface ArrInstanceClient<T> {
  id: string;
  name: string;
  primary: boolean;
  client: T;
}

// Clients by instance id. Rebuilt when the instance's URL or key changes.
const arrClients = new Map<string, { url: string; apiKey: string; client: SonarrService | RadarrService }>();

function clientFor<T extends SonarrService | RadarrService>(
  instance: ArrInstanceConfig,
  create: (url: string, apiKey: string) => T
): T {
  const cached = arrClients.get(instance.id);
  if (cached && cached.url === instance.url && cached.apiKey === instance.apiKey) {
    return cached.client as T;
  }
  const client = create(instance.url, instance.apiKey);
  arrClients.set(instance.id, { url: instance.url, apiKey: instance.apiKey, client });
  logger.info(`${instance.name} (${instance.type}) service initialized`);
  return client;
}

/** Every configured, enabled Sonarr instance, primary first. */
export function getSonarrInstances(): ArrInstanceClient<SonarrService>[] {
  return getArrInstanceConfigs('sonarr').map((instance) => ({
    id: instance.id,
    name: instance.name,
    primary: instance.primary,
    client: clientFor(instance, (url, key) => new SonarrService(url, key)),
  }));
}

/** Every configured, enabled Radarr instance, primary first. */
export function getRadarrInstances(): ArrInstanceClient<RadarrService>[] {
  return getArrInstanceConfigs('radarr').map((instance) => ({
    id: instance.id,
    name: instance.name,
    primary: instance.primary,
    client: clientFor(instance, (url, key) => new RadarrService(url, key)),
  }));
}

/** The Sonarr client for one instance, or null when it isn't configured or is disabled. */
export function getSonarrClient(instanceId: string | null | undefined): SonarrService | null {
  if (!instanceId) return null;
  return getSonarrInstances().find((i) => i.id === instanceId)?.client ?? null;
}

/** The Radarr client for one instance, or null when it isn't configured or is disabled. */
export function getRadarrClient(instanceId: string | null | undefined): RadarrService | null {
  if (!instanceId) return null;
  return getRadarrInstances().find((i) => i.id === instanceId)?.client ?? null;
}

/**
 * The clients that manage this item: the Sonarr (for a show) or Radarr (for a
 * movie) instance its id belongs to. Null when it isn't linked, or its
 * instance is no longer configured.
 */
export function getArrClientsForItem(item: {
  type: string;
  sonarr_id?: number | null;
  radarr_id?: number | null;
  arr_instance?: string | null;
}): { sonarr: SonarrService | null; radarr: RadarrService | null; instanceId: string | null } {
  const instanceId = instanceIdForItem(item);
  if (!instanceId) return { sonarr: null, radarr: null, instanceId: null };
  return arrTypeForItem(item) === 'radarr'
    ? { sonarr: null, radarr: getRadarrClient(instanceId), instanceId }
    : { sonarr: getSonarrClient(instanceId), radarr: null, instanceId };
}

/**
 * Link an item to the Sonarr/Radarr instance that has it, when the last scan
 * didn't (or linked it to an instance that has since been removed). Searches
 * every configured instance in order and saves what it finds. Returns the item
 * with the link applied, or unchanged when nothing was found.
 */
export async function linkItemToArr<T extends Parameters<typeof resolveArrLink>[0]>(item: T): Promise<T> {
  const sonarrs = getSonarrInstances();
  const radarrs = getRadarrInstances();
  const configured = new Set([...sonarrs, ...radarrs].map((i) => i.id));
  const candidate = withoutStaleLink(item, configured, instanceIdForItem(item));

  const link = await resolveArrLink(candidate, {
    sonarr: sonarrs.map(({ id, client }) => ({
      instanceId: id,
      getSeriesByTvdbId: (tvdbId: number) => client.getSeriesByTvdbId(tvdbId),
      getSeriesByImdbId: (imdbId: string) => client.getSeriesByImdbId(imdbId),
      getSeriesByTmdbId: (tmdbId: number) => client.getSeriesByTmdbId(tmdbId),
    })),
    radarr: radarrs.map(({ id, client }) => ({
      instanceId: id,
      getMovieByTmdbId: (tmdbId: number) => client.getMovieByTmdbId(tmdbId),
      getMovieByImdbId: (imdbId: string) => client.getMovieByImdbId(imdbId),
    })),
  });
  if (!link) return item;

  const update = { arr_instance: null, ...link };
  try {
    mediaItemsRepo.update(item.id, update);
  } catch (error) {
    logger.warn(`Could not save Sonarr/Radarr link for "${item.title}"`, error);
  }
  return { ...candidate, ...update };
}

/**
 * The primary Sonarr instance, or the first configured one.
 *
 * For callers that only need "a" Sonarr (connection checks, whether Sonarr is
 * set up at all). Anything acting on an item must use getArrClientsForItem.
 */
export function getSonarrService(): SonarrService | null {
  return getSonarrInstances()[0]?.client ?? null;
}

/** The primary Radarr instance, or the first configured one. See getSonarrService. */
export function getRadarrService(): RadarrService | null {
  return getRadarrInstances()[0]?.client ?? null;
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
 * Get or create the configured media server instance (Plex, Jellyfin or Emby).
 *
 * This is the accessor new code should use. It reads `media_server_type` and
 * builds the matching client, so callers never branch on the backend.
 */
export function getMediaServerService(): MediaServerService | null {
  if (!mediaServerService) {
    mediaServerService = createConfiguredMediaServer();
    if (mediaServerService) {
      logger.info(`${getMediaServerLabel(mediaServerService.serverType)} service initialized`);
    }
  }
  return mediaServerService;
}

/**
 * Get the configured media server.
 *
 * @deprecated Use `getMediaServerService()`. Kept because a lot of existing
 * call sites reference it by this name; it no longer returns only Plex.
 */
export function getPlexService(): MediaServerService | null {
  return getMediaServerService();
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
 * Get or create Tracearr service instance
 */
export function getTracearrService(): TracearrService | null {
  if (!tracearrService) {
    const { url, apiKey } = getServiceConfig('tracearr');
    if (url && apiKey) {
      tracearrService = new TracearrService(url, apiKey);
      logger.info('Tracearr service initialized');
    }
  }
  return tracearrService;
}

/**
 * Clear cached service instances (call when settings change)
 */
export function refreshServices(): void {
  arrClients.clear();
  overseerrService = null;
  mediaServerService = null;
  tautulliService = null;
  tracearrService = null;
  logger.info('Service instances cleared, will reinitialize on next access');
}

function sonarrDeletionAdapter(sonarr: SonarrService): SonarrDeletionService {
  return {
    unmonitorSeries: (seriesId) => sonarr.unmonitorSeries(seriesId),
    deleteEpisodeFile: (episodeFileId) => sonarr.deleteEpisodeFile(episodeFileId),
    deleteAllEpisodeFiles: (seriesId) => sonarr.deleteAllEpisodeFiles(seriesId),
    removeSeries: (seriesId, deleteFiles) => sonarr.removeSeries(seriesId, deleteFiles),
    getSeriesByTvdbId: (tvdbId) => sonarr.getSeriesByTvdbId(tvdbId),
    getSeriesByImdbId: (imdbId) => sonarr.getSeriesByImdbId(imdbId),
    getSeriesByTmdbId: (tmdbId) => sonarr.getSeriesByTmdbId(tmdbId),
  };
}

function radarrDeletionAdapter(radarr: RadarrService): RadarrDeletionService {
  return {
    unmonitorMovie: (movieId) => radarr.unmonitorMovie(movieId),
    deleteMovieFile: (movieFileId) => radarr.deleteMovieFile(movieFileId),
    deleteMovieFilesByMovieId: (movieId) => radarr.deleteMovieFilesByMovieId(movieId),
    removeMovie: (movieId, deleteFiles) => radarr.removeMovie(movieId, deleteFiles),
    getMovieByTmdbId: (tmdbId) => radarr.getMovieByTmdbId(tmdbId),
    getMovieByImdbId: (imdbId) => radarr.getMovieByImdbId(imdbId),
  };
}

/**
 * Initialize all services and wire up dependencies
 */
export async function initializeServices(): Promise<void> {
  logger.info('Initializing services...');

  // Drop links to Sonarr/Radarr instances that have been removed (settings
  // saved, or a settings file imported), so nothing acts through them.
  try {
    mediaItemsRepo.clearUnknownArrInstanceLinks([
      ...ARR_TYPES.map((type) => PRIMARY_INSTANCE_ID[type]),
      ...ARR_TYPES.flatMap((type) => getStoredAdditionalInstances(type).map((i) => i.id)),
    ]);
  } catch (error) {
    logger.warn('Could not unlink items from removed Sonarr/Radarr instances', error);
  }

  // Initialize service instances based on config
  const sonarr = getSonarrService();
  const radarr = getRadarrService();
  const overseerr = getOverseerrService();

  // Initialize notification service early so it can be wired to both deletion service and scheduler
  const notificationService = getNotificationService();

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
        return mediaItemsRepo.fetchAll({ status: status as any }) as MediaItem[];
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

    // Every Sonarr/Radarr instance; each item goes to the one it belongs to.
    arrInstances: () => ({
      sonarr: getSonarrInstances().map(({ id, client }) => ({ id, service: sonarrDeletionAdapter(client) })),
      radarr: getRadarrInstances().map(({ id, client }) => ({ id, service: radarrDeletionAdapter(client) })),
    }),

    // Primary instances, for anything that has no per-item instance.
    sonarrService: sonarr ? sonarrDeletionAdapter(sonarr) : undefined,
    radarrService: radarr ? radarrDeletionAdapter(radarr) : undefined,

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

    // Notification service
    notificationService: {
      async notify(event: string, data: Record<string, unknown>): Promise<void> {
        await notificationService.notify(event as any, data);
      },
    },

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

  });

  // Wire notification service to scheduler tasks
  setTaskDependencies({
    notificationService: {
      async notify(event: string, data: Record<string, unknown>): Promise<void> {
        await notificationService.notify(event as any, data);
      },
    },
  });
  logger.info('Notification service wired to scheduler tasks');

  // Initialize scheduler with saved settings from database
  initializeSchedulerFromSettings();

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

  // Capture initial storage snapshot if none exists for today
  try {
    if (!storageSnapshotsRepo.hasTodaySnapshot()) {
      storageSnapshotsRepo.capture();
      logger.info('Initial storage snapshot captured');
    }
  } catch (snapshotError) {
    logger.warn('Failed to capture initial storage snapshot:', snapshotError);
  }

  logger.info('Services initialized successfully');
}

/**
 * Initialize the scheduler with saved settings from the database
 * This ensures the schedule persists across server restarts
 */
function initializeSchedulerFromSettings(): void {
  try {
    const scheduler = getScheduler();

    // Read schedule settings from database
    const enabled = settingsRepo.getValue('schedule_enabled');
    const autoProcess = settingsRepo.getValue('schedule_autoProcess');
    const interval = settingsRepo.getValue('schedule_interval') || 'daily';
    const time = settingsRepo.getValue('schedule_time') || '03:00';
    const dayOfWeek = settingsRepo.getValue('schedule_dayOfWeek');

    // Build cron expression from saved settings
    const [hour, minute] = time.split(':').map(Number);

    let cronExpression: string;
    switch (interval) {
      case 'hourly':
        cronExpression = `${minute} * * * *`;
        break;
      case 'weekly':
        // dayOfWeek: 0 = Sunday, 1 = Monday, etc.
        cronExpression = `${minute} ${hour} * * ${dayOfWeek ?? 0}`;
        break;
      case 'daily':
      default:
        cronExpression = `${minute} ${hour} * * *`;
        break;
    }

    // Handle scanLibraries task
    if (enabled === 'false') {
      scheduler.disableTask('scanLibraries');
      logger.info('Scheduled scanning is disabled (per saved settings)');
    } else {
      scheduler.updateSchedule('scanLibraries', cronExpression);
      if (enabled === 'true') {
        scheduler.enableTask('scanLibraries');
      }
      logger.info(`Scheduler initialized from saved settings: ${interval} at ${time} (cron: ${cronExpression})`);
    }

    // Handle processDeletionQueue task
    if (autoProcess === 'false') {
      scheduler.disableTask('processDeletionQueue');
      logger.info('Auto-process deletion queue is disabled (per saved settings)');
    } else if (autoProcess === 'true') {
      scheduler.enableTask('processDeletionQueue');
      logger.info('Auto-process deletion queue is enabled (per saved settings)');
    }

    // Handle syncPlexLibrary task — hydrate from plexSync_* settings so the
    // schedule survives restarts. Missing settings fall through to the default
    // ('0 2 * * *' from DEFAULT_CONFIG), which leaves the task running daily
    // at 2 AM as designed.
    const psEnabled = settingsRepo.getValue('plexSync_enabled');
    const psInterval = settingsRepo.getValue('plexSync_interval');
    const psTime = settingsRepo.getValue('plexSync_time');
    const psDayOfWeek = settingsRepo.getValue('plexSync_dayOfWeek');

    if (psEnabled === 'false') {
      scheduler.disableTask('syncPlexLibrary');
      logger.info('Scheduled Plex library sync is disabled (per saved settings)');
    } else if (psInterval || psTime || psDayOfWeek) {
      // Only rebuild the cron expression if the user has saved something —
      // otherwise the DEFAULT_CONFIG schedule applies.
      const effInterval = psInterval || 'daily';
      const effTime = psTime || '02:00';
      const [psHour, psMinute] = effTime.split(':').map(Number);

      let psCron: string;
      switch (effInterval) {
        case 'hourly':
          psCron = `${psMinute} * * * *`;
          break;
        case 'weekly':
          psCron = `${psMinute} ${psHour} * * ${psDayOfWeek ?? 0}`;
          break;
        case 'daily':
        default:
          psCron = `${psMinute} ${psHour} * * *`;
          break;
      }

      scheduler.updateSchedule('syncPlexLibrary', psCron);
      if (psEnabled === 'true') {
        scheduler.enableTask('syncPlexLibrary');
      }
      logger.info(`Plex sync schedule initialized from settings: ${effInterval} at ${effTime} (cron: ${psCron})`);
    }

    // Hydrate the disk-pressure monitor schedule/enabled state from settings.
    applyDiskPressureSchedule();
  } catch (error) {
    logger.error('Failed to initialize scheduler from settings:', error);
    // Fall back to default schedule - don't fail startup
  }
}

/**
 * Apply the disk-pressure monitor's enabled state and interval from settings.
 * Called at startup and whenever disk-pressure settings are saved, so the
 * schedule survives restarts and reacts to config changes without a restart.
 */
export function applyDiskPressureSchedule(): void {
  const scheduler = getScheduler();
  const enabled = settingsRepo.getBoolean('diskPressure_enabled', false);

  if (!enabled) {
    scheduler.disableTask('monitorDiskPressure');
    logger.info('Disk-pressure monitor disabled (per settings)');
    return;
  }

  // Clamp the interval to a sane minute-step cron (1–59 minutes).
  const intervalMinutes = Math.min(59, Math.max(1, settingsRepo.getNumber('diskPressure_intervalMinutes', 20)));
  const cronExpression = `*/${intervalMinutes} * * * *`;
  scheduler.updateSchedule('monitorDiskPressure', cronExpression);
  scheduler.enableTask('monitorDiskPressure');
  logger.info(`Disk-pressure monitor scheduled every ${intervalMinutes} min (cron: ${cronExpression})`);
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

  // True only when every configured instance answers.
  for (const [app, instances] of [
    ['sonarr', getSonarrInstances()],
    ['radarr', getRadarrInstances()],
  ] as const) {
    if (instances.length === 0) continue;
    let allUp = true;
    for (const instance of instances) {
      try {
        if (!(await instance.client.testConnection())) allUp = false;
      } catch (error) {
        allUp = false;
        logger.error(`${instance.name} connection test failed:`, error);
      }
    }
    results[app] = allUp;
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
  getSonarrInstances,
  getRadarrInstances,
  getArrClientsForItem,
  getOverseerrService,
  getMediaServerService,
  getPlexService,
  getTautulliService,
  getTracearrService,
};
