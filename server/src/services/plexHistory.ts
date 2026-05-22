import logger from '../utils/logger';
import settingsRepo from '../db/repositories/settings';
import plexUsersRepo from '../db/repositories/plexUsers';
import watchHistoryCache from '../db/repositories/watchHistoryCache';
import { PlexService } from './plex';
import { PlexUsersService } from './plexUsers';
import type { PlexHistoryEntry } from './plex';
import type { WatchHistoryProvider, WatchedStatus } from './watchHistory';

/**
 * PlexHistoryService — watch history sourced directly from the Plex server.
 *
 * Hits `/status/sessions/history/all` with the server-owner's token, which
 * returns every account's history (Maintainerr does the same). Account IDs
 * are mapped to usernames via the local `plex_users` table, populated by
 * PlexUsersService.
 *
 * Notes on account IDs:
 *   - The server owner's row uses accountID=1 locally; on plex.tv their id
 *     is something else. We always resolve via the local server's mapping
 *     and prefer the immutable plex.tv `username` over a possibly-edited
 *     display name (fixed in Maintainerr 2.0.2).
 *   - accountID=0 represents the "anyone" pseudo-account and is dropped.
 */
export class PlexHistoryService implements WatchHistoryProvider {
  private plex: PlexService;
  private usersService: PlexUsersService;
  private syncPromise: Promise<void> | null = null;
  private synced = false;
  private accountIdToUsername: Map<number, string> = new Map();

  constructor(plex: PlexService, usersService: PlexUsersService) {
    this.plex = plex;
    this.usersService = usersService;
  }

  async testConnection(): Promise<boolean> {
    return this.plex.testConnection();
  }

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
    const lookbackDays = parseInt(settingsRepo.getValue('watch_history_lookback_days') ?? '365', 10);
    watchHistoryCache.pruneOlderThan(lookbackDays);

    await this.refreshUserMap();

    const latestTimestamp = watchHistoryCache.getLatestTimestamp();
    const cachedCount = watchHistoryCache.getCount();

    let sinceUnix: number | undefined;
    if (latestTimestamp && cachedCount > 0) {
      sinceUnix = Math.floor(new Date(latestTimestamp).getTime() / 1000);
      logger.info(`Incremental Plex history sync from ${latestTimestamp} (${cachedCount} cached entries)`);
    } else {
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
      sinceUnix = Math.floor(lookbackDate.getTime() / 1000);
      logger.info(`Full Plex history sync — fetching ${lookbackDays} days of history`);
    }

    let totalInserted = 0;
    try {
      const entries = await this.plex.getWatchHistory({
        sinceUnix,
        onPage: (_page, fetched, total) => {
          onProgress?.(fetched, total ?? fetched);
        },
      });

      const cacheRows = entries
        .map((entry) => this.toCacheRow(entry))
        .filter((r): r is NonNullable<ReturnType<typeof this.toCacheRow>> => r !== null);

      totalInserted = watchHistoryCache.insertBatch(cacheRows);
      this.synced = true;
      logger.info(
        `Plex history sync complete: ${entries.length} fetched, ${totalInserted} new entries cached (${watchHistoryCache.getCount()} total)`
      );
    } catch (error) {
      logger.error('Plex history sync failed', { message: (error as Error).message });
      this.synced = true; // Don't block the scan
    }
  }

  private async refreshUserMap(): Promise<void> {
    let users = plexUsersRepo.findAll();
    if (users.length === 0) {
      // No local cache yet — pull fresh and persist so the dropdown also benefits.
      try {
        users = await this.usersService.syncUsers();
      } catch (error) {
        logger.warn('Plex history: failed to sync users for account mapping', {
          message: (error as Error).message,
        });
      }
    }

    this.accountIdToUsername.clear();
    for (const u of users) {
      const numeric = parseInt(u.plex_user_id, 10);
      if (!isNaN(numeric)) {
        this.accountIdToUsername.set(numeric, u.username);
      }
      if (u.is_owner) {
        // The owner's history rows always carry accountID=1 on the local
        // server, regardless of their plex.tv id. Pin that mapping too.
        this.accountIdToUsername.set(1, u.username);
      }
    }
  }

  private toCacheRow(entry: PlexHistoryEntry) {
    if (entry.accountID === 0) return null; // "anyone" placeholder
    const username = this.accountIdToUsername.get(entry.accountID);
    if (!username) return null;

    return {
      plex_rating_key: entry.ratingKey,
      username,
      watched: true,
      stopped_at: new Date(entry.viewedAt * 1000).toISOString(),
      session_id: `plex-${entry.historyKey}`,
      media_title: entry.title ?? null,
      media_type: entry.type,
      show_title: entry.grandparentTitle ?? null,
    };
  }

  async getItemWatchedStatus(ratingKey: string): Promise<WatchedStatus> {
    try {
      if (!this.synced) await this.prewarm();
      const entries = watchHistoryCache.getByRatingKey(ratingKey);
      const watchedBy = [...new Set(entries.map((e) => e.username))];
      const lastEntry = entries[0];
      return {
        playCount: entries.length,
        lastWatched: lastEntry ? new Date(lastEntry.stopped_at) : null,
        watchedBy,
      };
    } catch (error) {
      logger.error(`Failed to get Plex watched status for item ${ratingKey}`, {
        message: (error as Error).message,
      });
      return { playCount: 0, lastWatched: null, watchedBy: [] };
    }
  }

  async getShowWatchedStatus(showRatingKey: string, showTitle?: string): Promise<WatchedStatus> {
    try {
      if (!this.synced) await this.prewarm();
      let entries = watchHistoryCache.getByRatingKey(showRatingKey);
      const resolvedTitle = (entries.length > 0 ? entries[0]?.show_title : null) || showTitle;
      if (resolvedTitle) {
        const episodeEntries = watchHistoryCache.getByShowTitle(resolvedTitle);
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
      const lastEntry = entries.sort(
        (a, b) => new Date(b.stopped_at).getTime() - new Date(a.stopped_at).getTime()
      )[0];
      const watchedBy = [...new Set(entries.map((e) => e.username))];
      return {
        playCount: entries.length,
        lastWatched: lastEntry ? new Date(lastEntry.stopped_at) : null,
        watchedBy,
      };
    } catch (error) {
      logger.error(`Failed to get Plex watched status for show ${showRatingKey}`, {
        message: (error as Error).message,
      });
      return { playCount: 0, lastWatched: null, watchedBy: [] };
    }
  }

  clearCache(): void {
    this.synced = false;
  }
}

export default PlexHistoryService;
