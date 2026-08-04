import logger from '../utils/logger';
import settingsRepo from '../db/repositories/settings';
import plexUsersRepo from '../db/repositories/plexUsers';
import watchHistoryCache from '../db/repositories/watchHistoryCache';
import { syncMediaServerUsers } from './mediaServerUsers';
import type {
  MediaServerHistoryEntry,
  MediaServerService,
  MediaServerUsersService,
} from './mediaServer/types';
import { MEDIA_SERVER_LABELS } from './mediaServer/types';
import type { WatchHistoryProvider, WatchedStatus } from './watchHistory';

/**
 * MediaServerHistoryService — watch history sourced directly from the media
 * server, for any supported backend.
 *
 * Plex serves `/status/sessions/history/all` with the owner's token, which
 * returns every account's history. Jellyfin/Emby either expose the Playback
 * Reporting plugin's event log or synthesise events from per-user watch state
 * (see `JellyfinService`). Either way the entries arrive here in the same
 * shape and are cached in `watch_history_cache`.
 *
 * Account ids are mapped to usernames via the local users table, populated by
 * the backend's users service.
 *
 * Notes on account ids:
 *   - Plex: the server owner's history rows always carry accountID=1 on the
 *     local server regardless of their plex.tv id, so that mapping is pinned
 *     explicitly. accountID=0 is the "anyone" pseudo-account and is dropped.
 *     The immutable plex.tv username is preferred over a possibly-edited
 *     display name (as Maintainerr does since 2.0.2).
 *   - Jellyfin/Emby: ids are GUIDs and map straight through, so neither the
 *     owner pin nor the "anyone" filter applies.
 */
export class MediaServerHistoryService implements WatchHistoryProvider {
  private server: MediaServerService;
  private usersService: MediaServerUsersService;
  private syncPromise: Promise<void> | null = null;
  private synced = false;
  private accountKeyToUsername: Map<string, string> = new Map();

  constructor(server: MediaServerService, usersService: MediaServerUsersService) {
    this.server = server;
    this.usersService = usersService;
  }

  private get label(): string {
    return MEDIA_SERVER_LABELS[this.server.serverType];
  }

  async testConnection(): Promise<boolean> {
    return this.server.testConnection();
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
      logger.info(`Incremental ${this.label} history sync from ${latestTimestamp} (${cachedCount} cached entries)`);
    } else {
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
      sinceUnix = Math.floor(lookbackDate.getTime() / 1000);
      logger.info(`Full ${this.label} history sync — fetching ${lookbackDays} days of history`);
    }

    let totalInserted = 0;
    try {
      const entries = await this.server.getWatchHistory({
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
        `${this.label} history sync complete: ${entries.length} fetched, ${totalInserted} new entries cached (${watchHistoryCache.getCount()} total)`
      );
    } catch (error) {
      logger.error(`${this.label} history sync failed`, { message: (error as Error).message });
      this.synced = true; // Don't block the scan
    }
  }

  private async refreshUserMap(): Promise<void> {
    let users = plexUsersRepo.findAll();
    if (users.length === 0) {
      // No local cache yet — pull fresh and persist so the dropdown also benefits.
      try {
        users = await syncMediaServerUsers(this.usersService, this.label);
      } catch (error) {
        logger.warn(`${this.label} history: failed to sync users for account mapping`, {
          message: (error as Error).message,
        });
      }
    }

    this.accountKeyToUsername.clear();
    for (const u of users) {
      this.accountKeyToUsername.set(u.plex_user_id, u.username);

      if (u.is_owner && this.server.serverType === 'plex') {
        // The owner's history rows always carry accountID=1 on the local Plex
        // server, regardless of their plex.tv id. Pin that mapping too.
        this.accountKeyToUsername.set('1', u.username);
      }
    }
  }

  private toCacheRow(entry: MediaServerHistoryEntry) {
    // Plex's "anyone" placeholder account; not a real viewer.
    if (this.server.serverType === 'plex' && entry.accountKey === '0') return null;

    const username = this.accountKeyToUsername.get(entry.accountKey);
    if (!username) return null;

    return {
      plex_rating_key: entry.ratingKey,
      username,
      watched: true,
      stopped_at: new Date(entry.viewedAt * 1000).toISOString(),
      session_id: `${this.server.serverType}-${entry.historyKey}`,
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
      logger.error(`Failed to get ${this.label} watched status for item ${ratingKey}`, {
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
      logger.error(`Failed to get ${this.label} watched status for show ${showRatingKey}`, {
        message: (error as Error).message,
      });
      return { playCount: 0, lastWatched: null, watchedBy: [] };
    }
  }

  clearCache(): void {
    this.synced = false;
  }
}

export default MediaServerHistoryService;
