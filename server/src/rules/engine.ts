import type { MediaItem, Rule } from '../types';
import type {
  ItemEvaluationResult,
  EvaluationResult,
  EvaluationSummary,
  ProtectionResult,
  ProtectionConfig,
  ExtendedRuleCondition,
  ParsedRule,
  RulesConfig,
  Action,
  LogicOperator,
} from './types';
import { Action as ActionEnum, DEFAULT_RULES_CONFIG, DeletionAction } from './types';
import { evaluateConditions, extendMediaItem } from './conditions';
import logger from '../utils/logger';

// ============================================================================
// Default Protection Configuration
// ============================================================================

const DEFAULT_PROTECTION_CONFIG: ProtectionConfig = {
  protectRecentlyAdded: true,
  recentlyAddedDays: 30,
  protectRecentlyWatched: true,
  recentlyWatchedDays: 7,
  protectInProgress: true,
  protectedGenres: [],
  protectedTags: [],
  protectedRatings: 8.0,
};

// ============================================================================
// Rules Engine Class
// ============================================================================

/**
 * Rules evaluation engine for determining media item deletion eligibility
 */
export class RulesEngine {
  private config: RulesConfig;
  private protectionConfig: ProtectionConfig;
  private mediaItemRepository: MediaItemRepository | null = null;
  private rulesRepository: RulesRepository | null = null;

  constructor(
    config: Partial<RulesConfig> = {},
    protectionConfig: Partial<ProtectionConfig> = {}
  ) {
    this.config = { ...DEFAULT_RULES_CONFIG, ...config };
    this.protectionConfig = { ...DEFAULT_PROTECTION_CONFIG, ...protectionConfig };
  }

  /**
   * Set the media item repository for database access
   */
  setMediaItemRepository(repository: MediaItemRepository): void {
    this.mediaItemRepository = repository;
  }

  /**
   * Set the rules repository for database access
   */
  setRulesRepository(repository: RulesRepository): void {
    this.rulesRepository = repository;
  }

  // ============================================================================
  // Rule Parsing
  // ============================================================================

  /**
   * Parse a rule from the database format to the evaluation format
   */
  private parseRule(rule: Rule): ParsedRule {
    let conditions: ExtendedRuleCondition[] = [];
    let conditionLogic: LogicOperator = this.config.defaultConditionLogic;
    let gracePeriodDays = this.config.defaultGracePeriodDays;
    let deletionAction = this.config.defaultDeletionAction;

    try {
      // Parse conditions from JSON string
      const parsed = JSON.parse(rule.conditions);

      if (Array.isArray(parsed)) {
        // Simple array of conditions
        conditions = parsed as ExtendedRuleCondition[];
      } else if (typeof parsed === 'object') {
        // Object with conditions and metadata
        conditions = parsed.conditions || [];
        conditionLogic = parsed.logic || conditionLogic;
        gracePeriodDays = parsed.gracePeriodDays ?? gracePeriodDays;
        deletionAction = parsed.deletionAction || deletionAction;
      }
    } catch (error) {
      logger.error(`Failed to parse conditions for rule "${rule.name}":`, error);
    }

    return {
      ...rule,
      conditions,
      conditionLogic,
      gracePeriodDays,
      deletionAction,
    };
  }

  // ============================================================================
  // Protection Rules
  // ============================================================================

  /**
   * Apply protection rules to determine if an item should be protected from deletion
   */
  applyProtectionRules(item: MediaItem): ProtectionResult {
    const extendedItem = extendMediaItem(item);

    // Check if item is already marked as protected
    if (item.is_protected) {
      return {
        isProtected: true,
        reason: item.protection_reason || 'Manually protected',
      };
    }

    // Check recently added protection
    if (this.protectionConfig.protectRecentlyAdded && extendedItem.daysSinceAdded !== undefined) {
      if (extendedItem.daysSinceAdded < this.protectionConfig.recentlyAddedDays) {
        return {
          isProtected: true,
          reason: `Recently added (${extendedItem.daysSinceAdded} days ago)`,
        };
      }
    }

    // Check recently watched protection
    if (this.protectionConfig.protectRecentlyWatched && extendedItem.daysSinceLastWatched !== undefined) {
      if (extendedItem.daysSinceLastWatched < this.protectionConfig.recentlyWatchedDays) {
        return {
          isProtected: true,
          reason: `Recently watched (${extendedItem.daysSinceLastWatched} days ago)`,
        };
      }
    }

    // Check in-progress protection
    if (this.protectionConfig.protectInProgress && extendedItem.inProgress) {
      return {
        isProtected: true,
        reason: 'Currently in progress',
      };
    }

    // Check protected genres
    if (this.protectionConfig.protectedGenres.length > 0 && extendedItem.genres) {
      const protectedGenre = this.protectionConfig.protectedGenres.find((genre) =>
        extendedItem.genres?.map((g) => g.toLowerCase()).includes(genre.toLowerCase())
      );
      if (protectedGenre) {
        return {
          isProtected: true,
          reason: `Protected genre: ${protectedGenre}`,
        };
      }
    }

    // Check protected tags
    if (this.protectionConfig.protectedTags.length > 0 && extendedItem.tags) {
      const protectedTag = this.protectionConfig.protectedTags.find((tag) =>
        extendedItem.tags?.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
      );
      if (protectedTag) {
        return {
          isProtected: true,
          reason: `Protected tag: ${protectedTag}`,
        };
      }
    }

    // Check rating protection
    if (extendedItem.rating !== undefined && extendedItem.rating >= this.protectionConfig.protectedRatings) {
      return {
        isProtected: true,
        reason: `High rating: ${extendedItem.rating}`,
      };
    }

    return { isProtected: false };
  }

  // ============================================================================
  // Single Item Evaluation
  // ============================================================================

  /**
   * Evaluate a single media item against a list of rules
   */
  evaluateItem(item: MediaItem, rules: Rule[]): ItemEvaluationResult {
    logger.debug(`Evaluating item "${item.title}" against ${rules.length} rules`);

    // Check protection first
    const protectionResult = this.applyProtectionRules(item);
    if (protectionResult.isProtected) {
      logger.debug(`Item "${item.title}" is protected: ${protectionResult.reason}`);
      return {
        matched: false,
        action: ActionEnum.PROTECT,
      };
    }

    // Evaluate against each enabled rule
    for (const rule of rules) {
      if (!rule.enabled) {
        continue;
      }

      const parsedRule = this.parseRule(rule);

      if (parsedRule.conditions.length === 0) {
        logger.debug(`Rule "${rule.name}" has no conditions, skipping`);
        continue;
      }

      const { matched, matchedConditions } = evaluateConditions(
        item,
        parsedRule.conditions,
        parsedRule.conditionLogic
      );

      if (matched) {
        logger.info(
          `Item "${item.title}" matched rule "${rule.name}" (${matchedConditions.length} conditions)`
        );

        return {
          matched: true,
          rule,
          action: this.mapRuleActionToAction(rule.action),
          matchedConditions,
        };
      }
    }

    logger.debug(`Item "${item.title}" did not match any rules`);
    return { matched: false };
  }

  /**
   * Map rule action string to Action enum
   */
  private mapRuleActionToAction(ruleAction: string): Action {
    switch (ruleAction) {
      case 'flag':
      case 'delete':
        return ActionEnum.MARK_FOR_DELETION;
      case 'notify':
        return ActionEnum.IGNORE;
      default:
        return ActionEnum.MARK_FOR_DELETION;
    }
  }

  // ============================================================================
  // Bulk Evaluation
  // ============================================================================

  /**
   * Evaluate all media items against configured rules
   */
  async evaluateAll(rules?: Rule[]): Promise<EvaluationSummary> {
    const startedAt = new Date();

    logger.info('Starting full evaluation of all media items');

    // Get rules from repository if not provided
    let rulesToUse = rules;
    if (!rulesToUse && this.rulesRepository) {
      rulesToUse = await this.rulesRepository.getEnabledRules();
    }

    if (!rulesToUse || rulesToUse.length === 0) {
      logger.warn('No rules available for evaluation');
      return {
        itemsEvaluated: 0,
        itemsFlagged: 0,
        itemsProtected: 0,
        itemsIgnored: 0,
        results: [],
        startedAt,
        completedAt: new Date(),
        durationMs: 0,
      };
    }

    // Get media items from repository
    if (!this.mediaItemRepository) {
      throw new Error('Media item repository not configured');
    }

    const items = await this.mediaItemRepository.getItemsForEvaluation(
      this.config.maxItemsPerRun
    );

    logger.info(`Evaluating ${items.length} items against ${rulesToUse.length} rules`);

    const results: EvaluationResult[] = [];
    let itemsFlagged = 0;
    let itemsProtected = 0;
    let itemsIgnored = 0;

    for (const item of items) {
      const protectionResult = this.applyProtectionRules(item);
      const evaluationResult = this.evaluateItem(item, rulesToUse);

      const result: EvaluationResult = {
        item,
        matched: evaluationResult.matched,
        matchedRule: evaluationResult.rule,
        action: evaluationResult.action,
        isProtected: protectionResult.isProtected,
        protectionReason: protectionResult.reason,
        evaluatedAt: new Date(),
      };

      results.push(result);

      if (protectionResult.isProtected) {
        itemsProtected++;
      } else if (evaluationResult.matched) {
        itemsFlagged++;
      } else {
        itemsIgnored++;
      }
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    logger.info(
      `Evaluation complete: ${items.length} items evaluated, ${itemsFlagged} flagged, ` +
        `${itemsProtected} protected, ${itemsIgnored} ignored (${durationMs}ms)`
    );

    return {
      itemsEvaluated: items.length,
      itemsFlagged,
      itemsProtected,
      itemsIgnored,
      results,
      startedAt,
      completedAt,
      durationMs,
    };
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Update the rules configuration
   */
  updateConfig(config: Partial<RulesConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Rules engine configuration updated');
  }

  /**
   * Update the protection configuration
   */
  updateProtectionConfig(config: Partial<ProtectionConfig>): void {
    this.protectionConfig = { ...this.protectionConfig, ...config };
    logger.info('Protection configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): RulesConfig {
    return { ...this.config };
  }

  /**
   * Get current protection configuration
   */
  getProtectionConfig(): ProtectionConfig {
    return { ...this.protectionConfig };
  }
}

// ============================================================================
// Repository Interfaces
// ============================================================================

/**
 * Interface for media item repository
 */
export interface MediaItemRepository {
  getItemsForEvaluation(limit?: number): Promise<MediaItem[]>;
  updateItemStatus(itemId: number, status: string): Promise<void>;
  markForDeletion(itemId: number, deleteAfter: Date, ruleId?: number): Promise<void>;
}

/**
 * Interface for rules repository
 */
export interface RulesRepository {
  getEnabledRules(): Promise<Rule[]>;
  getRuleById(id: number): Promise<Rule | null>;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let rulesEngineInstance: RulesEngine | null = null;

/**
 * Get the singleton rules engine instance
 */
export function getRulesEngine(): RulesEngine {
  if (!rulesEngineInstance) {
    rulesEngineInstance = new RulesEngine();
  }
  return rulesEngineInstance;
}

/**
 * Create a new rules engine instance with custom configuration
 */
export function createRulesEngine(
  config?: Partial<RulesConfig>,
  protectionConfig?: Partial<ProtectionConfig>
): RulesEngine {
  return new RulesEngine(config, protectionConfig);
}

export default RulesEngine;
