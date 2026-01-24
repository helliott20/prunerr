import logger from '../utils/logger';
import config from '../config';
import settingsRepo from '../db/repositories/settings';
import { PlexService } from './plex';
import { TautulliService } from './tautulli';
import { SonarrService } from './sonarr';
import { RadarrService } from './radarr';
import { OverseerrService } from './overseerr';
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
} from './types';
import type { MediaItem, CreateMediaItemInput, MediaType } from '../types';

// GUID parsing patterns
const GUID_PATTERNS = {
  imdb: /imdb:\/\/(tt\d+)/,
  tmdb: /tmdb:\/\/(\d+)/,
  tvdb: /tvdb:\/\/(\d+)/,
  thetvdb: /thetvdb:\/\/(\d+)/,
  plex: /plex:\/\/(?:movie|show|episode)\/([a-f0-9]+)/,
};

interface ParsedGuids {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
  plexGuid?: string;
}

export class ScannerService {
  private plex: PlexService | null = null;
  private tautulli: TautulliService | null = null;
  private sonarr: SonarrService | null = null;
  private radarr: RadarrService | null = null;
  private overseerr: OverseerrService | null = null;

  // Caches to reduce API calls during scan
  private sonarrSeriesCache: Map<number, SonarrSeries> = new Map();
  private sonarrTvdbIndex: Map<number, SonarrSeries> = new Map();
  private sonarrImdbIndex: Map<string, SonarrSeries> = new Map();
  private radarrMoviesCache: Map<number, RadarrMovie> = new Map();
  private radarrTmdbIndex: Map<number, RadarrMovie> = new Map();
  private radarrImdbIndex: Map<string, RadarrMovie> = new Map();

  // Database callback - to be injected
  private dbCallback: ((items: SyncedMediaData[]) => Promise<void>) | null = null;

  constructor() {
    this.initializeServices();
  }

  /**
   * Initialize service connections based on configuration
   * Reads from database settings first, falls back to environment variables
   */
  private initializeServices(): void {
    // Get settings from database (with env var fallback)
    const plexUrl = settingsRepo.getValue('plex_url') || config.plex.url;
    const plexToken = settingsRepo.getValue('plex_token') || config.plex.token;
    const tautulliUrl = settingsRepo.getValue('tautulli_url') || config.tautulli.url;
    const tautulliApiKey = settingsRepo.getValue('tautulli_apiKey') || config.tautulli.apiKey;
    const sonarrUrl = settingsRepo.getValue('sonarr_url') || config.sonarr.url;
    const sonarrApiKey = settingsRepo.getValue('sonarr_apiKey') || config.sonarr.apiKey;
    const radarrUrl = settingsRepo.getValue('radarr_url') || config.radarr.url;
    const radarrApiKey = settingsRepo.getValue('radarr_apiKey') || config.radarr.apiKey;
    const overseerrUrl = settingsRepo.getValue('overseerr_url') || config.overseerr.url;
    const overseerrApiKey = settingsRepo.getValue('overseerr_apiKey') || config.overseerr.apiKey;

    // Initialize Plex
    if (plexUrl && plexToken) {
      this.plex = new PlexService(plexUrl, plexToken);
      logger.info('Plex service initialized', { url: plexUrl });
    } else {
      logger.warn('Plex service not configured - missing URL or token');
    }

    // Initialize Tautulli
    if (tautulliUrl && tautulliApiKey) {
      this.tautulli = new TautulliService(tautulliUrl, tautulliApiKey);
      logger.info('Tautulli service initialized', { url: tautulliUrl });
    } else {
      logger.warn('Tautulli service not configured - missing URL or API key');
    }

    // Initialize Sonarr
    if (sonarrUrl && sonarrApiKey) {
      this.sonarr = new SonarrService(sonarrUrl, sonarrApiKey);
      logger.info('Sonarr service initialized', { url: sonarrUrl });
    } else {
      logger.warn('Sonarr service not configured - missing URL or API key');
    }

    // Initialize Radarr
    if (radarrUrl && radarrApiKey) {
      this.radarr = new RadarrService(radarrUrl, radarrApiKey);
      logger.info('Radarr service initialized', { url: radarrUrl });
    } else {
      logger.warn('Radarr service not configured - missing URL or API key');
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
    this.plex = null;
    this.tautulli = null;
    this.sonarr = null;
    this.radarr = null;
    this.overseerr = null;
    this.clearCaches();
    this.initializeServices();
  }

  /**
   * Set the database callback for persisting scanned items
   */
  setDatabaseCallback(callback: (items: SyncedMediaData[]) => Promise<void>): void {
    this.dbCallback = callback;
  }

  /**
   * Test all configured service connections
   */
  async testConnections(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    if (this.plex) {
      results['plex'] = await this.plex.testConnection();
    }

    if (this.tautulli) {
      results['tautulli'] = await this.tautulli.testConnection();
    }

    if (this.sonarr) {
      results['sonarr'] = await this.sonarr.testConnection();
    }

    if (this.radarr) {
      results['radarr'] = await this.radarr.testConnection();
    }

    if (this.overseerr) {
      results['overseerr'] = await this.overseerr.testConnection();
    }

    return results;
  }

  /**
   * Full library scan - fetches all data from all services
   */
  async scanAll(): Promise<ScanResult> {
    const startedAt = new Date();
    const errors: ScanError[] = [];
    let itemsScanned = 0;
    let itemsAdded = 0;
    let itemsUpdated = 0;
    let itemsFlagged = 0;

    logger.info('Starting full library scan');

    try {
      // Build caches first for efficient matching
      await this.buildCaches();

      // Get Plex libraries
      if (!this.plex) {
        throw new Error('Plex service not configured');
      }

      const libraries = await this.plex.getLibraries();
      const mediaLibraries = libraries.filter(
        (lib) => lib.type === 'movie' || lib.type === 'show'
      );

      logger.info(`Found ${mediaLibraries.length} media libraries to scan`);

      // Process each library
      for (const library of mediaLibraries) {
        try {
          const result = await this.scanLibrary(library);
          itemsScanned += result.itemsScanned;
          itemsAdded += result.itemsAdded;
          itemsUpdated += result.itemsUpdated;
          itemsFlagged += result.itemsFlagged;
          errors.push(...result.errors);
        } catch (error) {
          errors.push({
            message: `Failed to scan library ${library.title}: ${(error as Error).message}`,
            service: 'plex',
            stack: (error as Error).stack,
          });
        }
      }

      logger.info('Full library scan completed', {
        itemsScanned,
        itemsAdded,
        itemsUpdated,
        itemsFlagged,
        errors: errors.length,
      });
    } catch (error) {
      errors.push({
        message: `Scan failed: ${(error as Error).message}`,
        service: 'plex',
        stack: (error as Error).stack,
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
      itemsFlagged,
      errors,
    };
  }

  /**
   * Scan a single library
   */
  private async scanLibrary(library: PlexLibrary): Promise<{
    itemsScanned: number;
    itemsAdded: number;
    itemsUpdated: number;
    itemsFlagged: number;
    errors: ScanError[];
  }> {
    const errors: ScanError[] = [];
    let itemsScanned = 0;
    let itemsAdded = 0;
    let itemsUpdated = 0;
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
            syncedItems.push(syncedData);
            itemsScanned++;
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
    if (this.dbCallback && syncedItems.length > 0) {
      try {
        await this.dbCallback(syncedItems);
        itemsAdded = syncedItems.length; // Simplified - actual implementation would track adds vs updates
      } catch (error) {
        errors.push({
          message: `Failed to persist items: ${(error as Error).message}`,
          service: 'database',
          stack: (error as Error).stack,
        });
      }
    }

    logger.info(`Completed scanning library: ${library.title}`, {
      itemsScanned,
      errors: errors.length,
    });

    return { itemsScanned, itemsAdded, itemsUpdated, itemsFlagged, errors };
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

    // Get Tautulli watch data
    // For TV shows, use getShowWatchedStatus which queries by grandparent_rating_key
    // to find all episode watches. For movies, use getItemWatchedStatus.
    let tautulliData: TautulliWatchedStatus | undefined;
    if (this.tautulli) {
      try {
        if (libraryType === 'show') {
          tautulliData = await this.tautulli.getShowWatchedStatus(fullItem.ratingKey);
        } else {
          tautulliData = await this.tautulli.getItemWatchedStatus(fullItem.ratingKey);
        }
      } catch {
        // Continue without Tautulli data
      }
    }

    // Match to Sonarr/Radarr
    const arrData = await this.matchPlexToArr(fullItem, libraryType);

    // Get Overseerr data
    let overseerrData: { requestedBy: string | null; request: null } | undefined;
    if (this.overseerr && arrData) {
      try {
        const guids = this.parseGuids(fullItem);
        if (libraryType === 'movie' && guids.tmdbId) {
          const requestedBy = await this.overseerr.getRequestedBy(guids.tmdbId, 'movie');
          overseerrData = { requestedBy, request: null };
        } else if (libraryType === 'show' && guids.tmdbId) {
          // Overseerr uses TMDB IDs for TV shows as well
          const requestedBy = await this.overseerr.getRequestedBy(guids.tmdbId, 'tv');
          overseerrData = { requestedBy, request: null };
        }
      } catch {
        // Continue without Overseerr data
      }
    }

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
        return {
          radarrId: radarrMovie.id,
          radarrMovie,
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
        return {
          sonarrId: sonarrSeries.id,
          sonarrSeries,
        };
      }
    }

    return undefined;
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
   * Build caches from Sonarr and Radarr for efficient matching
   */
  private async buildCaches(): Promise<void> {
    logger.info('Building service caches for matching');

    // Build Sonarr cache
    if (this.sonarr) {
      try {
        const series = await this.sonarr.getSeries();
        for (const s of series) {
          this.sonarrSeriesCache.set(s.id, s);
          if (s.tvdbId) {
            this.sonarrTvdbIndex.set(s.tvdbId, s);
          }
          if (s.imdbId) {
            this.sonarrImdbIndex.set(s.imdbId, s);
          }
        }
        logger.info(`Cached ${series.length} series from Sonarr`);
      } catch (error) {
        logger.error('Failed to cache Sonarr data', { message: (error as Error).message });
      }
    }

    // Build Radarr cache
    if (this.radarr) {
      try {
        const movies = await this.radarr.getMovies();
        for (const m of movies) {
          this.radarrMoviesCache.set(m.id, m);
          if (m.tmdbId) {
            this.radarrTmdbIndex.set(m.tmdbId, m);
          }
          if (m.imdbId) {
            this.radarrImdbIndex.set(m.imdbId, m);
          }
        }
        logger.info(`Cached ${movies.length} movies from Radarr`);
      } catch (error) {
        logger.error('Failed to cache Radarr data', { message: (error as Error).message });
      }
    }
  }

  /**
   * Clear all caches
   */
  private clearCaches(): void {
    this.sonarrSeriesCache.clear();
    this.sonarrTvdbIndex.clear();
    this.sonarrImdbIndex.clear();
    this.radarrMoviesCache.clear();
    this.radarrTmdbIndex.clear();
    this.radarrImdbIndex.clear();
    logger.debug('Cleared service caches');
  }

  /**
   * Convert synced data to database input format
   */
  convertToMediaItemInput(syncedData: SyncedMediaData): CreateMediaItemInput {
    const { plexItem, tautulliData, arrData } = syncedData;

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

    if (plexItem.media && plexItem.media.length > 0) {
      const media = plexItem.media[0];
      if (media) {
        resolution = media.videoResolution;
        codec = media.videoCodec;

        if (media.parts && media.parts.length > 0) {
          const firstPart = media.parts[0];
          if (firstPart) {
            filePath = firstPart.file;
          }
          fileSize = media.parts.reduce((total, part) => total + part.size, 0);
        }
      }
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

    return {
      type,
      title: plexItem.title,
      plex_id: plexItem.ratingKey,
      sonarr_id: arrData?.sonarrId,
      radarr_id: arrData?.radarrId,
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
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get service instances for direct access if needed
   */
  getServices(): {
    plex: PlexService | null;
    tautulli: TautulliService | null;
    sonarr: SonarrService | null;
    radarr: RadarrService | null;
    overseerr: OverseerrService | null;
  } {
    return {
      plex: this.plex,
      tautulli: this.tautulli,
      sonarr: this.sonarr,
      radarr: this.radarr,
      overseerr: this.overseerr,
    };
  }
}

export default ScannerService;
