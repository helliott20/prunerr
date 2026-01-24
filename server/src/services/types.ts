// ============================================================================
// Plex Types
// ============================================================================

export interface PlexLibrary {
  key: string;
  title: string;
  type: 'movie' | 'show' | 'artist' | 'photo';
  agent: string;
  scanner: string;
  language: string;
  uuid: string;
  updatedAt: number;
  createdAt: number;
  scannedAt: number;
  contentChangedAt: number;
  hidden: boolean;
  location: string[];
}

export interface PlexMediaItem {
  ratingKey: string;
  key: string;
  guid: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  title: string;
  titleSort?: string;
  originalTitle?: string;
  contentRating?: string;
  summary?: string;
  rating?: number;
  audienceRating?: number;
  year?: number;
  tagline?: string;
  thumb?: string;
  art?: string;
  duration?: number;
  originallyAvailableAt?: string;
  addedAt: number;
  updatedAt: number;
  studio?: string;
  // For shows
  childCount?: number;
  leafCount?: number;
  viewedLeafCount?: number;
  // Watch data (from Plex)
  viewCount?: number;
  lastViewedAt?: number;
  // For episodes
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  index?: number;
  parentIndex?: number;
  // Media info
  media?: PlexMedia[];
  // Guids for matching
  guids?: PlexGuid[];
}

export interface PlexMedia {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  videoProfile: string;
  parts: PlexMediaPart[];
}

export interface PlexMediaPart {
  id: number;
  key: string;
  duration: number;
  file: string;
  size: number;
  container: string;
  videoProfile: string;
}

export interface PlexGuid {
  id: string; // e.g., "imdb://tt1234567", "tmdb://12345", "tvdb://12345"
}

// ============================================================================
// Tautulli Types
// ============================================================================

export interface TautulliHistory {
  referenceId: number;
  rowId: number;
  id: number;
  date: number;
  started: number;
  stopped: number;
  duration: number;
  pausedCounter: number;
  user: string;
  userId: number;
  friendlyName: string;
  platform: string;
  product: string;
  player: string;
  ipAddress: string;
  live: boolean;
  machineId: string;
  location: string;
  secure: boolean;
  relayed: boolean;
  mediaType: 'movie' | 'episode' | 'track';
  ratingKey: string;
  parentRatingKey: string;
  grandparentRatingKey: string;
  fullTitle: string;
  title: string;
  parentTitle: string;
  grandparentTitle: string;
  originalTitle: string;
  year: number;
  mediaIndex: number;
  parentMediaIndex: number;
  thumb: string;
  originallyAvailableAt: string;
  guid: string;
  transcode: boolean;
  percentComplete: number;
  watchedStatus: number; // 0 = not watched, 1 = watching, 2 = watched
  groupCount: number;
  groupIds: string;
  state: string | null;
  sessionKey: string | null;
}

export interface TautulliWatchedStatus {
  lastWatched: Date | null;
  playCount: number;
  watchedBy: string[];
}

export interface TautulliLibraryStats {
  sectionId: number;
  sectionName: string;
  sectionType: string;
  count: number;
  parentCount?: number;
  childCount?: number;
  lastAccessed?: number;
  lastPlayed?: string;
  totalDuration: number;
  totalSize: number;
}

export interface TautulliApiResponse<T> {
  response: {
    result: 'success' | 'error';
    message: string | null;
    data: T;
  };
}

// ============================================================================
// Sonarr Types
// ============================================================================

export interface SonarrSeries {
  id: number;
  title: string;
  alternateTitles?: SonarrAlternateTitle[];
  sortTitle: string;
  status: 'continuing' | 'ended' | 'upcoming' | 'deleted';
  ended: boolean;
  overview?: string;
  previousAiring?: string;
  network?: string;
  airTime?: string;
  images: SonarrImage[];
  seasons: SonarrSeason[];
  year: number;
  path: string;
  qualityProfileId: number;
  languageProfileId: number;
  seasonFolder: boolean;
  monitored: boolean;
  useSceneNumbering: boolean;
  runtime: number;
  tvdbId: number;
  tvRageId: number;
  tvMazeId: number;
  imdbId?: string;
  firstAired?: string;
  seriesType: 'standard' | 'daily' | 'anime';
  cleanTitle: string;
  titleSlug: string;
  rootFolderPath?: string;
  certification?: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: SonarrRatings;
  statistics: SonarrStatistics;
}

export interface SonarrAlternateTitle {
  title: string;
  seasonNumber?: number;
}

export interface SonarrImage {
  coverType: 'banner' | 'poster' | 'fanart';
  url: string;
  remoteUrl?: string;
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: SonarrSeasonStatistics;
}

export interface SonarrSeasonStatistics {
  previousAiring?: string;
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  sizeOnDisk: number;
  percentOfEpisodes: number;
}

export interface SonarrRatings {
  votes: number;
  value: number;
}

export interface SonarrStatistics {
  seasonCount: number;
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  sizeOnDisk: number;
  percentOfEpisodes: number;
}

export interface SonarrEpisode {
  id: number;
  seriesId: number;
  tvdbId: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string;
  airDateUtc?: string;
  overview?: string;
  hasFile: boolean;
  monitored: boolean;
  absoluteEpisodeNumber?: number;
  sceneAbsoluteEpisodeNumber?: number;
  sceneEpisodeNumber?: number;
  sceneSeasonNumber?: number;
  unverifiedSceneNumbering: boolean;
  grabbed: boolean;
}

export interface SonarrEpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  sceneName?: string;
  releaseGroup?: string;
  language: SonarrLanguage;
  quality: SonarrQualityInfo;
  mediaInfo?: SonarrMediaInfo;
  qualityCutoffNotMet: boolean;
}

export interface SonarrLanguage {
  id: number;
  name: string;
}

export interface SonarrQualityInfo {
  quality: {
    id: number;
    name: string;
    source: string;
    resolution: number;
  };
  revision: {
    version: number;
    real: number;
    isRepack: boolean;
  };
}

export interface SonarrMediaInfo {
  audioBitrate: number;
  audioChannels: number;
  audioCodec: string;
  audioLanguages: string;
  audioStreamCount: number;
  videoBitDepth: number;
  videoBitrate: number;
  videoCodec: string;
  videoFps: number;
  resolution: string;
  runTime: string;
  scanType: string;
  subtitles: string;
}

// ============================================================================
// Radarr Types
// ============================================================================

export interface RadarrMovie {
  id: number;
  title: string;
  originalTitle?: string;
  originalLanguage: RadarrLanguage;
  alternateTitles?: RadarrAlternateTitle[];
  sortTitle: string;
  sizeOnDisk: number;
  status: 'tba' | 'announced' | 'inCinemas' | 'released' | 'deleted';
  overview?: string;
  inCinemas?: string;
  physicalRelease?: string;
  digitalRelease?: string;
  images: RadarrImage[];
  website?: string;
  year: number;
  hasFile: boolean;
  youTubeTrailerId?: string;
  studio?: string;
  path: string;
  qualityProfileId: number;
  monitored: boolean;
  minimumAvailability: 'tba' | 'announced' | 'inCinemas' | 'released';
  isAvailable: boolean;
  folderName: string;
  runtime: number;
  cleanTitle: string;
  imdbId?: string;
  tmdbId: number;
  titleSlug: string;
  certification?: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: RadarrRatings;
  movieFile?: RadarrMovieFile;
  collection?: RadarrCollection;
  popularity: number;
}

export interface RadarrLanguage {
  id: number;
  name: string;
}

export interface RadarrAlternateTitle {
  sourceType: string;
  movieMetadataId: number;
  title: string;
  sourceId: number;
  votes: number;
  voteCount: number;
  language: RadarrLanguage;
}

export interface RadarrImage {
  coverType: 'poster' | 'fanart' | 'screenshot';
  url: string;
  remoteUrl?: string;
}

export interface RadarrRatings {
  imdb?: {
    votes: number;
    value: number;
    type: string;
  };
  tmdb?: {
    votes: number;
    value: number;
    type: string;
  };
  metacritic?: {
    votes: number;
    value: number;
    type: string;
  };
  rottenTomatoes?: {
    votes: number;
    value: number;
    type: string;
  };
}

export interface RadarrCollection {
  name: string;
  tmdbId: number;
  images: RadarrImage[];
}

export interface RadarrMovieFile {
  id: number;
  movieId: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string;
  sceneName?: string;
  releaseGroup?: string;
  edition?: string;
  languages: RadarrLanguage[];
  quality: RadarrQualityInfo;
  mediaInfo?: RadarrMediaInfo;
  originalFilePath?: string;
  qualityCutoffNotMet: boolean;
}

export interface RadarrQualityInfo {
  quality: {
    id: number;
    name: string;
    source: string;
    resolution: number;
    modifier: string;
  };
  revision: {
    version: number;
    real: number;
    isRepack: boolean;
  };
}

export interface RadarrMediaInfo {
  audioBitrate: number;
  audioChannels: number;
  audioCodec: string;
  audioLanguages: string;
  audioStreamCount: number;
  videoBitDepth: number;
  videoBitrate: number;
  videoCodec: string;
  videoFps: number;
  resolution: string;
  runTime: string;
  scanType: string;
  subtitles: string;
}

// ============================================================================
// Overseerr Types
// ============================================================================

export interface OverseerrRequest {
  id: number;
  status: OverseerrRequestStatus;
  createdAt: string;
  updatedAt: string;
  type: 'movie' | 'tv';
  is4k: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  languageProfileId?: number;
  tags?: number[];
  media: OverseerrMedia;
  requestedBy: OverseerrUser;
  modifiedBy?: OverseerrUser;
  seasons?: OverseerrSeasonRequest[];
}

export type OverseerrRequestStatus =
  | 1  // Pending Approval
  | 2  // Approved
  | 3  // Declined
  | 4  // Available
  | 5; // Partially Available (TV only)

export interface OverseerrMedia {
  id: number;
  tmdbId: number;
  tvdbId?: number;
  imdbId?: string;
  status: OverseerrMediaStatus;
  status4k?: OverseerrMediaStatus;
  createdAt: string;
  updatedAt: string;
  mediaType: 'movie' | 'tv';
  serviceId?: number;
  serviceId4k?: number;
  externalServiceId?: number;
  externalServiceId4k?: number;
  externalServiceSlug?: string;
  externalServiceSlug4k?: string;
  ratingKey?: string;
  ratingKey4k?: string;
}

export type OverseerrMediaStatus =
  | 1  // Unknown
  | 2  // Pending
  | 3  // Processing
  | 4  // Partially Available
  | 5; // Available

export interface OverseerrUser {
  id: number;
  email?: string;
  username?: string;
  plexToken?: string;
  plexUsername?: string;
  userType: number;
  permissions: number;
  avatar: string;
  createdAt: string;
  updatedAt: string;
  requestCount: number;
  displayName: string;
}

export interface OverseerrSeasonRequest {
  id: number;
  seasonNumber: number;
  status: OverseerrRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OverseerrApiResponse<T> {
  pageInfo?: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results?: T[];
}

// ============================================================================
// Scanner Types
// ============================================================================

export interface ScanResult {
  success: boolean;
  startedAt: Date;
  completedAt: Date;
  itemsScanned: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsFlagged: number;
  errors: ScanError[];
}

export interface ScanError {
  message: string;
  service: 'plex' | 'tautulli' | 'sonarr' | 'radarr' | 'overseerr' | 'database';
  itemTitle?: string;
  stack?: string;
}

export interface MatchedArrData {
  sonarrId?: number;
  sonarrSeries?: SonarrSeries;
  radarrId?: number;
  radarrMovie?: RadarrMovie;
}

export interface SyncedMediaData {
  plexItem: PlexMediaItem;
  tautulliData?: TautulliWatchedStatus;
  arrData?: MatchedArrData;
  overseerrData?: {
    requestedBy: string | null;
    request: OverseerrRequest | null;
  };
}
