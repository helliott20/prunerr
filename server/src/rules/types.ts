import type { MediaItem, Rule } from '../types';

// ============================================================================
// Rule Condition Types
// ============================================================================

/**
 * Condition types supported by the rules engine
 */
export type ConditionType =
  | 'not_watched_days'
  | 'play_count_less_than'
  | 'file_size_greater_than'
  | 'resolution_less_than'
  | 'added_days_ago'
  | 'genre_is'
  | 'genre_is_not'
  | 'year_before'
  | 'year_after'
  | 'rating_less_than'
  | 'type_is';

/**
 * Logic operators for combining conditions
 */
export type LogicOperator = 'AND' | 'OR';

/**
 * Extended condition with support for custom condition types
 */
export interface ExtendedRuleCondition {
  type: ConditionType;
  value: string | number | boolean | string[];
  operator?: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'not_contains';
}

/**
 * Condition group for complex rule logic
 */
export interface ConditionGroup {
  logic: LogicOperator;
  conditions: ExtendedRuleCondition[];
}

// ============================================================================
// Action Types
// ============================================================================

/**
 * Actions that can be taken on media items
 */
export enum Action {
  MARK_FOR_DELETION = 'mark_for_deletion',
  PROTECT = 'protect',
  IGNORE = 'ignore',
}

/**
 * Deletion actions specifying how to handle the deletion in Sonarr/Radarr
 */
export enum DeletionAction {
  /** Only unmonitor the item, keep files and metadata */
  UNMONITOR_ONLY = 'unmonitor_only',
  /** Delete files but keep the item in Sonarr/Radarr (unmonitored) */
  DELETE_FILES_ONLY = 'delete_files_only',
  /** Unmonitor and delete files */
  UNMONITOR_AND_DELETE = 'unmonitor_and_delete',
  /** Completely remove from Sonarr/Radarr including metadata */
  FULL_REMOVAL = 'full_removal',
}

/**
 * Human-readable labels for deletion actions
 */
export const DELETION_ACTION_LABELS: Record<DeletionAction, string> = {
  [DeletionAction.UNMONITOR_ONLY]: 'Unmonitor Only (keep files)',
  [DeletionAction.DELETE_FILES_ONLY]: 'Delete Files Only',
  [DeletionAction.UNMONITOR_AND_DELETE]: 'Unmonitor & Delete Files',
  [DeletionAction.FULL_REMOVAL]: 'Full Removal (delete everything)',
};

/**
 * Descriptions for deletion actions
 */
export const DELETION_ACTION_DESCRIPTIONS: Record<DeletionAction, string> = {
  [DeletionAction.UNMONITOR_ONLY]: 'Stop monitoring the item but keep all files and metadata intact',
  [DeletionAction.DELETE_FILES_ONLY]: 'Delete the media files but keep the item in Sonarr/Radarr for re-download',
  [DeletionAction.UNMONITOR_AND_DELETE]: 'Unmonitor and delete files, but keep metadata in Sonarr/Radarr',
  [DeletionAction.FULL_REMOVAL]: 'Completely remove from Sonarr/Radarr including all metadata',
};

// ============================================================================
// Evaluation Result Types
// ============================================================================

/**
 * Result of evaluating a single item against a rule
 */
export interface ItemEvaluationResult {
  matched: boolean;
  rule?: Rule;
  action?: Action;
  matchedConditions?: ExtendedRuleCondition[];
}

/**
 * Result of evaluating an item against all rules
 */
export interface EvaluationResult {
  item: MediaItem;
  matched: boolean;
  matchedRule?: Rule;
  action?: Action;
  isProtected: boolean;
  protectionReason?: string;
  evaluatedAt: Date;
}

/**
 * Summary of a full evaluation run
 */
export interface EvaluationSummary {
  itemsEvaluated: number;
  itemsFlagged: number;
  itemsProtected: number;
  itemsIgnored: number;
  results: EvaluationResult[];
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

// ============================================================================
// Protection Rule Types
// ============================================================================

/**
 * Result of protection rule evaluation
 */
export interface ProtectionResult {
  isProtected: boolean;
  reason?: string;
}

/**
 * Configuration for protection rules
 */
export interface ProtectionConfig {
  protectRecentlyAdded: boolean;
  recentlyAddedDays: number;
  protectRecentlyWatched: boolean;
  recentlyWatchedDays: number;
  protectInProgress: boolean;
  protectedGenres: string[];
  protectedTags: string[];
  protectedRatings: number; // Protect items rated above this threshold
}

// ============================================================================
// Queue Types
// ============================================================================

/**
 * Item in the deletion queue
 */
export interface QueueItem {
  id: number;
  mediaItem: MediaItem;
  markedAt: Date;
  deleteAfter: Date;
  ruleId?: number;
  ruleName?: string;
  daysRemaining: number;
  action: DeletionAction;
  /** Whether to reset the item in Overseerr after deletion */
  resetOverseerr: boolean;
  /** Who originally requested this content (from Overseerr) */
  requestedBy?: string;
}

/**
 * Result of a deletion operation
 */
export interface DeletionResult {
  success: boolean;
  itemId: number;
  title: string;
  action: DeletionAction;
  fileSizeFreed?: number;
  error?: string;
  deletedAt?: Date;
  /** Whether the item was reset in Overseerr */
  overseerrReset?: boolean;
  /** Error when trying to reset in Overseerr (non-fatal) */
  overseerrError?: string;
}

// ============================================================================
// Extended Media Item with additional metadata
// ============================================================================

/**
 * Extended media item with parsed metadata for rule evaluation
 */
export interface ExtendedMediaItem extends MediaItem {
  genres?: string[];
  rating?: number;
  tags?: string[];
  inProgress?: boolean;
  daysSinceLastWatched?: number;
  daysSinceAdded?: number;
  fileSizeGB?: number;
  resolutionValue?: number; // Numeric representation (720, 1080, 2160)
}

// ============================================================================
// Rule Configuration Types
// ============================================================================

/**
 * Parsed rule with conditions ready for evaluation
 */
export interface ParsedRule extends Omit<Rule, 'conditions'> {
  conditions: ExtendedRuleCondition[];
  conditionLogic: LogicOperator;
  gracePeriodDays: number;
  deletionAction: DeletionAction;
}

/**
 * Default configuration for rules
 */
export interface RulesConfig {
  defaultGracePeriodDays: number;
  defaultDeletionAction: DeletionAction;
  defaultConditionLogic: LogicOperator;
  enableDryRun: boolean;
  maxItemsPerRun: number;
}

export const DEFAULT_RULES_CONFIG: RulesConfig = {
  defaultGracePeriodDays: 7,
  defaultDeletionAction: DeletionAction.UNMONITOR_AND_DELETE,
  defaultConditionLogic: 'AND',
  enableDryRun: false,
  maxItemsPerRun: 1000,
};
