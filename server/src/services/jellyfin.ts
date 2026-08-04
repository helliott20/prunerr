import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';
import type { PlexMedia, PlexMediaPart, PlexMediaStream, PlexGuid } from './types';
import type {
  GetWatchHistoryOptions,
  MediaServerHistoryEntry,
  MediaServerItem,
  MediaServerLibrary,
  MediaServerService,
  MediaServerType,
  MediaServerUser,
  MediaServerUsersService,
} from './mediaServer/types';
import { MEDIA_SERVER_LABELS } from './mediaServer/types';

// ---------------------------------------------------------------------------
// Jellyfin/Emby wire types (only the fields we consume)
// ---------------------------------------------------------------------------

interface JellyfinSystemInfo {
  Id?: string;
  ServerName?: string;
  Version?: string;
}

interface JellyfinVirtualFolder {
  Name: string;
  ItemId: string;
  /** 'movies' | 'tvshows' | 'music' | 'homevideos' | 'boxsets' | ... */
  CollectionType?: string;
  Locations?: string[];
  RefreshStatus?: string;
}

interface JellyfinUserDto {
  Id: string;
  Name: string;
  PrimaryImageTag?: string;
  Policy?: {
    IsAdministrator?: boolean;
    IsDisabled?: boolean;
  };
}

interface JellyfinUserData {
  PlayCount?: number;
  Played?: boolean;
  LastPlayedDate?: string;
  PlaybackPositionTicks?: number;
  IsFavorite?: boolean;
}

interface JellyfinMediaStream {
  Type?: string; // 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage'
  Index?: number;
  Codec?: string;
  Profile?: string;
  Language?: string;
  DisplayTitle?: string;
  Width?: number;
  Height?: number;
  AspectRatio?: string;
  Channels?: number;
  BitRate?: number;
  AverageFrameRate?: number;
  RealFrameRate?: number;
  VideoRange?: string; // 'SDR' | 'HDR'
  VideoRangeType?: string; // 'SDR' | 'HDR10' | 'HLG' | 'DOVI' | 'DOVIWithHDR10' | 'HDR10Plus'
  ColorTransfer?: string;
  ColorSpace?: string;
}

interface JellyfinMediaSource {
  Id?: string;
  Path?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  MediaStreams?: JellyfinMediaStream[];
}

interface JellyfinItem {
  Id: string;
  Name: string;
  Type?: string; // 'Movie' | 'Series' | 'Season' | 'Episode'
  SortName?: string;
  OriginalTitle?: string;
  Overview?: string;
  Taglines?: string[];
  OfficialRating?: string;
  CommunityRating?: number;
  CriticRating?: number; // 0-100
  ProductionYear?: number;
  PremiereDate?: string;
  DateCreated?: string;
  DateLastMediaAdded?: string;
  RunTimeTicks?: number;
  Genres?: string[];
  Tags?: string[];
  Studios?: Array<{ Name?: string }>;
  ProviderIds?: Record<string, string>;
  MediaSources?: JellyfinMediaSource[];
  MediaStreams?: JellyfinMediaStream[];
  UserData?: JellyfinUserData;
  ChildCount?: number;
  RecursiveItemCount?: number;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentId?: string;
  SeriesId?: string;
  SeasonId?: string;
  SeriesName?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  Path?: string;
}

interface JellyfinItemsResponse {
  Items?: JellyfinItem[];
  TotalRecordCount?: number;
  StartIndex?: number;
}

// ---------------------------------------------------------------------------

const JELLYFIN_PAGE_SIZE = 200;
const TICKS_PER_MS = 10_000;

/**
 * Fields Jellyfin omits from list responses unless asked for. Requesting them
 * up front means a library sync needs one round-trip per page instead of one
 * per item.
 */
const ITEM_FIELDS = [
  'Path',
  'ProviderIds',
  'Genres',
  'Tags',
  'Overview',
  'Taglines',
  'ProductionYear',
  'PremiereDate',
  'CommunityRating',
  'CriticRating',
  'OfficialRating',
  'DateCreated',
  'MediaSources',
  'MediaStreams',
  'RunTimeTicks',
  'ChildCount',
  'RecursiveItemCount',
  'Studios',
  'OriginalTitle',
  'SortName',
  'ParentId',
].join(',');

/** Jellyfin `CollectionType` → the canonical (Plex-shaped) library type. */
const COLLECTION_TYPE_MAP: Record<string, MediaServerLibrary['type']> = {
  movies: 'movie',
  tvshows: 'show',
  music: 'artist',
  musicvideos: 'artist',
  homevideos: 'photo',
  photos: 'photo',
  books: 'photo',
};

/** Jellyfin item `Type` → the canonical item type. */
const ITEM_TYPE_MAP: Record<string, MediaServerItem['type']> = {
  Movie: 'movie',
  Series: 'show',
  Season: 'season',
  Episode: 'episode',
};

/**
 * JellyfinService — media server adapter for Jellyfin and Emby.
 *
 * The two forked from the same codebase and their REST APIs remain close
 * enough that one adapter covers both; the differences are limited to the auth
 * header and how image URLs are signed, both handled by `serverType` checks.
 *
 * Everything is translated into Plex-shaped types at the edge (see
 * `mediaServer/types.ts` for why), so the scanner, rules engine and database
 * layer are backend-agnostic.
 *
 * Known limitation — watch history: Jellyfin core does not expose a playback
 * history endpoint (that lives in the optional Playback Reporting plugin).
 * We synthesise history from each user's `UserData`, which records the *last*
 * play and a total play count but not individual play timestamps. So repeat
 * views collapse into one event per user per item. Rules keyed on "watched by
 * whom" and "last watched when" behave correctly; rules keyed on an exact
 * total play count will read low. This is the same trade-off Maintainerr makes.
 */
export class JellyfinService implements MediaServerService, MediaServerUsersService {
  readonly serverType: MediaServerType;

  private client: AxiosInstance;
  private url: string;
  private apiKey: string;
  private userCache: MediaServerUser[] | null = null;

  constructor(url: string, apiKey: string, serverType: MediaServerType = 'jellyfin') {
    if (serverType !== 'jellyfin' && serverType !== 'emby') {
      throw new Error(`JellyfinService cannot serve backend "${serverType}"`);
    }

    this.url = url.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.serverType = serverType;

    // Jellyfin 10.8+ wants the MediaBrowser authorization scheme; Emby never
    // adopted it and still expects the legacy token header.
    const headers: Record<string, string> =
      serverType === 'emby'
        ? { 'X-Emby-Token': apiKey }
        : {
            Authorization: `MediaBrowser Client="Prunerr", Device="Prunerr", DeviceId="prunerr", Version="1.0", Token="${apiKey}"`,
          };

    this.client = axios.create({
      baseURL: this.url,
      headers: { ...headers, Accept: 'application/json' },
      timeout: 30000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] as string) || 5;
          logger.warn(`${this.label} rate limited, retrying after ${retryAfter}s`);
          await this.delay(retryAfter * 1000);
          return this.client.request(error.config!);
        }
        throw error;
      }
    );
  }

  private get label(): string {
    return MEDIA_SERVER_LABELS[this.serverType];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logFailure(message: string, error: unknown): void {
    const axiosError = error as AxiosError;
    logger.error(message, {
      status: axiosError.response?.status,
      message: axiosError.message,
    });
  }

  /** ISO-8601 → Unix seconds. Returns 0 for missing/unparseable input. */
  private toUnixSeconds(value?: string): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get<JellyfinSystemInfo>('/System/Info');
      const isValid = !!response.data?.Version;

      if (isValid) {
        logger.info(`${this.label} connection test successful`, {
          server: response.data.ServerName,
          version: response.data.Version,
        });
      } else {
        logger.warn(`${this.label} responded to /System/Info without a version field`);
      }

      return isValid;
    } catch (error) {
      this.logFailure(`${this.label} connection test failed`, error);
      return false;
    }
  }

  async getLibraries(): Promise<MediaServerLibrary[]> {
    try {
      const response = await this.client.get<JellyfinVirtualFolder[]>('/Library/VirtualFolders');
      const folders = Array.isArray(response.data) ? response.data : [];

      const libraries: MediaServerLibrary[] = folders.map((folder) => ({
        key: folder.ItemId,
        title: folder.Name,
        type: COLLECTION_TYPE_MAP[folder.CollectionType ?? ''] ?? 'movie',
        // Plex-only concepts. Kept as empty strings so downstream consumers
        // (which only ever read them for display) don't have to null-check.
        agent: '',
        scanner: '',
        language: '',
        uuid: folder.ItemId,
        updatedAt: 0,
        createdAt: 0,
        scannedAt: 0,
        contentChangedAt: 0,
        hidden: false,
        location: folder.Locations ?? [],
      }));

      logger.info(`Retrieved ${libraries.length} libraries from ${this.label}`);
      return libraries;
    } catch (error) {
      this.logFailure(`Failed to get ${this.label} libraries`, error);
      throw error;
    }
  }

  async getLibraryItems(libraryId: string): Promise<MediaServerItem[]> {
    try {
      const items: MediaServerItem[] = [];
      let startIndex = 0;

      while (true) {
        const response = await this.client.get<JellyfinItemsResponse>('/Items', {
          params: {
            ParentId: libraryId,
            Recursive: true,
            // Top-level entities only — the scanner expands shows itself, and
            // pulling every episode here would balloon a sync by ~20x.
            IncludeItemTypes: 'Movie,Series',
            Fields: ITEM_FIELDS,
            StartIndex: startIndex,
            Limit: JELLYFIN_PAGE_SIZE,
            EnableTotalRecordCount: true,
          },
        });

        const page = response.data?.Items ?? [];
        const total = response.data?.TotalRecordCount;

        items.push(...page.map((item) => this.parseItem(item)));

        logger.debug(`Retrieved ${this.label} library page ${libraryId}`, {
          startIndex,
          pageItems: page.length,
          total,
        });

        if (page.length === 0) break;

        startIndex += page.length;

        if (typeof total === 'number') {
          if (startIndex >= total) break;
          continue;
        }

        if (page.length < JELLYFIN_PAGE_SIZE) break;
      }

      logger.info(`Retrieved ${items.length} items from ${this.label} library ${libraryId}`);
      return items;
    } catch (error) {
      this.logFailure(`Failed to get items from ${this.label} library ${libraryId}`, error);
      throw error;
    }
  }

  async getItemMetadata(itemId: string): Promise<MediaServerItem> {
    try {
      // `/Items?Ids=` is used rather than `/Items/{id}` because the latter is
      // not available to API-key (non-user) auth on all Jellyfin versions.
      const response = await this.client.get<JellyfinItemsResponse>('/Items', {
        params: { Ids: itemId, Recursive: true, Fields: ITEM_FIELDS },
      });

      const item = response.data?.Items?.[0];
      if (!item) {
        throw new Error(`Item with id ${itemId} not found`);
      }

      return this.parseItem(item);
    } catch (error) {
      this.logFailure(`Failed to get metadata for item ${itemId}`, error);
      throw error;
    }
  }

  /**
   * Playback history, preferring real per-play events where they exist.
   *
   * Two sources, in order:
   *   1. The Playback Reporting plugin, if installed. It keeps a genuine
   *      event log, so repeat views, exact timestamps and play durations all
   *      survive — full parity with what Plex returns natively.
   *   2. Otherwise, synthesise from each user's `UserData` (see the class
   *      docstring for what that approximation costs).
   */
  async getWatchHistory(options: GetWatchHistoryOptions = {}): Promise<MediaServerHistoryEntry[]> {
    const fromPlugin = await this.getWatchHistoryFromPlaybackReporting(options);
    if (fromPlugin !== null) return fromPlugin;

    return this.getWatchHistoryFromUserData(options);
  }

  /**
   * Read the Playback Reporting plugin's event log via its custom-query API.
   *
   * Returns null — rather than throwing or returning [] — when the plugin is
   * absent, so the caller can tell "not installed" apart from "installed but
   * nothing watched" and fall back accordingly.
   */
  private async getWatchHistoryFromPlaybackReporting(
    options: GetWatchHistoryOptions
  ): Promise<MediaServerHistoryEntry[] | null> {
    // The plugin stores timestamps as naive local-time strings, so the bound is
    // built in the same shape rather than as an ISO instant.
    const since = options.sinceUnix
      ? new Date(options.sinceUnix * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : '1970-01-01 00:00:00';

    let response;
    try {
      response = await this.client.post<{ colums?: string[]; columns?: string[]; results?: string[][] }>(
        '/user_usage_stats/submit_custom_query',
        {
          CustomQueryString:
            'SELECT DateCreated, UserId, ItemId, ItemType, ItemName ' +
            `FROM PlaybackActivity WHERE DateCreated > '${since}' ORDER BY DateCreated DESC`,
          ReplaceUserId: false,
        }
      );
    } catch (error) {
      const status = (error as AxiosError).response?.status;
      if (status === 404 || status === 400) {
        logger.info(
          `${this.label}: Playback Reporting plugin not detected, falling back to per-user watch state`
        );
        return null;
      }
      this.logFailure(`${this.label}: Playback Reporting query failed, falling back`, error);
      return null;
    }

    const rows = response.data?.results;
    if (!Array.isArray(rows)) {
      logger.warn(`${this.label}: unexpected Playback Reporting response, falling back`);
      return null;
    }

    // Guard against a schema drift in the plugin silently yielding junk.
    const columns = response.data.columns ?? response.data.colums ?? [];
    if (columns.length > 0 && columns.length !== 5) {
      logger.warn(
        `${this.label}: Playback Reporting returned ${columns.length} columns, expected 5 — falling back`
      );
      return null;
    }

    const entries: MediaServerHistoryEntry[] = [];
    for (const row of rows) {
      const [dateCreated, userId, itemId, itemType, itemName] = row;
      if (!dateCreated || !userId || !itemId) continue;

      // Naive local-time string; treat it as UTC so ordering stays stable.
      const viewedAt = this.toUnixSeconds(`${dateCreated.replace(' ', 'T')}Z`);
      if (!viewedAt) continue;

      entries.push({
        historyKey: `${userId}-${itemId}-${viewedAt}`,
        ratingKey: itemId,
        type: ITEM_TYPE_MAP[itemType ?? ''] ?? 'movie',
        accountKey: userId,
        viewedAt,
        title: itemName,
      });
    }

    options.onPage?.(entries, entries.length, entries.length);
    logger.info(
      `Retrieved ${entries.length} history entries from the ${this.label} Playback Reporting plugin`
    );
    return entries;
  }

  /** Fallback: derive one event per (user, item) from each user's watch state. */
  private async getWatchHistoryFromUserData(
    options: GetWatchHistoryOptions
  ): Promise<MediaServerHistoryEntry[]> {
    const pageSize = options.pageSize ?? JELLYFIN_PAGE_SIZE;
    const all: MediaServerHistoryEntry[] = [];
    const users = await this.fetchUsers();

    if (users.length === 0) {
      logger.warn(`${this.label} returned no users; watch history will be empty`);
      return all;
    }

    for (const user of users) {
      let startIndex = 0;
      let exhausted = false;

      while (!exhausted) {
        let response;
        try {
          response = await this.client.get<JellyfinItemsResponse>(`/Users/${user.id}/Items`, {
            params: {
              Recursive: true,
              IsPlayed: true,
              IncludeItemTypes: 'Movie,Episode',
              Fields: 'UserData,ProviderIds,ParentId',
              SortBy: 'DatePlayed',
              SortOrder: 'Descending',
              StartIndex: startIndex,
              Limit: pageSize,
              EnableTotalRecordCount: true,
            },
          });
        } catch (error) {
          // One unreadable user (disabled, permissions) must not sink the sync.
          this.logFailure(`Failed to read ${this.label} history for user ${user.username}`, error);
          break;
        }

        const rows = response.data?.Items ?? [];
        if (rows.length === 0) break;

        const page: MediaServerHistoryEntry[] = [];
        for (const row of rows) {
          const viewedAt = this.toUnixSeconds(row.UserData?.LastPlayedDate);
          if (!viewedAt) continue;

          // Sorted newest-first, so the first row older than the cutoff means
          // every remaining row for this user is older too.
          if (options.sinceUnix !== undefined && viewedAt < options.sinceUnix) {
            exhausted = true;
            break;
          }

          page.push({
            historyKey: `${user.id}-${row.Id}-${viewedAt}`,
            ratingKey: row.Id,
            parentRatingKey: row.SeasonId,
            grandparentRatingKey: row.SeriesId,
            type: ITEM_TYPE_MAP[row.Type ?? ''] ?? 'movie',
            accountKey: user.id,
            viewedAt,
            title: row.Name,
            grandparentTitle: row.SeriesName,
          });
        }

        all.push(...page);
        options.onPage?.(page, all.length, null);

        if (exhausted) break;

        startIndex += rows.length;
        if (rows.length < pageSize) break;
      }
    }

    logger.info(`Retrieved ${all.length} history entries from ${this.label} across ${users.length} users`);
    return all;
  }

  async refreshLibrary(libraryId: string): Promise<void> {
    try {
      await this.client.post(`/Items/${libraryId}/Refresh`, null, {
        params: {
          Recursive: true,
          ImageRefreshMode: 'Default',
          MetadataRefreshMode: 'Default',
        },
      });
      logger.info(`Triggered refresh for ${this.label} library ${libraryId}`);
    } catch (error) {
      this.logFailure(`Failed to refresh ${this.label} library ${libraryId}`, error);
      throw error;
    }
  }

  /**
   * Accounts on the server. Cached for the lifetime of the instance — the
   * singleton is torn down whenever settings change, so this cannot go stale
   * across a reconfiguration.
   */
  async fetchUsers(): Promise<MediaServerUser[]> {
    if (this.userCache) return this.userCache;

    try {
      const response = await this.client.get<JellyfinUserDto[]>('/Users');
      const dtos = Array.isArray(response.data) ? response.data : [];

      const users: MediaServerUser[] = dtos.map((dto) => ({
        id: dto.Id,
        username: dto.Name,
        email: null,
        thumbUrl: dto.PrimaryImageTag ? `${this.url}/Users/${dto.Id}/Images/Primary` : null,
        // Jellyfin has no single "owner"; administrators are the closest
        // equivalent and are what Prunerr surfaces as the privileged account.
        isOwner: dto.Policy?.IsAdministrator === true,
        isHomeUser: false,
      }));

      this.userCache = users;
      logger.info(`Retrieved ${users.length} users from ${this.label}`);
      return users;
    } catch (error) {
      this.logFailure(`Failed to get ${this.label} users`, error);
      return [];
    }
  }

  getImageUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http')) return path;

    const relative = path.startsWith('/') ? path : `/${path}`;
    // Emby requires the key as a query param for image endpoints; Jellyfin
    // accepts the Authorization header but tolerates the param, and browsers
    // fetching <img src> cannot set headers either way.
    const separator = relative.includes('?') ? '&' : '?';
    const param = this.serverType === 'emby' ? 'api_key' : 'ApiKey';
    return `${this.url}${relative}${separator}${param}=${this.apiKey}`;
  }

  // -------------------------------------------------------------------------
  // Translation into the canonical (Plex-shaped) types
  // -------------------------------------------------------------------------

  private parseItem(item: JellyfinItem): MediaServerItem {
    const media = this.parseMediaSources(item);
    const guids = this.parseProviderIds(item.ProviderIds);
    const runtimeMs = item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_MS) : undefined;

    const primaryTag = item.ImageTags?.['Primary'];
    const thumb = primaryTag ? `/Items/${item.Id}/Images/Primary?tag=${primaryTag}` : undefined;
    const backdropTag = item.BackdropImageTags?.[0];
    const art = backdropTag ? `/Items/${item.Id}/Images/Backdrop?tag=${backdropTag}` : undefined;

    const playCount = item.UserData?.PlayCount;
    const lastPlayed = this.toUnixSeconds(item.UserData?.LastPlayedDate);

    return {
      ratingKey: item.Id,
      key: `/Items/${item.Id}`,
      // Plex's `guid` is a single canonical identifier; the closest analogue is
      // the strongest external id we hold, falling back to a Jellyfin-native one.
      guid: guids[0]?.id ?? `jellyfin://${item.Id}`,
      type: ITEM_TYPE_MAP[item.Type ?? ''] ?? 'movie',
      title: item.Name,
      titleSort: item.SortName,
      originalTitle: item.OriginalTitle,
      contentRating: item.OfficialRating,
      summary: item.Overview,
      // Jellyfin's CriticRating is 0-100 (Rotten Tomatoes); Plex's `rating` is
      // 0-10, which is what the rules engine compares against.
      rating: typeof item.CriticRating === 'number' ? item.CriticRating / 10 : undefined,
      audienceRating: item.CommunityRating,
      year: item.ProductionYear,
      tagline: item.Taglines?.[0],
      thumb,
      art,
      duration: runtimeMs,
      originallyAvailableAt: item.PremiereDate ? item.PremiereDate.split('T')[0] : undefined,
      addedAt: this.toUnixSeconds(item.DateCreated),
      updatedAt: this.toUnixSeconds(item.DateLastMediaAdded ?? item.DateCreated),
      studio: item.Studios?.[0]?.Name,
      childCount: item.ChildCount,
      leafCount: item.RecursiveItemCount,
      viewedLeafCount: undefined,
      viewCount: playCount,
      lastViewedAt: lastPlayed || undefined,
      parentRatingKey: item.SeasonId,
      grandparentRatingKey: item.SeriesId,
      parentTitle: item.SeasonName,
      grandparentTitle: item.SeriesName,
      index: item.IndexNumber,
      parentIndex: item.ParentIndexNumber,
      media: media.length > 0 ? media : undefined,
      guids: guids.length > 0 ? guids : undefined,
      genres: item.Genres && item.Genres.length > 0 ? item.Genres : undefined,
      // Jellyfin has no separate label/collection concept on the item itself;
      // free-form Tags are the closest match to Plex labels.
      labels: item.Tags && item.Tags.length > 0 ? item.Tags : undefined,
      collections: undefined,
      originalLanguage: undefined,
      hdr: this.deriveHdr(media),
    };
  }

  /**
   * `{ Tmdb: '123', Imdb: 'tt1' }` → `[{ id: 'tmdb://123' }, { id: 'imdb://tt1' }]`,
   * matching the scheme Plex uses and the *arr matching logic expects.
   */
  private parseProviderIds(providerIds?: Record<string, string>): PlexGuid[] {
    if (!providerIds) return [];

    const guids: PlexGuid[] = [];
    for (const [provider, value] of Object.entries(providerIds)) {
      if (!value) continue;
      guids.push({ id: `${provider.toLowerCase()}://${value}` });
    }
    return guids;
  }

  private parseMediaSources(item: JellyfinItem): PlexMedia[] {
    const sources = item.MediaSources ?? [];
    // Series carry no MediaSources of their own — only their episodes do.
    if (sources.length === 0) return [];

    return sources.map((source, sourceIndex) => {
      const allStreams = source.MediaStreams ?? item.MediaStreams ?? [];
      const videoStream = allStreams.find((s) => s.Type === 'Video');
      const audioStream = allStreams.find((s) => s.Type === 'Audio');
      const durationMs = source.RunTimeTicks
        ? Math.round(source.RunTimeTicks / TICKS_PER_MS)
        : item.RunTimeTicks
          ? Math.round(item.RunTimeTicks / TICKS_PER_MS)
          : 0;

      const streams: PlexMediaStream[] = allStreams.map((s, streamIndex) => ({
        id: s.Index ?? streamIndex,
        streamType: s.Type === 'Video' ? 1 : s.Type === 'Audio' ? 2 : s.Type === 'Subtitle' ? 3 : 0,
        codec: s.Codec,
        displayTitle: s.DisplayTitle,
        extendedDisplayTitle: s.DisplayTitle,
        colorTrc: s.ColorTransfer,
        colorSpace: s.ColorSpace,
        doviPresent: s.VideoRangeType === 'DOVI' || s.VideoRangeType === 'DOVIWithHDR10',
        doviProfile: undefined,
        language: s.Language,
        languageCode: s.Language,
      }));

      const part: PlexMediaPart = {
        id: sourceIndex,
        key: `/Items/${item.Id}/Download`,
        duration: durationMs,
        file: source.Path ?? item.Path ?? '',
        size: source.Size ?? 0,
        container: source.Container ?? '',
        videoProfile: videoStream?.Profile ?? '',
        streams: streams.length > 0 ? streams : undefined,
      };

      return {
        id: sourceIndex,
        duration: durationMs,
        bitrate: source.Bitrate ? Math.round(source.Bitrate / 1000) : 0,
        width: videoStream?.Width ?? 0,
        height: videoStream?.Height ?? 0,
        aspectRatio: this.parseAspectRatio(videoStream?.AspectRatio),
        audioChannels: audioStream?.Channels ?? 0,
        audioCodec: audioStream?.Codec ?? '',
        videoCodec: videoStream?.Codec ?? '',
        videoResolution: this.deriveResolution(videoStream?.Height, videoStream?.Width),
        container: source.Container ?? '',
        videoFrameRate: this.formatFrameRate(videoStream?.AverageFrameRate ?? videoStream?.RealFrameRate),
        videoProfile: videoStream?.Profile ?? '',
        parts: [part],
      };
    });
  }

  /** Jellyfin reports '16:9'; Plex reports 1.78. */
  private parseAspectRatio(value?: string): number {
    if (!value) return 0;
    const [w, h] = value.split(':').map(Number);
    if (w && h) return Math.round((w / h) * 100) / 100;
    const direct = parseFloat(value);
    return Number.isNaN(direct) ? 0 : direct;
  }

  /** Plex-style resolution buckets, which the rules engine matches on. */
  private deriveResolution(height?: number, width?: number): string {
    const h = height ?? 0;
    const w = width ?? 0;
    if (h >= 2000 || w >= 3800) return '4k';
    if (h >= 1000 || w >= 1900) return '1080';
    if (h >= 700 || w >= 1200) return '720';
    if (h >= 560) return '576';
    if (h >= 460) return '480';
    return 'sd';
  }

  /** Plex uses labels like 'NTSC'/'PAL'/'24p'; numeric rates are close enough. */
  private formatFrameRate(rate?: number): string {
    if (!rate) return '';
    return `${Math.round(rate)}p`;
  }

  private deriveHdr(media: PlexMedia[]): MediaServerItem['hdr'] {
    const videoStream = media[0]?.parts?.[0]?.streams?.find((s) => s.streamType === 1);
    if (!videoStream) return undefined;
    if (videoStream.doviPresent) return 'dv';

    // parseMediaSources copies Jellyfin's ColorTransfer straight through, so the
    // same SMPTE identifiers Plex reports are available here.
    if (videoStream.colorTrc === 'smpte2084' || videoStream.colorTrc === 'arib-std-b67') {
      return 'hdr10';
    }

    const title = (videoStream.displayTitle || '').toLowerCase();
    if (title.includes('dolby vision') || /\bdv\b/.test(title)) return 'dv';
    if (title.includes('hdr10+')) return 'hdr10+';
    if (title.includes('hdr')) return 'hdr10';
    return 'none';
  }
}

export default JellyfinService;
