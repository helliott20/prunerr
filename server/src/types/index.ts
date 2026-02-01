import { z } from 'zod';

// ============================================================================
// Base Types
// ============================================================================

export type MediaType = 'movie' | 'show' | 'episode';
export type MediaStatus = 'monitored' | 'flagged' | 'pending_deletion' | 'deleted' | 'protected';
export type DeletionType = 'automatic' | 'manual';
export type ScanStatus = 'running' | 'completed' | 'failed';
export type RuleAction = 'flag' | 'delete' | 'notify';
export type RuleType = 'age' | 'watch_status' | 'size' | 'quality' | 'custom';

// ============================================================================
// Database Entity Types
// ============================================================================

export interface Setting {
  id: number;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface MediaItem {
  id: number;
  type: MediaType;
  title: string;
  plex_id: string | null;
  sonarr_id: number | null;
  radarr_id: number | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  tvdb_id: number | null;
  year: number | null;
  poster_url: string | null;
  file_path: string | null;
  file_size: number | null;
  resolution: string | null;
  codec: string | null;
  added_at: string | null;
  last_watched_at: string | null;
  play_count: number;
  watched_by: string | null; // JSON array of user names
  status: MediaStatus;
  marked_at: string | null;
  delete_after: string | null;
  is_protected: boolean;
  protection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuleCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty';
  value: string | number | boolean;
}

export type RuleMediaType = 'all' | 'movie' | 'show';

export interface Rule {
  id: number;
  name: string;
  profile_id: number | null;
  type: RuleType;
  media_type: RuleMediaType;
  conditions: string; // JSON array of RuleCondition
  action: RuleAction;
  enabled: boolean;
  grace_period_days: number;
  deletion_action: string;
  reset_overseerr: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeletionHistory {
  id: number;
  media_item_id: number | null;
  title: string;
  type: MediaType;
  file_size: number | null;
  deleted_at: string;
  deletion_type: DeletionType;
  deleted_by_rule_id: number | null;
}

export interface ScanHistory {
  id: number;
  started_at: string;
  completed_at: string | null;
  items_scanned: number;
  items_flagged: number;
  status: ScanStatus;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateMediaItemInput {
  type: MediaType;
  title: string;
  plex_id?: string;
  sonarr_id?: number;
  radarr_id?: number;
  tmdb_id?: number;
  imdb_id?: string;
  tvdb_id?: number;
  year?: number;
  poster_url?: string;
  file_path?: string;
  file_size?: number;
  resolution?: string;
  codec?: string;
  added_at?: string;
  last_watched_at?: string;
  play_count?: number;
  watched_by?: string[];
  status?: MediaStatus;
}

export interface UpdateMediaItemInput {
  title?: string;
  plex_id?: string;
  sonarr_id?: number;
  radarr_id?: number;
  tmdb_id?: number;
  imdb_id?: string;
  tvdb_id?: number;
  year?: number;
  poster_url?: string;
  file_path?: string;
  file_size?: number;
  resolution?: string;
  codec?: string;
  added_at?: string;
  last_watched_at?: string;
  play_count?: number;
  watched_by?: string[];
  status?: MediaStatus;
  marked_at?: string;
  delete_after?: string;
  is_protected?: boolean;
  protection_reason?: string;
  deletion_action?: string;
  reset_overseerr?: number;
}

export interface CreateRuleInput {
  name: string;
  profile_id?: number;
  type: RuleType;
  media_type?: RuleMediaType;
  conditions: RuleCondition[];
  action: RuleAction;
  enabled?: boolean;
  gracePeriodDays?: number;
  deletionAction?: string;
  resetOverseerr?: boolean;
}

export interface UpdateRuleInput {
  name?: string;
  profile_id?: number;
  type?: RuleType;
  media_type?: RuleMediaType;
  conditions?: RuleCondition[];
  action?: RuleAction;
  enabled?: boolean;
  gracePeriodDays?: number;
  deletionAction?: string;
  resetOverseerr?: boolean;
}

export interface SettingInput {
  key: string;
  value: string;
}

export interface MediaItemFilters {
  type?: MediaType;
  status?: MediaStatus;
  search?: string;
  limit?: number;
  offset?: number;
  // Extended filters
  minSize?: number;
  maxSize?: number;
  watched?: boolean; // true = watched (play_count > 0), false = unwatched (play_count = 0)
  unwatchedDays?: number; // Items not watched in X days
  isProtected?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ============================================================================
// Service Configuration Types
// ============================================================================

export interface PlexConfig {
  url: string;
  token: string;
}

export interface TautulliConfig {
  url: string;
  apiKey: string;
}

export interface SonarrConfig {
  url: string;
  apiKey: string;
}

export interface RadarrConfig {
  url: string;
  apiKey: string;
}

export interface OverseerrConfig {
  url: string;
  apiKey: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export interface DiscordConfig {
  webhookUrl: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface UnraidConfig {
  url: string;
  apiKey: string;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  dbPath: string;
  logLevel: string;
  plex: PlexConfig;
  tautulli: TautulliConfig;
  sonarr: SonarrConfig;
  radarr: RadarrConfig;
  overseerr: OverseerrConfig;
  smtp: SmtpConfig;
  discord: DiscordConfig;
  telegram: TelegramConfig;
  unraid: UnraidConfig;
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

export const MediaTypeSchema = z.enum(['movie', 'show', 'episode']);
export const MediaStatusSchema = z.enum(['monitored', 'flagged', 'pending_deletion', 'deleted', 'protected']);
export const RuleActionSchema = z.enum(['flag', 'delete', 'notify']);
export const RuleTypeSchema = z.enum(['age', 'watch_status', 'size', 'quality', 'custom']);
export const DeletionTypeSchema = z.enum(['automatic', 'manual']);

export const RuleConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'not_contains', 'is_empty', 'is_not_empty']),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const CreateMediaItemSchema = z.object({
  type: MediaTypeSchema,
  title: z.string().min(1),
  plex_id: z.string().optional(),
  sonarr_id: z.number().optional(),
  radarr_id: z.number().optional(),
  poster_url: z.string().url().optional(),
  file_path: z.string().optional(),
  file_size: z.number().positive().optional(),
  resolution: z.string().optional(),
  codec: z.string().optional(),
  added_at: z.string().datetime().optional(),
  last_watched_at: z.string().datetime().optional(),
  play_count: z.number().min(0).optional(),
  watched_by: z.array(z.string()).optional(),
  status: MediaStatusSchema.optional(),
});

export const UpdateMediaItemSchema = z.object({
  title: z.string().min(1).optional(),
  poster_url: z.string().url().nullable().optional(),
  file_path: z.string().nullable().optional(),
  file_size: z.number().positive().nullable().optional(),
  resolution: z.string().nullable().optional(),
  codec: z.string().nullable().optional(),
  last_watched_at: z.string().datetime().nullable().optional(),
  play_count: z.number().min(0).optional(),
  watched_by: z.array(z.string()).optional(),
  status: MediaStatusSchema.optional(),
  marked_at: z.string().datetime().nullable().optional(),
  delete_after: z.string().datetime().nullable().optional(),
  is_protected: z.boolean().optional(),
  protection_reason: z.string().nullable().optional(),
});

// Accept 'tv' from client and convert to 'show' for database
export const RuleMediaTypeSchema = z.union([
  z.literal('all'),
  z.literal('movie'),
  z.literal('show'),
  z.literal('tv'),
]).transform((val): 'all' | 'movie' | 'show' => val === 'tv' ? 'show' : val);

export const DeletionActionSchema = z.enum(['unmonitor_only', 'delete_files_only', 'unmonitor_and_delete', 'full_removal']);

export const CreateRuleSchema = z.object({
  name: z.string().min(1),
  profile_id: z.number().optional(),
  type: RuleTypeSchema,
  // Accept both snake_case and camelCase for mediaType
  media_type: RuleMediaTypeSchema.optional(),
  mediaType: RuleMediaTypeSchema.optional(),
  conditions: z.array(RuleConditionSchema),
  action: RuleActionSchema,
  enabled: z.boolean().optional().default(true),
  gracePeriodDays: z.number().optional(),
  deletionAction: DeletionActionSchema.optional(),
  resetOverseerr: z.boolean().optional(),
}).transform(({ mediaType, ...rest }) => ({
  ...rest,
  media_type: rest.media_type || mediaType || 'all',
}));

export const UpdateRuleSchema = z.object({
  name: z.string().min(1).optional(),
  profile_id: z.number().nullable().optional(),
  type: RuleTypeSchema.optional(),
  media_type: RuleMediaTypeSchema.optional(),
  mediaType: RuleMediaTypeSchema.optional(),
  conditions: z.array(RuleConditionSchema).optional(),
  action: RuleActionSchema.optional(),
  enabled: z.boolean().optional(),
  gracePeriodDays: z.number().optional(),
  deletionAction: DeletionActionSchema.optional(),
  resetOverseerr: z.boolean().optional(),
}).transform(({ mediaType, ...rest }) => ({
  ...rest,
  media_type: rest.media_type || mediaType,
}));

export const SettingInputSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const MediaItemFiltersSchema = z.object({
  type: MediaTypeSchema.optional(),
  status: MediaStatusSchema.optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});
