/**
 * FieldCatalog — single source of truth for all condition fields available
 * in the v2 rule builder. Each entry describes the field id (must match the
 * server evaluator), the allowed operators, the value widget type, and the
 * default value.
 *
 * The client builder reads this catalog to render the field picker and the
 * correct value widget for each selected field.
 */

export type ValueType =
  | 'number'
  | 'string'
  | 'enum'
  | 'list'
  | 'date'
  | 'user'
  | 'collection';

export type FieldGroup =
  | 'basics'
  | 'quality'
  | 'ratings'
  | 'watching'
  | 'collections'
  | 'metadata';

export type Operator =
  // numeric + equality
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'is_null'
  | 'is_not_null'
  // string
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'not_in'
  | 'regex_match'
  // list
  | 'contains_any'
  | 'contains_all'
  | 'matches_any'
  // collection
  | 'in_any_protected'
  | 'not_in_any_protected'
  | 'in_collection_id'
  // user
  | 'watched_since'
  | 'not_watched_since'
  | 'ever_watched'
  | 'never_watched';

export const OPERATOR_LABELS: Record<Operator, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  greater_than: 'greater than',
  less_than: 'less than',
  between: 'between',
  is_null: 'is empty',
  is_not_null: 'is not empty',
  contains: 'contains',
  not_contains: 'does not contain',
  in: 'is one of',
  not_in: 'is not one of',
  regex_match: 'matches regex',
  contains_any: 'contains any of',
  contains_all: 'contains all of',
  matches_any: 'matches any of',
  in_any_protected: 'is in a protected collection',
  not_in_any_protected: 'is not in any protected collection',
  in_collection_id: 'is in collection',
  watched_since: 'watched in last (days)',
  not_watched_since: 'not watched in last (days)',
  ever_watched: 'has ever been watched',
  never_watched: 'has never been watched',
};

export interface FieldDef {
  id: string;
  label: string;
  group: FieldGroup;
  valueType: ValueType;
  operators: Operator[];
  unit?: string;
  options?: string[];
  /**
   * When true, the field's values come from a remote endpoint
   * (users, collections, genres, tags) — the UI will fetch on demand.
   */
  dynamicOptions?: 'users' | 'collections' | 'genres' | 'tags';
  placeholder?: string;
  defaultValue?: unknown;
  defaultOperator?: Operator;
  /** Operators that need no value widget (is_null, is_not_null, etc.). */
  // value widget rules are derived from operator; no explicit flag here.
}

// Pre-defined operator bundles
const NUMERIC_OPS: Operator[] = [
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'between',
  'is_null',
  'is_not_null',
];

const STRING_OPS: Operator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'in',
  'not_in',
  'regex_match',
  'is_null',
  'is_not_null',
];

const ENUM_OPS: Operator[] = ['equals', 'not_equals', 'in', 'not_in'];

const LIST_OPS: Operator[] = [
  'contains_any',
  'contains_all',
  'not_contains',
  'matches_any',
];

const COLLECTION_OPS: Operator[] = [
  'in_any_protected',
  'not_in_any_protected',
  'in_collection_id',
];

const USER_OPS: Operator[] = [
  'watched_since',
  'not_watched_since',
  'ever_watched',
  'never_watched',
];

const DATE_OPS: Operator[] = [
  'equals',
  'greater_than',
  'less_than',
  'is_null',
  'is_not_null',
];

/** Operators that do not need a value widget. */
export const NO_VALUE_OPERATORS: ReadonlySet<Operator> = new Set([
  'is_null',
  'is_not_null',
  'in_any_protected',
  'not_in_any_protected',
  'ever_watched',
  'never_watched',
]);

export const FIELD_CATALOG: FieldDef[] = [
  // ────────────── Basics ──────────────
  {
    id: 'title',
    label: 'Title',
    group: 'basics',
    valueType: 'string',
    operators: ['contains', 'not_contains', 'regex_match', 'equals', 'not_equals'],
    defaultOperator: 'contains',
    placeholder: 'Search title',
    defaultValue: '',
  },
  {
    id: 'type',
    label: 'Media type',
    group: 'basics',
    valueType: 'enum',
    operators: ENUM_OPS,
    options: ['movie', 'show'],
    defaultOperator: 'equals',
    defaultValue: 'movie',
  },
  {
    id: 'year',
    label: 'Release year',
    group: 'basics',
    valueType: 'number',
    operators: NUMERIC_OPS,
    defaultOperator: 'greater_than',
    defaultValue: 2015,
  },
  {
    id: 'days_since_added',
    label: 'Days since added',
    group: 'basics',
    valueType: 'number',
    operators: NUMERIC_OPS,
    unit: 'days',
    defaultOperator: 'greater_than',
    defaultValue: 60,
  },
  {
    id: 'days_since_watched',
    label: 'Days since last watched',
    group: 'basics',
    valueType: 'number',
    operators: NUMERIC_OPS,
    unit: 'days',
    defaultOperator: 'greater_than',
    defaultValue: 120,
  },
  {
    id: 'play_count',
    label: 'Play count',
    group: 'basics',
    valueType: 'number',
    operators: NUMERIC_OPS,
    defaultOperator: 'less_than',
    defaultValue: 1,
  },
  {
    id: 'size_gb',
    label: 'File size',
    group: 'basics',
    valueType: 'number',
    operators: NUMERIC_OPS,
    unit: 'GB',
    defaultOperator: 'greater_than',
    defaultValue: 10,
  },

  // ────────────── Quality ──────────────
  {
    id: 'resolution',
    label: 'Resolution',
    group: 'quality',
    valueType: 'enum',
    operators: ENUM_OPS,
    options: ['480p', '576p', '720p', '1080p', '2160p', '4K'],
    defaultOperator: 'equals',
    defaultValue: '720p',
  },
  {
    id: 'video_codec',
    label: 'Video codec',
    group: 'quality',
    valueType: 'string',
    operators: STRING_OPS,
    defaultOperator: 'contains',
    defaultValue: 'h264',
  },
  {
    id: 'audio_codec',
    label: 'Audio codec',
    group: 'quality',
    valueType: 'string',
    operators: STRING_OPS,
    defaultOperator: 'contains',
    defaultValue: 'aac',
  },
  {
    id: 'hdr',
    label: 'HDR',
    group: 'quality',
    valueType: 'enum',
    operators: ENUM_OPS,
    options: ['none', 'HDR10', 'HDR10+', 'Dolby Vision'],
    defaultOperator: 'equals',
    defaultValue: 'none',
  },
  {
    id: 'bitrate',
    label: 'Bitrate (kbps)',
    group: 'quality',
    valueType: 'number',
    operators: NUMERIC_OPS,
    unit: 'kbps',
    defaultOperator: 'less_than',
    defaultValue: 2000,
  },

  // ────────────── Ratings ──────────────
  {
    id: 'rating_imdb',
    label: 'IMDb rating',
    group: 'ratings',
    valueType: 'number',
    operators: NUMERIC_OPS,
    defaultOperator: 'less_than',
    defaultValue: 6,
  },
  {
    id: 'rating_tmdb',
    label: 'TMDB rating',
    group: 'ratings',
    valueType: 'number',
    operators: NUMERIC_OPS,
    defaultOperator: 'less_than',
    defaultValue: 6,
  },
  {
    id: 'rating_rt',
    label: 'Rotten Tomatoes rating',
    group: 'ratings',
    valueType: 'number',
    operators: NUMERIC_OPS,
    defaultOperator: 'less_than',
    defaultValue: 50,
  },
  {
    id: 'content_rating',
    label: 'Content rating',
    group: 'ratings',
    valueType: 'enum',
    operators: ENUM_OPS,
    options: ['G', 'PG', 'PG-13', 'R', 'NC-17', 'TV-Y', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'],
    defaultOperator: 'equals',
    defaultValue: 'PG-13',
  },

  // ────────────── Watching ──────────────
  {
    id: 'watched_by_user',
    label: 'Watched by user',
    group: 'watching',
    valueType: 'user',
    operators: USER_OPS,
    defaultOperator: 'not_watched_since',
    defaultValue: 90,
  },
  {
    id: 'last_watched_at',
    label: 'Last watched date',
    group: 'watching',
    valueType: 'date',
    operators: DATE_OPS,
    defaultOperator: 'less_than',
    defaultValue: '',
  },

  // ────────────── Collections ──────────────
  {
    id: 'collection_membership',
    label: 'Collection membership',
    group: 'collections',
    valueType: 'collection',
    operators: COLLECTION_OPS,
    defaultOperator: 'in_any_protected',
    defaultValue: null,
  },

  // ────────────── Metadata ──────────────
  {
    id: 'genres',
    label: 'Genres',
    group: 'metadata',
    valueType: 'list',
    operators: LIST_OPS,
    dynamicOptions: 'genres',
    defaultOperator: 'contains_any',
    defaultValue: [],
  },
  {
    id: 'tags',
    label: 'Tags',
    group: 'metadata',
    valueType: 'list',
    operators: LIST_OPS,
    dynamicOptions: 'tags',
    defaultOperator: 'contains_any',
    defaultValue: [],
  },
  {
    id: 'studio',
    label: 'Studio',
    group: 'metadata',
    valueType: 'string',
    operators: STRING_OPS,
    defaultOperator: 'contains',
    defaultValue: '',
  },
  {
    id: 'runtime_minutes',
    label: 'Runtime',
    group: 'metadata',
    valueType: 'number',
    operators: NUMERIC_OPS,
    unit: 'minutes',
    defaultOperator: 'greater_than',
    defaultValue: 120,
  },
  {
    id: 'season_count',
    label: 'Season count',
    group: 'metadata',
    valueType: 'number',
    operators: NUMERIC_OPS,
    defaultOperator: 'greater_than',
    defaultValue: 1,
  },
  {
    id: 'episode_count',
    label: 'Episode count',
    group: 'metadata',
    valueType: 'number',
    operators: NUMERIC_OPS,
    defaultOperator: 'greater_than',
    defaultValue: 10,
  },
  {
    id: 'series_status',
    label: 'Series status',
    group: 'metadata',
    valueType: 'enum',
    operators: ENUM_OPS,
    options: ['continuing', 'ended', 'upcoming'],
    defaultOperator: 'equals',
    defaultValue: 'ended',
  },
  {
    id: 'original_language',
    label: 'Original language',
    group: 'metadata',
    valueType: 'string',
    operators: STRING_OPS,
    defaultOperator: 'equals',
    defaultValue: 'en',
  },
];

export const FIELD_GROUPS: Array<{
  id: FieldGroup;
  label: string;
  /** lucide-react icon name (resolved in the UI). */
  icon: string;
  description: string;
}> = [
  { id: 'basics', label: 'Basics', icon: 'info', description: 'Core media properties' },
  { id: 'quality', label: 'Quality', icon: 'monitor', description: 'Video & audio quality' },
  { id: 'ratings', label: 'Ratings', icon: 'star', description: 'Critic & audience scores' },
  { id: 'watching', label: 'Watching', icon: 'eye', description: 'Per-user watch status' },
  { id: 'collections', label: 'Collections', icon: 'layers', description: 'Collection membership' },
  { id: 'metadata', label: 'Metadata', icon: 'tag', description: 'Genres, tags, studio, etc.' },
];

const FIELD_BY_ID: Record<string, FieldDef> = FIELD_CATALOG.reduce(
  (acc, f) => {
    acc[f.id] = f;
    return acc;
  },
  {} as Record<string, FieldDef>
);

export function getField(id: string): FieldDef | undefined {
  return FIELD_BY_ID[id];
}

export function getOperatorsForField(id: string): Operator[] {
  return FIELD_BY_ID[id]?.operators ?? [];
}

export function operatorNeedsValue(op: string): boolean {
  return !NO_VALUE_OPERATORS.has(op as Operator);
}
