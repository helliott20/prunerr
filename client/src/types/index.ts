// Media Types
export type MediaType = 'movie' | 'tv';
export type MediaStatus = 'active' | 'queued' | 'protected' | 'deleted';

export interface MediaItem {
  id: string;
  title: string;
  type: MediaType;
  year?: number;
  size: number;
  posterUrl?: string;
  watched: boolean;
  lastWatched?: string;
  addedAt: string;
  status: MediaStatus;
  isProtected: boolean;
  plexId?: string;
  sonarrId?: number;
  radarrId?: number;
  /** TVDB ID for TV shows */
  tvdbId?: number;
  /** TMDB ID for movies and shows */
  tmdbId?: number;
  /** IMDB ID (e.g., tt1234567) */
  imdbId?: string;
  playCount?: number;
  watchedBy?: string[];
  resolution?: string;
  codec?: string;
}

// Library
export interface LibraryFilters {
  search?: string;
  page: number;
  limit: number;
  type?: MediaType;
  status?: 'watched' | 'unwatched' | 'queued';
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export interface LibraryResponse {
  items: MediaItem[];
  total: number;
  page: number;
  totalPages: number;
}

// Deletion Actions
export type DeletionAction =
  | 'unmonitor_only'
  | 'delete_files_only'
  | 'unmonitor_and_delete'
  | 'full_removal';

export const DELETION_ACTION_LABELS: Record<DeletionAction, string> = {
  unmonitor_only: 'Unmonitor Only (keep files)',
  delete_files_only: 'Delete Files Only',
  unmonitor_and_delete: 'Unmonitor & Delete Files',
  full_removal: 'Full Removal (delete everything)',
};

export const DELETION_ACTION_DESCRIPTIONS: Record<DeletionAction, string> = {
  unmonitor_only: 'Stop monitoring the item but keep all files and metadata intact',
  delete_files_only: 'Delete the media files but keep the item in Sonarr/Radarr for re-download',
  unmonitor_and_delete: 'Unmonitor and delete files, but keep metadata in Sonarr/Radarr',
  full_removal: 'Completely remove from Sonarr/Radarr including all metadata',
};

// Rules
export type ConditionType =
  | 'unwatched_days'
  | 'last_watched_days'
  | 'size_greater'
  | 'added_before';

export interface RuleCondition {
  type?: ConditionType;
  field?: string;  // New format uses field instead of type
  operator?: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'not_contains';
  value: string | number | boolean;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  mediaType: 'all' | MediaType;
  conditions: RuleCondition[];
  gracePeriodDays: number;
  deletionAction?: DeletionAction;
  resetOverseerr?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Queue
export interface QueueItem {
  id: string;
  mediaItemId: string;
  title: string;
  type: MediaType;
  size: number;
  posterUrl?: string;
  queuedAt: string;
  deleteAt: string;
  matchedRule?: string;
  ruleId?: string;
  daysRemaining?: number;
  deletionAction: DeletionAction;
  deletionActionLabel: string;
  resetOverseerr: boolean;
  requestedBy?: string;
  tmdbId?: number;
  overseerrResetAt?: string;
}

// History
export interface HistoryItem {
  id: string;
  title: string;
  type: MediaType;
  year?: number;
  size: number;
  deletedAt: string;
  deletionReason: 'rule' | 'manual';
  matchedRule?: string;
  ruleId?: string;
  deletionAction?: DeletionAction;
  overseerrReset?: boolean;
  tmdbId?: number;
}

export interface HistoryFilters {
  search?: string;
  page: number;
  limit: number;
  dateRange: 'all' | '7d' | '30d' | '90d';
}

export interface HistoryResponse {
  items: HistoryItem[];
  total: number;
  stats: {
    totalDeleted: number;
    totalSpaceReclaimed: number;
  };
}

// Stats
export interface DashboardStats {
  totalStorage: number;
  usedStorage: number;
  reclaimableSpace: number;
  movieCount: number;
  tvShowCount: number;
  tvEpisodeCount: number;
  unwatchedMovies: number;
  unwatchedShows: number;
  itemsMarkedForDeletion: number;
  scannedToday: number;
  scanTrend: number;
  reclaimedThisWeek: number;
  reclaimedTrend: number;
  activeRules: number;
}

export interface Activity {
  id: string;
  type: 'scan' | 'delete' | 'rule' | 'restore';
  message: string;
  timestamp: string;
}

export interface UpcomingDeletion {
  id: string;
  title: string;
  type: MediaType;
  size: number;
  deleteAt: string;
}

export interface Recommendation {
  id: string;
  title: string;
  type: MediaType;
  size: number;
  posterUrl?: string;
  lastWatched?: string;
  daysSinceWatched?: number;
  neverWatched: boolean;
  addedAt: string;
  playCount: number;
  reason: string;
}

export interface RecommendationsResponse {
  items: Recommendation[];
  total: number;
  totalReclaimableSpace: number;
  criteria: {
    unwatchedDays: number;
  };
}

// Settings
export interface ServiceConnection {
  url?: string;
  apiKey?: string;
  token?: string;
  enabled?: boolean;
}

export interface NotificationSettings {
  emailEnabled: boolean;
  emailAddress?: string;
  discordEnabled: boolean;
  discordWebhook?: string;
}

export interface ScheduleSettings {
  enabled: boolean;
  interval: 'hourly' | 'daily' | 'weekly';
  time: string;
  autoProcess: boolean;
}

export interface Settings {
  services: {
    plex?: ServiceConnection;
    tautulli?: ServiceConnection;
    sonarr?: ServiceConnection;
    radarr?: ServiceConnection;
    overseerr?: ServiceConnection;
    unraid?: ServiceConnection;
  };
  notifications?: NotificationSettings;
  schedule?: ScheduleSettings;
}

// Unraid Types
export interface UnraidDisk {
  name: string;
  device: string;
  size: number;
  used: number;
  free: number;
  usedPercent: number;
  temp?: number;
  status: 'active' | 'standby' | 'error' | 'unknown';
  type: 'data' | 'parity' | 'cache';
  filesystem?: string;
}

export interface UnraidStats {
  configured: boolean;
  arrayState: 'Started' | 'Stopped' | 'Syncing' | 'Unknown';
  totalCapacity: number;
  usedCapacity: number;
  freeCapacity: number;
  usedPercent: number;
  disks: UnraidDisk[];
  lastUpdated: string;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Activity Log Types
export interface ActivityLogEntry {
  id: number;
  eventType: 'scan' | 'deletion' | 'rule_match' | 'protection' | 'manual_action' | 'error';
  action: string;
  actorType: 'scheduler' | 'user' | 'rule';
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: number | null;
  targetTitle: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityFilters {
  page: number;
  limit: number;
  dateRange: '24h' | '7d' | '30d' | 'all';
  eventTypes?: string[];
  actorTypes?: string[];
  search?: string;
}

export interface ActivityLogResponse {
  items: ActivityLogEntry[];
  total: number;
  page: number;
  limit: number;
}
