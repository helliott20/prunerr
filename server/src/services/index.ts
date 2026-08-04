// Service exports
export { PlexService } from './plex';
export { JellyfinService } from './jellyfin';
export { TautulliService } from './tautulli';

// Media server abstraction (Plex / Jellyfin / Emby)
export {
  createMediaServer,
  createMediaServerUsers,
  createConfiguredMediaServer,
  getConfiguredServerType,
  getMediaServerCredentials,
  getMediaServerLabel,
  MEDIA_SERVER_LABELS,
  MEDIA_SERVER_TYPES,
  isMediaServerType,
} from './mediaServer';
export type {
  MediaServerType,
  MediaServerService,
  MediaServerLibrary,
  MediaServerItem,
  MediaServerHistoryEntry,
  MediaServerUser,
  MediaServerUsersService,
  GetWatchHistoryOptions,
} from './mediaServer';
export { MediaServerHistoryService } from './mediaServerHistory';
export { syncMediaServerUsers } from './mediaServerUsers';
export { TracearrService } from './tracearr';
export { SonarrService } from './sonarr';
export { RadarrService } from './radarr';
export { OverseerrService } from './overseerr';
export { ScannerService } from './scanner';
export { UnraidService } from './unraid';
export type {
  UnraidCapacity,
  UnraidDisk,
  UnraidCache,
  UnraidParity,
  UnraidArray,
  UnraidArrayStats,
} from './unraid';
export {
  DeletionService,
  getDeletionService,
  createDeletionService,
  DeletionAction,
} from './deletion';
export type {
  DeletionQueueItem,
  DeletionHistoryEntry,
  DeletionServiceDependencies,
} from './deletion';

// Watch History Provider
export type { WatchHistoryProvider, WatchedStatus } from './watchHistory';

// Type exports
export type {
  // Plex types
  PlexLibrary,
  PlexMediaItem,
  PlexMedia,
  PlexMediaPart,
  PlexGuid,
  // Tautulli types
  TautulliHistory,
  TautulliWatchedStatus,
  TautulliLibraryStats,
  TautulliApiResponse,
  // Sonarr types
  SonarrSeries,
  SonarrAlternateTitle,
  SonarrImage,
  SonarrSeason,
  SonarrSeasonStatistics,
  SonarrRatings,
  SonarrStatistics,
  SonarrEpisode,
  SonarrEpisodeFile,
  SonarrLanguage,
  SonarrQualityInfo,
  SonarrMediaInfo,
  // Radarr types
  RadarrMovie,
  RadarrLanguage,
  RadarrAlternateTitle,
  RadarrImage,
  RadarrRatings,
  RadarrCollection,
  RadarrMovieFile,
  RadarrQualityInfo,
  RadarrMediaInfo,
  // Overseerr types
  OverseerrRequest,
  OverseerrRequestStatus,
  OverseerrMedia,
  OverseerrMediaStatus,
  OverseerrUser,
  OverseerrSeasonRequest,
  OverseerrApiResponse,
  // Scanner types
  ScanResult,
  ScanError,
  MatchedArrData,
  SyncedMediaData,
} from './types';
