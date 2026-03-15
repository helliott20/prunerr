import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';
import settingsRepo from '../db/repositories/settings';
import watchHistoryCache from '../db/repositories/watchHistoryCache';
import type { WatchHistoryProvider, WatchedStatus } from './watchHistory';

interface TracearrHealthResponse {
  status: string;
  servers: unknown[];
}

interface TracearrHistoryResponse {
  data: TracearrSessionHistory[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

interface TracearrSessionHistory {
  id: string;
  mediaTitle: string;
  mediaType: 'movie' | 'episode';
  showTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  year?: number;
  thumbPath?: string;
  watched: boolean;
  startedAt: string;
  stoppedAt: string;
  user: {
    username: string;
  };
  durationMs: number;
  progressMs: number;
}

/**
 * Extract Plex ratingKey from a Tracearr thumbPath.
 *
 * thumbPath format: /library/metadata/{ratingKey}/thumb/...
 */
function extractRatingKey(thumbPath: string | undefined): string | null {
  if (!thumbPath) return null;
  const parts = thumbPath.split('/');
  const metadataIndex = parts.indexOf('metadata');
  if (metadataIndex >= 0 && metadataIndex + 1 < parts.length) {
    return parts[metadataIndex + 1] || null;
  }
  return null;
}

export class TracearrService implements WatchHistoryProvider {
  private client: AxiosInstance;
  private syncPromise: Promise<void> | null = null;
  private synced = false;

  constructor(url: string, apiKey: string) {
    const baseUrl = url.replace(/\/$/, '');

    this.client = axios.create({
      baseURL: `${baseUrl}/api/v1/public`,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // Rate limiting retry
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] as string) || 5;
          logger.warn(`Tracearr rate limited, retrying after ${retryAfter}s`);
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
   * Test connection to Tracearr
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get<TracearrHealthResponse>('/health');
      const isValid = response.data.status === 'ok';
      if (isValid) {
        logger.info('Tracearr connection test successful', {
          servers: response.data.servers?.length ?? 0,
        });
      }
      return isValid;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Tracearr connection test failed', {
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Sync watch history from Tracearr to local DB cache.
   *
   * First sync: fetches all history within the configured lookback period.
   * Subsequent syncs: only fetches sessions newer than the latest cached entry.
   */
  async prewarm(onProgress?: (fetched: number, total: number) => void): Promise<void> {
    if (this.synced) return;
    if (this.syncPromise) {
      await this.syncPromise;
      return;
    }
    this.syncPromise = this._doSync(onProgress).finally(() => {
      this.syncPromise = null;
    });
    await this.syncPromise;
  }

  private async _doSync(onProgress?: (fetched: number, total: number) => void): Promise<void> {
    // Get history lookback setting (default 365 days)
    const lookbackDays = parseInt(settingsRepo.getValue('watch_history_lookback_days') ?? '365', 10);

    // Prune old entries beyond lookback
    watchHistoryCache.pruneOlderThan(lookbackDays);

    // Check if we have existing cached data
    const latestTimestamp = watchHistoryCache.getLatestTimestamp();
    const cachedCount = watchHistoryCache.getCount();

    let startDate: string;
    if (latestTimestamp && cachedCount > 0) {
      // Incremental sync — fetch only new sessions since last cached entry
      startDate = latestTimestamp;
      logger.info(`Incremental Tracearr sync from ${latestTimestamp} (${cachedCount} cached entries)`);
    } else {
      // Full sync — fetch all history within lookback period
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
      startDate = lookbackDate.toISOString();
      logger.info(`Full Tracearr sync — fetching ${lookbackDays} days of history`);
    }

    let page = 1;
    const pageSize = 100;
    let totalFetched = 0;
    let totalInserted = 0;
    let hasMore = true;

    try {
      while (hasMore) {
        const response = await this.client.get<TracearrHistoryResponse>('/history', {
          params: { page, pageSize, startDate },
        });

        const entries = response.data.data;
        const total = response.data.meta.total;

        if (!entries || entries.length === 0) {
          hasMore = false;
          break;
        }

        // Transform and insert into DB cache
        const cacheEntries = entries
          .map((entry) => {
            const ratingKey = extractRatingKey(entry.thumbPath);
            if (!ratingKey) return null;
            return {
              plex_rating_key: ratingKey,
              username: entry.user.username,
              watched: entry.watched,
              stopped_at: entry.stoppedAt,
              session_id: entry.id,
              media_title: entry.mediaTitle,
              media_type: entry.mediaType,
              show_title: entry.showTitle ?? null,
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);

        totalInserted += watchHistoryCache.insertBatch(cacheEntries);
        totalFetched += entries.length;

        logger.info(`Tracearr sync: ${totalFetched}/${total} sessions (page ${page})`);
        onProgress?.(totalFetched, total);

        if (totalFetched >= total) {
          hasMore = false;
        } else {
          page++;
          await this.delay(50);
        }
      }

      this.synced = true;
      logger.info(`Tracearr sync complete: ${totalFetched} fetched, ${totalInserted} new entries cached (${watchHistoryCache.getCount()} total)`);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Tracearr sync failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      // Mark as synced even on failure so we don't block the scan — use whatever is in cache
      this.synced = true;
    }
  }

  /**
   * Get watched status for a single item (movie or episode)
   */
  async getItemWatchedStatus(ratingKey: string): Promise<WatchedStatus> {
    try {
      if (!this.synced) await this.prewarm();

      const entries = watchHistoryCache.getByRatingKey(ratingKey);
      const playCount = entries.length;
      const watchedEntries = entries.filter((e) => e.watched);

      const lastWatchedEntry = watchedEntries[0]; // Already sorted DESC by stopped_at
      const watchedBy = [...new Set(entries.map((e) => e.username))];

      return {
        playCount,
        lastWatched: lastWatchedEntry ? new Date(lastWatchedEntry.stopped_at) : null,
        watchedBy,
      };
    } catch (error) {
      logger.error(`Failed to get Tracearr watched status for item ${ratingKey}`, {
        message: (error as Error).message,
      });
      return { playCount: 0, lastWatched: null, watchedBy: [] };
    }
  }

  /**
   * Get watched status for a TV show by aggregating all episode watches
   */
  async getShowWatchedStatus(showRatingKey: string, showTitle?: string): Promise<WatchedStatus> {
    try {
      if (!this.synced) await this.prewarm();

      // Try direct ratingKey first
      let entries = watchHistoryCache.getByRatingKey(showRatingKey);

      // Resolve show title and look up by that
      const resolvedTitle = (entries.length > 0 ? entries[0]?.show_title : null) || showTitle;
      if (resolvedTitle) {
        const episodeEntries = watchHistoryCache.getByShowTitle(resolvedTitle);
        // Merge without duplicates
        const seen = new Set(entries.map((e) => e.session_id));
        for (const ep of episodeEntries) {
          if (!seen.has(ep.session_id)) {
            entries.push(ep);
            seen.add(ep.session_id);
          }
        }
      }

      if (entries.length === 0) {
        return { playCount: 0, lastWatched: null, watchedBy: [] };
      }

      const playCount = entries.length;
      const watchedEntries = entries.filter((e) => e.watched);
      // Find most recent watched entry
      const lastWatchedEntry = watchedEntries.sort(
        (a, b) => new Date(b.stopped_at).getTime() - new Date(a.stopped_at).getTime()
      )[0];
      const watchedBy = [...new Set(entries.map((e) => e.username))];

      return {
        playCount,
        lastWatched: lastWatchedEntry ? new Date(lastWatchedEntry.stopped_at) : null,
        watchedBy,
      };
    } catch (error) {
      logger.error(`Failed to get Tracearr watched status for show ${showRatingKey}`, {
        message: (error as Error).message,
      });
      return { playCount: 0, lastWatched: null, watchedBy: [] };
    }
  }

  /**
   * Clear the synced flag so next scan will do an incremental fetch
   */
  clearCache(): void {
    this.synced = false;
    logger.debug('Tracearr sync flag cleared — will do incremental fetch on next scan');
  }
}

export default TracearrService;
