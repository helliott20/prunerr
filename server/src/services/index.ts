// Service exports
export { PlexService } from './plex';
export { TautulliService } from './tautulli';
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
