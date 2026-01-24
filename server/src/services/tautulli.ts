import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';
import type {
  TautulliHistory,
  TautulliWatchedStatus,
  TautulliLibraryStats,
  TautulliApiResponse,
} from './types';

interface TautulliHistoryResponse {
  recordsFiltered: number;
  recordsTotal: number;
  data: TautulliHistoryItem[];
  draw: number;
  filter_duration: string;
  total_duration: string;
}

interface TautulliHistoryItem {
  reference_id: number;
  row_id: number;
  id: number;
  date: number;
  started: number;
  stopped: number;
  duration: number;
  paused_counter: number;
  user: string;
  user_id: number;
  friendly_name: string;
  platform: string;
  product: string;
  player: string;
  ip_address: string;
  live: number;
  machine_id: string;
  location: string;
  secure: number;
  relayed: number;
  media_type: string;
  rating_key: string;
  parent_rating_key: string;
  grandparent_rating_key: string;
  full_title: string;
  title: string;
  parent_title: string;
  grandparent_title: string;
  original_title: string;
  year: number;
  media_index: number;
  parent_media_index: number;
  thumb: string;
  originally_available_at: string;
  guid: string;
  transcode_decision: string;
  percent_complete: number;
  watched_status: number;
  group_count: number;
  group_ids: string;
  state: string | null;
  session_key: string | null;
}

interface TautulliLibraryStatsItem {
  section_id: number;
  section_name: string;
  section_type: string;
  count: number;
  parent_count?: number;
  child_count?: number;
  last_accessed?: number;
  last_played?: string;
  total_duration: number;
  total_size: number;
}

export class TautulliService {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(url: string, apiKey: string) {
    const baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;

    this.client = axios.create({
      baseURL: `${baseUrl}/api/v2`,
      timeout: 30000,
    });

    // Add response interceptor for rate limiting
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] as string) || 5;
          logger.warn(`Tautulli rate limited, retrying after ${retryAfter}s`);
          await this.delay(retryAfter * 1000);
          return this.client.request(error.config!);
        }
        throw error;
      }
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Make API request with cmd parameter
   */
  private async request<T>(cmd: string, params: Record<string, string | number> = {}): Promise<T> {
    const response = await this.client.get<TautulliApiResponse<T>>('', {
      params: {
        apikey: this.apiKey,
        cmd,
        ...params,
      },
    });

    if (response.data.response.result !== 'success') {
      throw new Error(response.data.response.message || `Tautulli API error for cmd: ${cmd}`);
    }

    return response.data.response.data;
  }

  /**
   * Test connection to Tautulli
   */
  async testConnection(): Promise<boolean> {
    try {
      // Log the request URL for debugging
      const requestUrl = `${this.client.defaults.baseURL}?apikey=${this.apiKey.substring(0, 4)}***&cmd=get_server_info`;
      logger.info('Testing Tautulli connection', { url: requestUrl });

      const data = await this.request<{ pms_name: string }>('get_server_info');
      const isValid = !!data.pms_name;

      if (isValid) {
        logger.info('Tautulli connection test successful', { server: data.pms_name });
      }

      return isValid;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Tautulli connection test failed', {
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        message: axiosError.message,
        responseData: axiosError.response?.data,
        url: axiosError.config?.url,
        baseURL: axiosError.config?.baseURL,
      });
      return false;
    }
  }

  /**
   * Get watch history for a specific item
   */
  async getHistory(ratingKey: string): Promise<TautulliHistory[]> {
    try {
      const data = await this.request<TautulliHistoryResponse>('get_history', {
        rating_key: ratingKey,
        length: 1000, // Get all history for this item
      });

      const history = this.parseHistoryItems(data.data || []);
      logger.debug(`Retrieved ${history.length} history entries for item ${ratingKey}`);
      return history;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get history for item ${ratingKey}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get watched status summary for an item
   */
  async getItemWatchedStatus(ratingKey: string): Promise<TautulliWatchedStatus> {
    try {
      const history = await this.getHistory(ratingKey);

      // Find the most recent watch
      const watchedEntries = history.filter((h) => h.watchedStatus === 2);
      const lastWatchedEntry = watchedEntries.sort((a, b) => b.stopped - a.stopped)[0];

      // Get unique users who watched
      const watchedBy = [...new Set(history.map((h) => h.friendlyName))];

      // Count total plays
      const playCount = history.length;

      return {
        lastWatched: lastWatchedEntry ? new Date(lastWatchedEntry.stopped * 1000) : null,
        playCount,
        watchedBy,
      };
    } catch (error) {
      logger.error(`Failed to get watched status for item ${ratingKey}`, {
        message: (error as Error).message,
      });
      // Return empty status on error instead of throwing
      return {
        lastWatched: null,
        playCount: 0,
        watchedBy: [],
      };
    }
  }

  /**
   * Get recently watched items
   */
  async getRecentlyWatched(days: number = 30): Promise<TautulliHistory[]> {
    try {
      const afterDate = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

      const data = await this.request<TautulliHistoryResponse>('get_history', {
        length: 5000,
        after: afterDate,
      });

      const history = this.parseHistoryItems(data.data || []);
      logger.info(`Retrieved ${history.length} recently watched items from last ${days} days`);
      return history;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get recently watched items', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get library statistics
   */
  async getLibraryStats(): Promise<TautulliLibraryStats[]> {
    try {
      const data = await this.request<TautulliLibraryStatsItem[]>('get_libraries');

      const stats: TautulliLibraryStats[] = (data || []).map((lib) => ({
        sectionId: lib.section_id,
        sectionName: lib.section_name,
        sectionType: lib.section_type,
        count: lib.count,
        parentCount: lib.parent_count,
        childCount: lib.child_count,
        lastAccessed: lib.last_accessed,
        lastPlayed: lib.last_played,
        totalDuration: lib.total_duration,
        totalSize: lib.total_size,
      }));

      logger.info(`Retrieved stats for ${stats.length} libraries from Tautulli`);
      return stats;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get library stats from Tautulli', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get history for a show (all episodes)
   */
  async getShowHistory(grandparentRatingKey: string): Promise<TautulliHistory[]> {
    try {
      const data = await this.request<TautulliHistoryResponse>('get_history', {
        grandparent_rating_key: grandparentRatingKey,
        length: 5000,
      });

      const history = this.parseHistoryItems(data.data || []);
      logger.debug(`Retrieved ${history.length} history entries for show ${grandparentRatingKey}`);
      return history;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get history for show ${grandparentRatingKey}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get watched status summary for a TV show (uses grandparent_rating_key to find all episode watches)
   */
  async getShowWatchedStatus(showRatingKey: string): Promise<TautulliWatchedStatus> {
    try {
      // Use grandparent_rating_key to get all episode watches for this show
      const history = await this.getShowHistory(showRatingKey);

      // Find the most recent watch
      const watchedEntries = history.filter((h) => h.watchedStatus === 2);
      const lastWatchedEntry = watchedEntries.sort((a, b) => b.stopped - a.stopped)[0];

      // Get unique users who watched
      const watchedBy = [...new Set(history.map((h) => h.friendlyName))];

      // Count total plays (all episode watches)
      const playCount = history.length;

      logger.debug(`Show ${showRatingKey} watch status: ${playCount} plays, ${watchedBy.length} users`);

      return {
        lastWatched: lastWatchedEntry ? new Date(lastWatchedEntry.stopped * 1000) : null,
        playCount,
        watchedBy,
      };
    } catch (error) {
      logger.error(`Failed to get watched status for show ${showRatingKey}`, {
        message: (error as Error).message,
      });
      // Return empty status on error instead of throwing
      return {
        lastWatched: null,
        playCount: 0,
        watchedBy: [],
      };
    }
  }

  /**
   * Parse raw history items to typed format
   */
  private parseHistoryItems(items: TautulliHistoryItem[]): TautulliHistory[] {
    return items.map((item) => ({
      referenceId: item.reference_id,
      rowId: item.row_id,
      id: item.id,
      date: item.date,
      started: item.started,
      stopped: item.stopped,
      duration: item.duration,
      pausedCounter: item.paused_counter,
      user: item.user,
      userId: item.user_id,
      friendlyName: item.friendly_name,
      platform: item.platform,
      product: item.product,
      player: item.player,
      ipAddress: item.ip_address,
      live: item.live === 1,
      machineId: item.machine_id,
      location: item.location,
      secure: item.secure === 1,
      relayed: item.relayed === 1,
      mediaType: item.media_type as TautulliHistory['mediaType'],
      ratingKey: item.rating_key,
      parentRatingKey: item.parent_rating_key,
      grandparentRatingKey: item.grandparent_rating_key,
      fullTitle: item.full_title,
      title: item.title,
      parentTitle: item.parent_title,
      grandparentTitle: item.grandparent_title,
      originalTitle: item.original_title,
      year: item.year,
      mediaIndex: item.media_index,
      parentMediaIndex: item.parent_media_index,
      thumb: item.thumb,
      originallyAvailableAt: item.originally_available_at,
      guid: item.guid,
      transcode: item.transcode_decision !== 'direct play',
      percentComplete: item.percent_complete,
      watchedStatus: item.watched_status,
      groupCount: item.group_count,
      groupIds: item.group_ids,
      state: item.state,
      sessionKey: item.session_key,
    }));
  }
}

export default TautulliService;
