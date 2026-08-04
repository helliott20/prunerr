/**
 * Media server abstraction.
 *
 * Prunerr originally spoke only Plex, so Plex's data shapes (`PlexLibrary`,
 * `PlexMediaItem`) had already become the de-facto interchange format for the
 * scanner, the rules engine and the database layer. Rather than re-model
 * thousands of lines of downstream mapping, those shapes are promoted here to
 * the *canonical* format and every other backend adapts into them.
 *
 * That means:
 *   - Plex's adapter is a pass-through (no translation cost).
 *   - Jellyfin/Emby translate their own payloads into these shapes once, at the
 *     edge, and nothing downstream needs to know which server is in use.
 *
 * The aliases below exist so new code can use provider-neutral names without a
 * churny rename of the existing `Plex*` types.
 */

import type { PlexLibrary, PlexMediaItem } from '../types';

/** Which backend a `MediaServerService` talks to. */
export type MediaServerType = 'plex' | 'jellyfin' | 'emby';

export const MEDIA_SERVER_TYPES: readonly MediaServerType[] = ['plex', 'jellyfin', 'emby'] as const;

export function isMediaServerType(value: unknown): value is MediaServerType {
  return typeof value === 'string' && (MEDIA_SERVER_TYPES as readonly string[]).includes(value);
}

/** Human-readable name, for logs and the UI. */
export const MEDIA_SERVER_LABELS: Record<MediaServerType, string> = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
};

/** A library/section on the media server. Canonical shape (see file header). */
export type MediaServerLibrary = PlexLibrary;

/** A single media item. Canonical shape (see file header). */
export type MediaServerItem = PlexMediaItem;

/**
 * One playback event. Plex returns these natively from its history endpoint;
 * Jellyfin/Emby synthesise them from per-user `UserData` (see JellyfinService).
 */
export interface MediaServerHistoryEntry {
  /** Stable per-event id, used to dedupe rows in `watch_history_cache`. */
  historyKey: string;
  /** The item's id on the media server (Plex ratingKey / Jellyfin item GUID). */
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  type: string;
  /**
   * The account that watched it. Plex uses numeric account ids; Jellyfin/Emby
   * use GUIDs, so this is a string and callers must not assume it parses as a
   * number. `accountKey` is matched against `plex_users.plex_user_id`.
   */
  accountKey: string;
  /** Unix seconds. */
  viewedAt: number;
  title?: string;
  grandparentTitle?: string;
}

export interface GetWatchHistoryOptions {
  /** Only return events at or after this Unix timestamp (seconds). */
  sinceUnix?: number;
  pageSize?: number;
  /** Called per page so long syncs can report progress. `total` is null if unknown. */
  onPage?: (page: MediaServerHistoryEntry[], fetched: number, total: number | null) => void;
}

/**
 * The complete surface the rest of Prunerr uses to talk to a media server.
 *
 * Deliberately small — it is exactly what the scanner, the health check and the
 * library routes already needed from `PlexService`. Adding a backend means
 * implementing these seven methods and nothing else.
 */
export interface MediaServerService {
  /** Which backend this instance talks to. */
  readonly serverType: MediaServerType;

  /** True if the server is reachable and the credentials are valid. */
  testConnection(): Promise<boolean>;

  /** All libraries/sections, including ones the user has chosen to exclude. */
  getLibraries(): Promise<MediaServerLibrary[]>;

  /** Every top-level item in a library (movies, or shows — not episodes). */
  getLibraryItems(libraryId: string): Promise<MediaServerItem[]>;

  /** Full metadata for one item, including media/parts and stream details. */
  getItemMetadata(itemId: string): Promise<MediaServerItem>;

  /** Playback events across all accounts on the server. */
  getWatchHistory(options?: GetWatchHistoryOptions): Promise<MediaServerHistoryEntry[]>;

  /** Ask the server to rescan a library. Best-effort; errors propagate. */
  refreshLibrary(libraryId: string): Promise<void>;

  /**
   * Turn a poster/art path from `MediaServerItem.thumb` into a fetchable URL,
   * including whatever auth the backend needs. Returns '' for empty input.
   */
  getImageUrl(path: string): string;
}

/** A user account on the media server. */
export interface MediaServerUser {
  /** Server-native id. Numeric string for Plex, GUID for Jellyfin/Emby. */
  id: string;
  username: string;
  email?: string | null;
  thumbUrl?: string | null;
  isOwner: boolean;
  isHomeUser: boolean;
}

/** Backends that can enumerate their accounts. */
export interface MediaServerUsersService {
  fetchUsers(): Promise<MediaServerUser[]>;
}
