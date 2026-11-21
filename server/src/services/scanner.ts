import logger from '../utils/logger';
import { decodeHtmlEntities } from '../utils/text';
import config from '../config';
import settingsRepo from '../db/repositories/settings';
import {
  createMediaServer,
  createMediaServerUsers,
  getMediaServerCredentials,
  getMediaServerLabel,
  type MediaServerService,
} from './mediaServer';
import { MediaServerHistoryService } from './mediaServerHistory';
import { TautulliService } from './tautulli';
import { TracearrService } from './tracearr';
import { SonarrService } from './sonarr';
import { summariseEpisodeFiles, type MediaSummary } from './mediaSummary';
import { RadarrService, syncRadarrCollections } from './radarr';
import { getArrInstanceConfigs, PRIMARY_INSTANCE_ID, type ArrType } from './arrInstances';
import { OverseerrService, type RequesterIndex } from './overseerr';
import type { WatchHistoryProvider, WatchedStatus } from './watchHistory';
import type {
  PlexMediaItem,
  PlexLibrary,
  TautulliWatchedStatus,
  SonarrSeries,
  RadarrMovie,
  ScanResult,
  ScanError,
  MatchedArrData,
  SyncedMediaData,
  SyncProgressCallback,
} from './types';
import { syncMediaServerUsers } from './mediaServerUsers';
import type { MediaItem, CreateMediaItemInput, MediaType } from '../types';

// GUID parsing patterns
const GUID_PATTERNS = {
  imdb: /imdb:\/\/(tt\d+)/,
  // `tmdb://` (current Plex agents, Jellyfin/Emby) and
  // `com.plexapp.agents.themoviedb://` (legacy Plex TMDB agent).
  tmdb: /(?:tmdb|themoviedb):\/\/(\d+)/,
  tvdb: /tvdb:\/\/(\d+)/,
  thetvdb: /thetvdb:\/\/(\d+)/,
  plex: /plex:\/\/(?:movie|show|episode)\/([a-f0-9]+)/,
};

interface ScannerArrInstance<T> {
  id: string;
  name: string;
  client: T;
}

interface ParsedGuids {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
  plexGuid?: string;
}

export class ScannerService {
  private plex: MediaServerService | null = null;
  private watchHistoryProvider: WatchHistoryProvider | null = null;
  /** Primary (or first) instance of each, for callers that need just one. */
  private sonarr: SonarrService | null = null;
  private radarr: RadarrService | null = null;
  /** Every configured instance, primary first. Matching tries them in order. */
  private sonarrInstances: ScannerArrInstance<SonarrService>[] = [];
  private radarrInstances: ScannerArrInstance<RadarrService>[] = [];
  private overseerr: OverseerrService | null = null;

  // Caches to reduce API calls during scan
  private sonarrTvdbIndex: Map<number, SonarrSeries> = new Map();
  private sonarrImdbIndex: Map<string, SonarrSeries> = new Map();
  private radarrTmdbIndex: Map<number, RadarrMovie> = new Map();
  private radarrImdbIndex: Map<string, RadarrMovie> = new Map();
  /** Tag id → label, per instance: tag ids are only unique within one. */
  private arrTagMaps: Map<string, Map<number, string>> = new Map();
  /** Which instance each cached series/movie came from. */
  private arrInstanceOf: WeakMap<object, string> = new WeakMap();
  /**
   * For a title in more than one instance: every copy, keyed by the one the
   * lookup tables hold. A media server shows each copy as its own item, and
   * the file path says which copy an item is.
   */
  private arrCopies: WeakMap<object, Array<{ path?: string }>> = new WeakMap();
  /** Instances whose full series/movie list was read this scan. */
  private readArrInstances: Set<string> = new Set();

  // Database callback - to be injected
  private dbCallback: ((items: SyncedMediaData[]) => Promise<void>) | null = null;

  // Prune callback - to be injected. Removes DB rows for a library whose Plex
  // item no longer exists (e.g. Radarr upgrades that get a new ratingKey).
  private pruneCallback: ((libraryKey: string, seenPlexIds: string[]) => Promise<number>) | null = null;

  // Seerr requesters for this sync, or null when Seerr isn't configured or its
  // request list couldn't be read (requested_by is then left untouched).
  private requesterIndex: RequesterIndex | null = null;

  constructor() {
    this.initializeServices();
  }

  /**
   * Initialize service connections based on configuration
   * Reads from database settings first, falls back to environment variables
   */
  private initializeServices(): void {
    // Get settings from database (with env var fallback)
    const mediaServerCreds = getMediaServerCredentials();
    const tautulliUrl = settingsRepo.getValue('tautulli_url') || config.tautulli.url;
    const tautulliApiKey = settingsRepo.getValue('tautulli_apiKey') || config.tautulli.apiKey;
    const overseerrUrl = settingsRepo.getValue('overseerr_url') || config.overseerr.url;
    const overseerrApiKey = settingsRepo.getValue('overseerr_apiKey') || config.overseerr.apiKey;

    // Initialize the media server (Plex, Jellyfin or Emby)
    const mediaServerLabel = getMediaServerLabel();
    if (mediaServerCreds) {
      this.plex = createMediaServer(
        mediaServerCreds.type,
        mediaServerCreds.url,
        mediaServerCreds.credential
      );
      logger.info(`${mediaServerLabel} service initialized`, { url: mediaServerCreds.url });
    } else {
      logger.warn(`${mediaServerLabel} service not configured - missing URL or credential`);
    }

    // Initialize Watch History Provider (media server direct, Tracearr, or Tautulli — only one)
    const tracearrUrl = settingsRepo.getValue('tracearr_url');
    const tracearrApiKey = settingsRepo.getValue('tracearr_apiKey');
    // Installs that never picked a provider get the one the settings page
    // infers, else the media server's own history. Ending up with none leaves
    // everything unwatched, and never watched is exactly what rules delete.
    const watchHistoryProvider =
      settingsRepo.getValue('watch_history_provider') ||
      (tracearrUrl && tracearrApiKey ? 'tracearr' : tautulliUrl && tautulliApiKey ? 'tautulli' : 'mediaServer');

    // 'plex' is the historical setting value for "read history from the media
    // server itself"; it now means whichever server is configured.
    if (
      (watchHistoryProvider === 'plex' || watchHistoryProvider === 'mediaServer') &&
      this.plex &&
      mediaServerCreds
    ) {
      const usersService = createMediaServerUsers(
        this.plex,
        mediaServerCreds.url,
        mediaServerCreds.credential
      );
      this.watchHistoryProvider = new MediaServerHistoryService(this.plex, usersService);
      logger.info(`${mediaServerLabel} direct history service initialized as watch history provider`);
    } else if (watchHistoryProvider === 'tracearr' && tracearrUrl && tracearrApiKey) {
      this.watchHistoryProvider = new TracearrService(tracearrUrl, tracearrApiKey);
      logger.info('Tracearr service initialized as watch history provider', { url: tracearrUrl });
    } else if (watchHistoryProvider === 'tautulli' && tautulliUrl && tautulliApiKey) {
      this.watchHistoryProvider = new TautulliService(tautulliUrl, tautulliApiKey);
      logger.info('Tautulli service initialized as watch history provider', { url: tautulliUrl });
    } else if (tautulliUrl && tautulliApiKey) {
      this.watchHistoryProvider = new TautulliService(tautulliUrl, tautulliApiKey);
      logger.info('Tautulli service initialized as watch history provider (fallback)', { url: tautulliUrl });
    } else {
      logger.warn('No watch history provider configured - missing URL or API key');
    }

    // Initialize every Sonarr and Radarr instance
    this.sonarrInstances = getArrInstanceConfigs('sonarr').map((i) => ({
      id: i.id,
      name: i.name,
      client: new SonarrService(i.url, i.apiKey),
    }));
    this.radarrInstances = getArrInstanceConfigs('radarr').map((i) => ({
      id: i.id,
      name: i.name,
      client: new RadarrService(i.url, i.apiKey),
    }));
    this.sonarr = this.sonarrInstances[0]?.client ?? null;
    this.radarr = this.radarrInstances[0]?.client ?? null;
    for (const [app, list] of [['Sonarr', this.sonarrInstances], ['Radarr', this.radarrInstances]] as const) {
      if (list.length === 0) {
        logger.warn(`${app} service not configured - missing URL or API key`);
      } else {
        logger.info(`${app} service initialized: ${list.map((i) => i.name).join(', ')}`);
      }
    }

    // Initialize Overseerr
    if (overseerrUrl && overseerrApiKey) {
      this.overseerr = new OverseerrService(overseerrUrl, overseerrApiKey);
      logger.info('Overseerr service initialized', { url: overseerrUrl });
    } else {
      logger.info('Overseerr service not configured (optional)');
    }
  }

  /**
   * Reinitialize services (useful when settings change)
   */
  reinitialize(): void {
    // Keep the watch history provider if it exists — its cache is expensive to rebuild
    const existingProvider = this.watchHistoryProvider;
    this.plex = null;
    this.watchHistoryProvider = null;
    this.sonarr = null;
    this.radarr = null;
    this.sonarrInstances = [];
    this.radarrInstances = [];
    this.overseerr = null;
    this.clearCaches();
    this.initializeServices();

    // Restore the existing provider if the new one is the same type (avoids cache rebuild)
    if (existingProvider && this.watchHistoryProvider) {
      const oldType = (existingProvider as any).constructor?.name;
      const newType = (this.watchHistoryProvider as any).constructor?.name;
      if (oldType && oldType === newType) {
        this.watchHistoryProvider = existingProvider;
      }
    }
  }

  /**
   * Set the database callback for persisting scanned items
   */
  setDatabaseCallback(callback: (items: SyncedMediaData[]) => Promise<void>): void {
    this.dbCallback = callback;
  }

  /**
   * Set the callback for pruning stale items (present in the DB but no longer
   * in Plex) after a library is successfully scanned.
   */
  setPruneCallback(callback: (libraryKey: string, seenPlexIds: string[]) => Promise<number>): void {
    this.pruneCallback = callback;
  }

  /**
   * Test all configured service connections
   */
  async testConnections(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    if (this.plex) {
      results['plex'] = await this.plex.testConnection();
    }

    if (this.watchHistoryProvider) {
      results['watchHistory'] = await this.watchHistoryProvider.testConnection();
    }

    for (const instance of [...this.sonarrInstances, ...this.radarrInstances]) {
      results[instance.id] = await instance.client.testConnection();
    }

    if (this.overseerr) {
      results['overseerr'] = await this.overseerr.testConnection();
    }

    return results;
  }

  /**
   * Full library scan - fetches all data from all services
   */
  async scanAll(onProgress?: SyncProgressCallback): Promise<ScanResult> {
    const startedAt = new Date();
    const errors: ScanError[] = [];
    let itemsScanned = 0;
    let itemsAdded = 0;
    let itemsUpdated = 0;
    let itemsRemoved = 0;
    let itemsFlagged = 0;

    logger.info('Starting full library scan');
    onProgress?.({ stage: 'initializing', message: 'Initializing services...' });

    try {
      // Build caches first for efficient matching
      onProgress?.({ stage: 'building_cache', message: 'Building service caches...' });
      await this.buildCaches(onProgress);
      onProgress?.({ stage: 'building_cache', message: 'Caches ready, scanning libraries...' });

      // Get Plex libraries
      if (!this.plex) {
        throw new Error('Plex service not configured');
      }

      const libraries = await this.plex.getLibraries();

      // Filter to media libraries and exclude user-configured libraries
      const excludedKeysRaw = settingsRepo.getValue('excluded_library_keys');
      let excludedKeys: string[] = [];
      try {
        excludedKeys = excludedKeysRaw ? JSON.parse(excludedKeysRaw) : [];
      } catch {
        logger.warn('Failed to parse excluded_library_keys setting, ignoring');
      }

      const mediaLibraries = libraries.filter(
        (lib) => (lib.type === 'movie' || lib.type === 'show') && !excludedKeys.includes(lib.key)
      );

      if (excludedKeys.length > 0) {
        const excluded = libraries.filter((lib) => excludedKeys.includes(lib.key));
        if (excluded.length > 0) {
          logger.info(`Excluding ${excluded.length} libraries: ${excluded.map((l) => l.title).join(', ')}`);
        }
      }

      logger.info(`Found ${mediaLibraries.length} media libraries to scan`);
      logger.info(
        this.overseerr
          ? this.requesterIndex
            ? `Seerr connected — ${this.requesterIndex.requestCount} request(s) loaded for "Requested by"`
            : 'Seerr request list unavailable — "Requested by" will be left as it was this scan'
          : 'Seerr not configured — "Requested by" data will not be collected this scan'
      );
      onProgress?.({
        stage: 'scanning_library',
        message: `Found ${mediaLibraries.length} libraries to scan`,
        libraryProgress: { current: 0, total: mediaLibraries.length, libraryName: '' },
      });

      // Process each library
      for (let libIdx = 0; libIdx < mediaLibraries.length; libIdx++) {
        const library = mediaLibraries[libIdx]!;
        try {
          const result = await this.scanLibrary(library, (itemScanned, itemTotal, itemTitle) => {
            onProgress?.({
              stage: 'processing_items',
              message: `Scanning "${library.title}"`,
              libraryProgress: { current: libIdx + 1, total: mediaLibraries.length, libraryName: library.title },
              itemProgress: { scanned: itemScanned, total: itemTotal, currentItem: itemTitle },
            });
          });
          itemsScanned += result.itemsScanned;
          itemsAdded += result.itemsAdded;
          itemsUpdated += result.itemsUpdated;
          itemsRemoved += result.itemsRemoved;
          itemsFlagged += result.itemsFlagged;
          errors.push(...result.errors);

          onProgress?.({
            stage: 'scanning_library',
            message: `Completed "${library.title}" — ${result.itemsScanned} items`,
            libraryProgress: { current: libIdx + 1, total: mediaLibraries.length, libraryName: library.title },
          });
        } catch (error) {
          errors.push({
            message: `Failed to scan library ${library.title}: ${(error as Error).message}`,
            service: 'plex',
            stack: (error as Error).stack,
          });
          onProgress?.({
            stage: 'error',
            message: `Error scanning "${library.title}": ${(error as Error).message}`,
            libraryProgress: { current: libIdx + 1, total: mediaLibraries.length, libraryName: library.title },
          });
        }
      }

      logger.info('Full library scan completed', {
        itemsScanned,
        itemsAdded,
        itemsUpdated,
        itemsRemoved,
        itemsFlagged,
        errors: errors.length,
      });

      // Post-scan hook: sync Radarr collections (non-fatal on failure)
      if (this.radarrInstances.length > 0) {
        try {
          onProgress?.({ stage: 'processing_items', message: 'Syncing Radarr collections...' });
          const collectionsResult = await syncRadarrCollections(this.radarrInstances.map((i) => i.client));
          logger.info('Post-scan collections sync completed', collectionsResult);
        } catch (collectionsError) {
          logger.warn('Post-scan collections sync failed (non-fatal):', collectionsError);
        }
      }

      // Post-scan hook: sync media server users (non-fatal on failure)
      {
        const creds = getMediaServerCredentials();
        const label = getMediaServerLabel();
        if (creds && this.plex) {
          try {
            onProgress?.({ stage: 'processing_items', message: `Syncing ${label} users...` });
            const usersService = createMediaServerUsers(this.plex, creds.url, creds.credential);
            const syncedUsers = await syncMediaServerUsers(usersService, label);
            logger.info(`Post-scan ${label} users sync completed: ${syncedUsers.length} users`);
          } catch (usersError) {
            logger.warn(`Post-scan ${label} users sync failed (non-fatal):`, usersError);
          }
        }
      }

      onProgress?.({
        stage: 'complete',
        message: `Sync complete — ${itemsScanned} items scanned`,
        result: { success: true, itemsScanned, itemsAdded, itemsUpdated, errors: errors.length },
      });
    } catch (error) {
      errors.push({
        message: `Scan failed: ${(error as Error).message}`,
        service: 'plex',
        stack: (error as Error).stack,
      });

      onProgress?.({
        stage: 'error',
        message: `Scan failed: ${(error as Error).message}`,
        result: { success: false, itemsScanned, itemsAdded, itemsUpdated, errors: errors.length },
      });
    }

    // Clear caches after scan
    this.clearCaches();

    return {
      success: errors.length === 0,
      startedAt,
      completedAt: new Date(),
      itemsScanned,
      itemsAdded,
      itemsUpdated,
      itemsRemoved,
      itemsFlagged,
      errors,
    };
  }

  /**
   * Scan a single library
   */
  private async scanLibrary(
    library: PlexLibrary,
    onItemProgress?: (scanned: number, total: number, title: string) => void,
  ): Promise<{
    itemsScanned: number;
    itemsAdded: number;
    itemsUpdated: number;
    itemsRemoved: number;
    itemsFlagged: number;
    errors: ScanError[];
  }> {
    const errors: ScanError[] = [];
    let itemsScanned = 0;
    let itemsAdded = 0;
    let itemsUpdated = 0;
    let itemsRemoved = 0;
    let itemsFlagged = 0;

    logger.info(`Scanning library: ${library.title} (${library.type})`);

    if (!this.plex) {
      throw new Error('Plex service not available');
    }

    const items = await this.plex.getLibraryItems(library.key);
    const syncedItems: SyncedMediaData[] = [];

    // Process items in batches to avoid overwhelming APIs
    const batchSize = 50;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      for (const item of batch) {
        try {
          const syncedData = await this.processPlexItem(item, library.type);
          if (syncedData) {
            syncedItems.push({ ...syncedData, libraryKey: library.key });
            itemsScanned++;
            onItemProgress?.(itemsScanned, items.length, item.title);
          }
        } catch (error) {
          errors.push({
            message: `Failed to process item: ${(error as Error).message}`,
            service: 'plex',
            itemTitle: item.title,
            stack: (error as Error).stack,
          });
        }
      }

      // Small delay between batches to be nice to APIs
      if (i + batchSize < items.length) {
        await this.delay(100);
      }
    }

    // Persist to database if callback is set
    let persistSucceeded = false;
    if (this.dbCallback && syncedItems.length > 0) {
      try {
        await this.dbCallback(syncedItems);
        itemsAdded = syncedItems.length; // Simplified - actual implementation would track adds vs updates
        persistSucceeded = true;
      } catch (error) {
        errors.push({
          message: `Failed to persist items: ${(error as Error).message}`,
          service: 'database',
          stack: (error as Error).stack,
        });
      }
    }

    // Prune stale rows: DB items tagged with this library whose Plex item no
    // longer exists (e.g. a Radarr upgrade that landed on a new ratingKey, or
    // content removed from Plex). The seen set is built from the raw Plex
    // listing so items that merely failed per-item processing are never pruned.
    // Only run when the library returned items and persistence succeeded, so a
    // transient Plex/DB hiccup can't wipe the library.
    if (this.pruneCallback && persistSucceeded && items.length > 0) {
      try {
        const seenPlexIds = items.map((item) => item.ratingKey).filter((k): k is string => Boolean(k));
        itemsRemoved = await this.pruneCallback(library.key, seenPlexIds);
      } catch (error) {
        errors.push({
          message: `Failed to prune stale items: ${(error as Error).message}`,
          service: 'database',
          stack: (error as Error).stack,
        });
      }
    }

    if (this.requesterIndex) {
      const arrMatched = syncedItems.filter((s) => s.arrData).length;
      const requesters = syncedItems
        .map((s) => s.overseerrData?.requestedBy)
        .filter((r): r is string => Boolean(r));
      const distinctRequesters = new Set(requesters);
      logger.info(
        `Seerr requesters in "${library.title}": ${requesters.length} of ${itemsScanned} items ` +
          `have a requester across ${distinctRequesters.size} user(s); ` +
          `${arrMatched} of ${itemsScanned} matched to Sonarr/Radarr`
      );
    }

    logger.info(`Completed scanning library: ${library.title}`, {
      itemsScanned,
      itemsRemoved,
      errors: errors.length,
    });

    return { itemsScanned, itemsAdded, itemsUpdated, itemsRemoved, itemsFlagged, errors };
  }

  /**
   * Process a single Plex item and gather data from all services
   */
  private async processPlexItem(
    plexItem: PlexMediaItem,
    libraryType: string
  ): Promise<SyncedMediaData | null> {
    // Get detailed metadata if needed
    let fullItem = plexItem;
    if (!plexItem.guids || plexItem.guids.length === 0) {
      try {
        if (this.plex) {
          fullItem = await this.plex.getItemMetadata(plexItem.ratingKey);
        }
      } catch {
        // Use basic item if metadata fetch fails
      }
    }

    // Get watch history data from configured provider (Tautulli or Tracearr)
    // For TV shows, use getShowWatchedStatus which aggregates all episode watches.
    // For movies, use getItemWatchedStatus.
    let tautulliData: TautulliWatchedStatus | undefined;
    if (this.watchHistoryProvider) {
      try {
        let watchData: WatchedStatus;
        if (libraryType === 'show') {
          // Plex XML leaves numeric entities encoded (an apostrophe arrives as
          // &#39;), while history providers store plain titles. Decode before
          // the lookup, or the show's imported plays never match.
          watchData = await this.watchHistoryProvider.getShowWatchedStatus(
            fullItem.ratingKey,
            decodeHtmlEntities(fullItem.title)
          );
        } else {
          watchData = await this.watchHistoryProvider.getItemWatchedStatus(fullItem.ratingKey);
        }
        // Map WatchedStatus to TautulliWatchedStatus (same shape). The
        // episode fields must come along: without them a show's episode
        // count and per-person progress never reach the database.
        tautulliData = {
          playCount: watchData.playCount,
          lastWatched: watchData.lastWatched,
          watchedBy: watchData.watchedBy,
          episodesWatched: watchData.episodesWatched,
          episodeProgress: watchData.episodeProgress,
        };
      } catch {
        // Continue without watch history data
      }
    }

    // Match to Sonarr/Radarr
    const arrData = await this.matchPlexToArr(fullItem, libraryType);

    // Requester comes from the request list fetched once per sync. Matching
    // isn't limited to Sonarr/Radarr hits or to a TMDB id from the media
    // server: legacy Plex agents only carry an IMDb or TVDB id.
    const overseerrData = this.requesterIndex
      ? { requestedBy: this.lookupRequester(fullItem, libraryType, arrData), request: null }
      : undefined;

    return {
      plexItem: fullItem,
      tautulliData,
      arrData,
      overseerrData,
    };
  }

  /**
   * Sync a single media item (for incremental updates)
   */
  async syncMediaItem(
    plexItem: PlexMediaItem,
    tautulliData?: TautulliWatchedStatus,
    arrData?: MatchedArrData
  ): Promise<void> {
    const syncedData: SyncedMediaData = {
      plexItem,
      tautulliData,
      arrData,
    };

    if (this.dbCallback) {
      await this.dbCallback([syncedData]);
    }
  }

  /**
   * Match a Plex item to Sonarr or Radarr entry
   */
  async matchPlexToArr(
    plexItem: PlexMediaItem,
    libraryType?: string
  ): Promise<MatchedArrData | undefined> {
    const guids = this.parseGuids(plexItem);
    const type = libraryType || plexItem.type;

    // For movies, match to Radarr
    if (type === 'movie') {
      let radarrMovie: RadarrMovie | undefined;

      // Try TMDB ID first (most reliable)
      if (guids.tmdbId && this.radarrTmdbIndex.has(guids.tmdbId)) {
        radarrMovie = this.radarrTmdbIndex.get(guids.tmdbId);
      }
      // Fall back to IMDB ID
      else if (guids.imdbId && this.radarrImdbIndex.has(guids.imdbId)) {
        radarrMovie = this.radarrImdbIndex.get(guids.imdbId);
      }

      if (radarrMovie) {
        // The same movie in two instances: pick the copy this file is.
        radarrMovie = this.pickCopyByPath(radarrMovie, plexItem.media?.[0]?.parts?.[0]?.file);
        return {
          radarrId: radarrMovie.id,
          radarrMovie,
          arrInstance: this.instanceOf(radarrMovie, 'radarr'),
        };
      }
    }

    // For shows, match to Sonarr
    if (type === 'show') {
      let sonarrSeries: SonarrSeries | undefined;

      // Try TVDB ID first (most reliable for TV)
      if (guids.tvdbId && this.sonarrTvdbIndex.has(guids.tvdbId)) {
        sonarrSeries = this.sonarrTvdbIndex.get(guids.tvdbId);
      }
      // Fall back to IMDB ID
      else if (guids.imdbId && this.sonarrImdbIndex.has(guids.imdbId)) {
        sonarrSeries = this.sonarrImdbIndex.get(guids.imdbId);
      }

      if (sonarrSeries) {
        const arrInstance = this.instanceOf(sonarrSeries, 'sonarr');
        const mediaSummary = await this.summariseSeriesFiles(sonarrSeries.id, arrInstance);
        return {
          sonarrId: sonarrSeries.id,
          sonarrSeries,
          arrInstance,
          ...(mediaSummary ? { mediaSummary } : {}),
        };
      }
    }

    return undefined;
  }

  /**
   * Roll a series' episode files up into one resolution/codec/bitrate.
   *
   * Costs one Sonarr call per show per scan. Sonarr has no bulk episode-file
   * endpoint, and the alternative — walking a show's episodes in Plex — is
   * several calls for the same answer. A failure is not worth failing a scan
   * over: the series simply keeps whatever it had.
   */
  private async summariseSeriesFiles(seriesId: number, instanceId: string): Promise<MediaSummary | undefined> {
    const sonarr = this.sonarrInstances.find((i) => i.id === instanceId)?.client ?? this.sonarr;
    if (!sonarr) return undefined;
    try {
      const files = await sonarr.getEpisodeFiles(seriesId);
      const summary = summariseEpisodeFiles(files);
      return Object.keys(summary).length > 0 ? summary : undefined;
    } catch (error) {
      logger.debug('Could not summarise episode files', { seriesId, error });
      return undefined;
    }
  }

  private recordCopy(first: object, copy: { path?: string }): void {
    const copies = this.arrCopies.get(first) ?? [first as { path?: string }];
    copies.push(copy);
    this.arrCopies.set(first, copies);
  }

  /**
   * Of a title's copies in several instances, the one whose folder holds this
   * file. Plex/Jellyfin and Sonarr/Radarr often mount the same disk at
   * different paths (`/data/movies4k` vs `/movies4k`), so folders are compared
   * from the end: the copy sharing the most trailing folder names wins. With
   * no file path, or a tie, the first instance's copy is kept.
   */
  private pickCopyByPath<T extends { path?: string }>(entry: T, filePath: string | undefined): T {
    const copies = this.arrCopies.get(entry) as T[] | undefined;
    if (!copies || !filePath) return entry;
    const segments = (p: string) => p.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
    const fileDir = segments(filePath).slice(0, -1);
    let best: T = entry;
    let bestScore = -1;
    let tie = false;
    for (const copy of copies) {
      if (!copy.path) continue;
      const folder = segments(copy.path);
      let score = 0;
      while (
        score < folder.length &&
        score < fileDir.length &&
        folder[folder.length - 1 - score] === fileDir[fileDir.length - 1 - score]
      ) {
        score++;
      }
      if (score > bestScore) {
        best = copy;
        bestScore = score;
        tie = false;
      } else if (score === bestScore) {
        tie = true;
      }
    }
    return bestScore > 0 && !tie ? best : entry;
  }

  /** The instance a cached series/movie came from (the primary when unknown). */
  private instanceOf(entry: object, type: ArrType): string {
    return this.arrInstanceOf.get(entry) ?? PRIMARY_INSTANCE_ID[type];
  }

  /**
   * Parse GUIDs from Plex item
   */
  private parseGuids(plexItem: PlexMediaItem): ParsedGuids {
    const result: ParsedGuids = {};

    // Parse main GUID
    if (plexItem.guid) {
      this.extractGuid(plexItem.guid, result);
    }

    // Parse additional GUIDs
    if (plexItem.guids) {
      for (const guid of plexItem.guids) {
        this.extractGuid(guid.id, result);
      }
    }

    return result;
  }

  /**
   * Extract ID from GUID string
   */
  private extractGuid(guidStr: string, result: ParsedGuids): void {
    for (const [key, pattern] of Object.entries(GUID_PATTERNS)) {
      const match = guidStr.match(pattern);
      if (match && match[1]) {
        switch (key) {
          case 'imdb':
            result.imdbId = match[1];
            break;
          case 'tmdb':
            result.tmdbId = parseInt(match[1], 10);
            break;
          case 'tvdb':
          case 'thetvdb':
            result.tvdbId = parseInt(match[1], 10);
            break;
          case 'plex':
            result.plexGuid = match[1];
            break;
        }
      }
    }
  }

  /**
   * Find who requested an item, trying every id the media server or the
   * matching Sonarr/Radarr entry gives us.
   */
  private lookupRequester(
    plexItem: PlexMediaItem,
    libraryType: string,
    arrData: MatchedArrData | undefined
  ): string | null {
    const index = this.requesterIndex;
    if (!index) return null;
    const guids = this.parseGuids(plexItem);

    if (libraryType === 'movie') {
      const movie = arrData?.radarrMovie;
      const tmdbIds = [guids.tmdbId, movie?.tmdbId];
      const imdbIds = [guids.imdbId, movie?.imdbId];
      for (const id of tmdbIds) if (id && index.movie.tmdb.has(id)) return index.movie.tmdb.get(id)!;
      for (const id of imdbIds) if (id && index.movie.imdb.has(id)) return index.movie.imdb.get(id)!;
      return null;
    }

    if (libraryType === 'show') {
      const series = arrData?.sonarrSeries;
      const tmdbIds = [guids.tmdbId, series?.tmdbId];
      const tvdbIds = [guids.tvdbId, series?.tvdbId];
      const imdbIds = [guids.imdbId, series?.imdbId];
      for (const id of tmdbIds) if (id && index.tv.tmdb.has(id)) return index.tv.tmdb.get(id)!;
      for (const id of tvdbIds) if (id && index.tv.tvdb.has(id)) return index.tv.tvdb.get(id)!;
      for (const id of imdbIds) if (id && index.tv.imdb.has(id)) return index.tv.imdb.get(id)!;
    }
    return null;
  }

  /**
   * Build caches from Sonarr and Radarr for efficient matching
   */
  private async buildCaches(onProgress?: SyncProgressCallback): Promise<void> {
    logger.info('Building service caches for matching');

    // Build Sonarr and Radarr caches. Instances are read in order and the
    // first to have a title keeps it: a title should only live in one, and
    // when it is in two the item can only be linked to one of them.
    for (const instance of this.sonarrInstances) {
      try {
        const series = await instance.client.getSeries();
        this.readArrInstances.add(instance.id);
        let duplicates = 0;
        for (const s of series) {
          this.arrInstanceOf.set(s, instance.id);
          const taken =
            (s.tvdbId ? this.sonarrTvdbIndex.get(s.tvdbId) : undefined) ??
            (s.imdbId ? this.sonarrImdbIndex.get(s.imdbId) : undefined);
          if (taken) {
            duplicates++;
            this.recordCopy(taken, s);
            logger.debug(`"${s.title}" is in more than one Sonarr instance (also ${instance.name})`);
            continue;
          }
          if (s.tvdbId) {
            this.sonarrTvdbIndex.set(s.tvdbId, s);
          }
          if (s.imdbId) {
            this.sonarrImdbIndex.set(s.imdbId, s);
          }
        }
        logger.info(`Cached ${series.length} series from ${instance.name}`);
        if (duplicates > 0) {
          logger.warn(
            `${duplicates} series in ${instance.name} are also in an earlier Sonarr instance; ` +
              'shows are linked to the earlier one'
          );
        }
      } catch (error) {
        logger.error(`Failed to cache ${instance.name} data`, { message: (error as Error).message });
      }
    }

    for (const instance of this.radarrInstances) {
      try {
        const movies = await instance.client.getMovies();
        this.readArrInstances.add(instance.id);
        let duplicates = 0;
        for (const m of movies) {
          this.arrInstanceOf.set(m, instance.id);
          const taken =
            (m.tmdbId ? this.radarrTmdbIndex.get(m.tmdbId) : undefined) ??
            (m.imdbId ? this.radarrImdbIndex.get(m.imdbId) : undefined);
          if (taken) {
            duplicates++;
            this.recordCopy(taken, m);
            logger.debug(`"${m.title}" is in more than one Radarr instance (also ${instance.name})`);
            continue;
          }
          if (m.tmdbId) {
            this.radarrTmdbIndex.set(m.tmdbId, m);
          }
          if (m.imdbId) {
            this.radarrImdbIndex.set(m.imdbId, m);
          }
        }
        logger.info(`Cached ${movies.length} movies from ${instance.name}`);
        if (duplicates > 0) {
          logger.warn(
            `${duplicates} movies in ${instance.name} are also in an earlier Radarr instance; ` +
              'each copy is linked by its file path where it can be told apart, else to the earlier one'
          );
        }
      } catch (error) {
        logger.error(`Failed to cache ${instance.name} data`, { message: (error as Error).message });
      }
    }

    // Load Seerr requests once, instead of one detail lookup per item
    if (this.overseerr) {
      try {
        this.requesterIndex = await this.overseerr.getRequesterIndex();
        logger.info(`Cached ${this.requesterIndex.requestCount} requests from Seerr`);
      } catch (error) {
        this.requesterIndex = null;
        logger.warn('Failed to load Seerr requests — "Requested by" will not be updated this sync', {
          message: (error as Error).message,
        });
      }
    }

    // Fetch tag ID-to-name mappings from every instance
    for (const instance of [...this.radarrInstances, ...this.sonarrInstances]) {
      try {
        this.arrTagMaps.set(instance.id, await instance.client.getTags());
      } catch (e) {
        logger.warn(`Failed to fetch ${instance.name} tags:`, e);
      }
    }

    // Pre-warm watch history provider cache (Tracearr needs to fetch all history up front)
    if (this.watchHistoryProvider && 'prewarm' in this.watchHistoryProvider) {
      try {
        await (this.watchHistoryProvider as any).prewarm((fetched: number, total: number) => {
          onProgress?.({
            stage: 'building_cache',
            message: `Loading watch history... ${fetched}/${total} sessions`,
          });
        });
        logger.info('Watch history provider cache ready');
      } catch {
        logger.warn('Failed to pre-warm watch history cache');
      }
    }
  }

  /**
   * Clear all caches
   */
  private clearCaches(): void {
    this.sonarrTvdbIndex.clear();
    this.sonarrImdbIndex.clear();
    this.radarrTmdbIndex.clear();
    this.radarrImdbIndex.clear();
    this.arrTagMaps.clear();
    this.arrInstanceOf = new WeakMap();
    this.arrCopies = new WeakMap();
    this.readArrInstances = new Set();
    this.requesterIndex = null;
    // Clear watch history provider cache if supported
    this.watchHistoryProvider?.clearCache?.();
    logger.debug('Cleared service caches');
  }

  /**
   * Convert synced data to database input format
   */
  convertToMediaItemInput(syncedData: SyncedMediaData): CreateMediaItemInput {
    const { plexItem, tautulliData, arrData, libraryKey, overseerrData } = syncedData;

    // Determine type
    let type: MediaType = 'movie';
    if (plexItem.type === 'show') {
      type = 'show';
    } else if (plexItem.type === 'episode') {
      type = 'episode';
    }

    // Parse GUIDs for external IDs
    const guids = this.parseGuids(plexItem);

    // Get file info from media
    let filePath: string | undefined;
    let fileSize: number | undefined;
    let resolution: string | undefined;
    let codec: string | undefined;
    let audioCodec: string | undefined;
    let videoCodec: string | undefined;
    let bitrate: number | undefined;

    if (plexItem.media && plexItem.media.length > 0) {
      const media = plexItem.media[0];
      if (media) {
        resolution = media.videoResolution;
        codec = media.videoCodec;
        audioCodec = media.audioCodec;
        videoCodec = media.videoCodec;
        if (media.bitrate && media.bitrate > 0) {
          // Plex reports bitrate in kbps; store as bits per second.
          bitrate = media.bitrate * 1000;
        }

        if (media.parts && media.parts.length > 0) {
          const firstPart = media.parts[0];
          if (firstPart) {
            filePath = firstPart.file;
          }
          fileSize = media.parts.reduce((total, part) => total + part.size, 0);
        }
      }
    }

    // Plex puts media info on episodes, not on the show, so a series arrives
    // with none of this. Sonarr's episode files fill it in.
    if (type === 'show' && arrData?.mediaSummary) {
      const summary = arrData.mediaSummary;
      resolution = resolution ?? summary.resolution;
      videoCodec = videoCodec ?? summary.videoCodec;
      codec = codec ?? summary.videoCodec;
      audioCodec = audioCodec ?? summary.audioCodec;
      bitrate = bitrate ?? summary.bitrate;
    }

    // Get size from Arr data if not available from Plex (important for TV shows!)
    if (!fileSize || fileSize === 0) {
      if (arrData?.radarrMovie?.sizeOnDisk) {
        fileSize = arrData.radarrMovie.sizeOnDisk;
      } else if (arrData?.sonarrSeries?.statistics?.sizeOnDisk) {
        fileSize = arrData.sonarrSeries.statistics.sizeOnDisk;
      }
    }

    // Build poster URL - prefer Sonarr/Radarr CDN URLs, then Plex
    let posterUrl: string | undefined;
    if (arrData?.radarrMovie?.images) {
      const poster = arrData.radarrMovie.images.find((i) => i.coverType === 'poster');
      posterUrl = poster?.remoteUrl || poster?.url;
    } else if (arrData?.sonarrSeries?.images) {
      const poster = arrData.sonarrSeries.images.find((i) => i.coverType === 'poster');
      posterUrl = poster?.remoteUrl || poster?.url;
    }
    // Fall back to Plex thumb, converting relative path to full URL (now includes auth token)
    if (!posterUrl && plexItem.thumb) {
      posterUrl = this.plex?.getImageUrl(plexItem.thumb) || plexItem.thumb;
    }

    // Get year from Plex or Arr data
    let year = plexItem.year;
    if (!year && arrData?.radarrMovie?.year) {
      year = arrData.radarrMovie.year;
    } else if (!year && arrData?.sonarrSeries?.year) {
      year = arrData.sonarrSeries.year;
    }

    // Get additional IDs from Arr data if not in Plex GUIDs
    let tmdbId = guids.tmdbId;
    let imdbId = guids.imdbId;
    let tvdbId = guids.tvdbId;

    if (!tmdbId && arrData?.radarrMovie?.tmdbId) {
      tmdbId = arrData.radarrMovie.tmdbId;
    }
    if (!imdbId && arrData?.radarrMovie?.imdbId) {
      imdbId = arrData.radarrMovie.imdbId;
    }
    if (!imdbId && arrData?.sonarrSeries?.imdbId) {
      imdbId = arrData.sonarrSeries.imdbId;
    }
    if (!tvdbId && arrData?.sonarrSeries?.tvdbId) {
      tvdbId = arrData.sonarrSeries.tvdbId;
    }

    // Merge metadata fields from Plex + Arr sources, preferring Plex first.
    const radarrMovie = arrData?.radarrMovie;
    const sonarrSeries = arrData?.sonarrSeries;

    const genres: string[] | undefined =
      (plexItem.genres && plexItem.genres.length > 0 && plexItem.genres) ||
      (radarrMovie?.genres && radarrMovie.genres.length > 0 && radarrMovie.genres) ||
      (sonarrSeries?.genres && sonarrSeries.genres.length > 0 && sonarrSeries.genres) ||
      undefined;

    const tagMap = this.arrTagMaps.get(
      arrData?.arrInstance ?? (radarrMovie ? PRIMARY_INSTANCE_ID.radarr : PRIMARY_INSTANCE_ID.sonarr)
    );
    const radarrResolvedTags = radarrMovie?.tags && radarrMovie.tags.length > 0
      ? radarrMovie.tags.map((id) => tagMap?.get(id)).filter((t): t is string => Boolean(t))
      : [];
    const sonarrResolvedTags = sonarrSeries?.tags && sonarrSeries.tags.length > 0
      ? sonarrSeries.tags.map((id) => tagMap?.get(id)).filter((t): t is string => Boolean(t))
      : [];

    // Tags from every source count: a "keep" tag set in Radarr must still
    // apply when the item also has Plex labels.
    const mergedTags = mergeTags(plexItem.labels, radarrResolvedTags, sonarrResolvedTags);
    const tags: string[] | undefined = mergedTags.length > 0 ? mergedTags : undefined;

    const studio: string | undefined =
      plexItem.studio || radarrMovie?.studio || sonarrSeries?.network || undefined;

    const contentRating: string | undefined =
      plexItem.contentRating || radarrMovie?.certification || sonarrSeries?.certification || undefined;

    const originalLanguage: string | undefined =
      plexItem.originalLanguage || radarrMovie?.originalLanguage?.name || undefined;

    // Plex duration is milliseconds; Radarr/Sonarr runtime is minutes.
    let runtimeMinutes: number | undefined;
    if (plexItem.duration && plexItem.duration > 0) {
      runtimeMinutes = Math.round(plexItem.duration / 60000);
    } else if (radarrMovie?.runtime) {
      runtimeMinutes = radarrMovie.runtime;
    } else if (sonarrSeries?.runtime) {
      runtimeMinutes = sonarrSeries.runtime;
    }

    const seasonCount: number | undefined =
      sonarrSeries?.statistics?.seasonCount ??
      (plexItem.childCount !== undefined ? plexItem.childCount : undefined);

    const episodeCount: number | undefined =
      sonarrSeries?.statistics?.episodeCount ??
      (plexItem.leafCount !== undefined ? plexItem.leafCount : undefined);

    // Episodes anyone has watched. The history provider sees every user; the
    // media server's own count (Plex viewedLeafCount) only the token owner.
    // Both undercount, so take whichever saw more.
    let watchedEpisodeCount: number | undefined;
    let episodeProgress: string | undefined;
    if (type === 'show') {
      const perPerson = tautulliData?.episodeProgress;
      if (perPerson && Object.keys(perPerson).length > 0) episodeProgress = JSON.stringify(perPerson);
      const fromHistory = tautulliData?.episodesWatched;
      const fromServer = plexItem.viewedLeafCount;
      if (fromHistory !== undefined || fromServer !== undefined) {
        watchedEpisodeCount = Math.max(fromHistory ?? 0, fromServer ?? 0);
      }
    }

    let seriesStatus: string | undefined;
    if (sonarrSeries?.status) {
      // Sonarr: continuing | ended | upcoming | deleted — map "deleted" to ended for rules.
      seriesStatus = sonarrSeries.status === 'deleted' ? 'ended' : sonarrSeries.status;
    }

    // Radarr exposes ratings; Plex rating/audienceRating act as TMDB fallbacks.
    const ratingImdb: number | undefined = radarrMovie?.ratings?.imdb?.value;
    let ratingTmdb: number | undefined = radarrMovie?.ratings?.tmdb?.value;
    if (ratingTmdb === undefined && plexItem.audienceRating !== undefined) {
      ratingTmdb = plexItem.audienceRating;
    }
    const ratingRt: number | undefined = radarrMovie?.ratings?.rottenTomatoes?.value;

    return {
      type,
      title: decodeHtmlEntities(plexItem.title),
      plex_id: plexItem.ratingKey,
      sonarr_id: arrData?.sonarrId,
      radarr_id: arrData?.radarrId,
      // Set together with the id, so a title that moved instance follows it;
      // left alone (undefined) when nothing matched, like the ids.
      arr_instance: arrData?.sonarrId || arrData?.radarrId ? (arrData.arrInstance ?? null) : undefined,
      tmdb_id: tmdbId,
      imdb_id: imdbId,
      tvdb_id: tvdbId,
      year,
      poster_url: posterUrl,
      file_path: filePath,
      file_size: fileSize,
      resolution,
      codec,
      added_at: plexItem.addedAt
        ? new Date(plexItem.addedAt * 1000).toISOString()
        : undefined,
      // Use Tautulli data if available, fall back to Plex watch data
      last_watched_at: tautulliData?.lastWatched?.toISOString()
        || (plexItem.lastViewedAt ? new Date(plexItem.lastViewedAt * 1000).toISOString() : undefined),
      play_count: tautulliData?.playCount || plexItem.viewCount || 0,
      watched_by: tautulliData?.watchedBy,
      status: 'monitored',
      library_key: libraryKey,
      genres,
      tags,
      studio,
      audio_codec: audioCodec,
      video_codec: videoCodec,
      hdr: plexItem.hdr,
      bitrate,
      runtime_minutes: runtimeMinutes,
      season_count: seasonCount,
      episode_count: episodeCount,
      watched_episode_count: watchedEpisodeCount,
      episode_progress: episodeProgress,
      series_status: seriesStatus,
      rating_imdb: ratingImdb,
      rating_tmdb: ratingTmdb,
      rating_rt: ratingRt,
      content_rating: contentRating,
      original_language: originalLanguage,
      // Only overwrite requested_by when Overseerr was actually queried for
      // this item; otherwise leave any existing value untouched on re-sync.
      requested_by: overseerrData ? overseerrData.requestedBy : undefined,
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Whether this scan read an instance's whole library. An item linked to such
   * an instance that matched nothing is no longer in it, so its link is stale.
   */
  wasArrInstanceRead(instanceId: string): boolean {
    return this.readArrInstances.has(instanceId);
  }

  /**
   * Get service instances for direct access if needed
   */
  getServices(): {
    plex: MediaServerService | null;
    watchHistoryProvider: WatchHistoryProvider | null;
    sonarr: SonarrService | null;
    radarr: RadarrService | null;
    overseerr: OverseerrService | null;
  } {
    return {
      plex: this.plex,
      watchHistoryProvider: this.watchHistoryProvider,
      sonarr: this.sonarr,
      radarr: this.radarr,
      overseerr: this.overseerr,
    };
  }
}

export default ScannerService;

/**
 * Union of tag lists, case-insensitive, keeping the first spelling seen.
 */
export function mergeTags(...lists: Array<string[] | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const tag of list ?? []) {
      const key = tag.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, tag.trim());
    }
  }
  return [...seen.values()];
}
