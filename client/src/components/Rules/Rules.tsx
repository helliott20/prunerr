import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  HardDrive,
  Eye,
  Calendar,
  Zap,
  Play,
  Loader2,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useToast } from '@/components/common/Toast';
import { useRules, useCreateRule, useUpdateRule, useDeleteRule, useToggleRule, useRunRule } from '@/hooks/useApi';
import { libraryApi } from '@/services/api';
import { SmartRuleBuilder } from './SmartRuleBuilder';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import type { Rule, RuleCondition, ConditionNode, RuleConditionsV2 } from '@/types';

const CONDITION_TYPES = [
  { value: 'unwatched_days', label: 'Days Since Added (Unwatched)', icon: Clock },
  { value: 'last_watched_days', label: 'Days Since Last Watched', icon: Eye },
  { value: 'days_since_watched', label: 'Days Since Last Watched', icon: Eye },
  { value: 'days_since_added', label: 'Days Since Added', icon: Calendar },
  { value: 'size_greater', label: 'File Size Greater Than', icon: HardDrive },
  { value: 'size_gb', label: 'File Size (GB)', icon: HardDrive },
  { value: 'play_count', label: 'Play Count', icon: Eye },
  { value: 'added_before', label: 'Added Before Date', icon: Calendar },
];

export default function Rules() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const { addToast } = useToast();
  const { t } = useTranslation('rules');

  const { data: rules, isLoading, isError, error, refetch } = useRules();

  // Library titles for the per-rule library badges. Fails quietly when Plex
  // isn't configured — badges fall back to showing the raw keys.
  const { data: plexLibraries } = useQuery({
    queryKey: ['plexLibraries'],
    queryFn: libraryApi.getPlexLibraries,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const libraryTitleByKey = new Map((plexLibraries ?? []).map((lib) => [lib.key, lib.title]));
  const createMutation = useCreateRule();
  const updateMutation = useUpdateRule();
  const deleteMutation = useDeleteRule();
  const toggleMutation = useToggleRule();
  const runMutation = useRunRule();
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);

  const handleCreateRule = () => {
    setEditingRule(null);
    setIsModalOpen(true);
  };

  const handleEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setIsModalOpen(true);
  };

  const handleDeleteRule = (ruleId: string) => {
    if (confirm(t('confirm.deleteRule', 'Are you sure you want to delete this rule?'))) {
      deleteMutation.mutate(ruleId, { onSuccess: () => refetch() });
    }
  };

  const handleToggleRule = (ruleId: string, enabled: boolean) => {
    toggleMutation.mutate({ ruleId, enabled }, { onSuccess: () => refetch() });
  };

  const handleRunRule = (ruleId: string, ruleName: string) => {
    setRunningRuleId(ruleId);
    runMutation.mutate(ruleId, {
      onSuccess: (data) => {
        setRunningRuleId(null);
        if (data.matched === 0) {
          addToast({
            type: 'info',
            title: t('toasts.noMatchesTitle', 'No matches'),
            message: t('toasts.noMatchesMsg', '"{{name}}" didn\'t match any items', { name: ruleName }),
          });
        } else {
          addToast({
            type: 'success',
            title: t('toasts.executedTitle', 'Rule executed'),
            message: t('toasts.executedMsg', '"{{name}}" matched {{matched}} item(s), {{processed}} processed', { name: ruleName, matched: data.matched, processed: data.processed }),
          });
        }
        refetch();
      },
      onError: (error) => {
        setRunningRuleId(null);
        addToast({
          type: 'error',
          title: t('toasts.failedTitle', 'Rule failed'),
          message: error instanceof Error ? error.message : t('toasts.failedMsg', 'Failed to run rule'),
        });
      },
    });
  };

  const handleSaveRule = (rule: Partial<Rule>) => {
    if (editingRule) {
      updateMutation.mutate(
        { id: editingRule.id, ...rule },
        {
          onSuccess: () => {
            setIsModalOpen(false);
            refetch();
          },
        }
      );
    } else {
      createMutation.mutate(rule as Omit<Rule, 'id'>, {
        onSuccess: () => {
          setIsModalOpen(false);
          refetch();
        },
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-surface-50">{t('header.title', 'Rules')}</h1>
          <p className="text-surface-400 mt-1">
            {t('header.subtitle', 'Configure automated cleanup rules for your library')}
          </p>
        </div>
        <Button onClick={handleCreateRule} className="self-start sm:self-auto shrink-0 whitespace-nowrap">
          <Plus className="w-4 h-4 mr-2" />
          {t('header.createRule', 'Create Rule')}
        </Button>
      </div>

      {/* Rules List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-surface-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          error={error as Error}
          title={t('errors.loadRules', 'Failed to load rules')}
          retry={refetch}
        />
      ) : rules && rules.length > 0 ? (
        <div className="space-y-4">
          {[...rules]
            .sort((a, b) => {
              const pa = a.priority ?? 0;
              const pb = b.priority ?? 0;
              if (pa !== pb) return pb - pa;
              return Number(a.id) - Number(b.id);
            })
            .map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              libraryTitleByKey={libraryTitleByKey}
              expanded={expandedRule === rule.id}
              isRunning={runningRuleId === rule.id}
              onToggleExpand={() =>
                setExpandedRule(expandedRule === rule.id ? null : rule.id)
              }
              onEdit={() => handleEditRule(rule)}
              onDelete={() => handleDeleteRule(rule.id)}
              onToggle={(enabled) => handleToggleRule(rule.id, enabled)}
              onRun={() => handleRunRule(rule.id, rule.name)}
            />
          ))}
        </div>
      ) : (
        <Card className="p-12">
          <EmptyState
            icon={Zap}
            title={t('empty.title', 'No rules configured')}
            description={t('empty.description', 'Create rules to automatically flag media for deletion based on watch status, age, size, and more.')}
            action={{ label: t('empty.action', 'Create Your First Rule'), onClick: handleCreateRule }}
          />
        </Card>
      )}

      {/* Smart Rule Builder */}
      <SmartRuleBuilder
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveRule}
        editingRule={editingRule}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

interface RuleCardProps {
  rule: Rule;
  /** Plex library key → display title, for the library targeting badges. */
  libraryTitleByKey: Map<string, string>;
  expanded: boolean;
  isRunning: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
}

function RuleCard({
  rule,
  libraryTitleByKey,
  expanded,
  isRunning,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggle,
  onRun,
}: RuleCardProps) {
  const { t } = useTranslation('rules');
  // Build a flat list of condition leaves from either the v2 tree or a legacy
  // flat array. Counts the leaves across the whole tree for display purposes.
  const { leaves, isV2 } = extractLeaves(rule);
  const conditions: RuleCondition[] = leaves;

  return (
    <Card className={`transition-colors ${!rule.enabled ? 'opacity-60' : ''}`}>
      <div className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 sm:items-center sm:gap-4 min-w-0">
            <button
              onClick={() => onToggle(!rule.enabled)}
              className={`shrink-0 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                rule.enabled
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                  : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
              }`}
            >
              {rule.enabled ? t('card.active', 'Active') : t('card.inactive', 'Inactive')}
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-surface-50 break-words">{rule.name}</h3>
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-700 text-surface-400"
                  title={t('card.priorityTooltip', 'Rule priority (higher wins)')}
                >
                  P{rule.priority ?? 0}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    isV2
                      ? 'bg-accent-500/20 text-surface-50 ring-1 ring-inset ring-accent-500/40'
                      : 'bg-surface-700 text-surface-400'
                  }`}
                  title={isV2 ? t('card.v2Tooltip', 'v2 nested-group rule') : t('card.v1Tooltip', 'v1 legacy rule')}
                >
                  {isV2 ? 'v2' : 'v1'}
                </span>
              </div>
              <p className="text-sm text-surface-400 mt-0.5">
                {t('card.conditionCount', '{{count}} condition', { count: conditions.length })} -{' '}
                <Badge
                  variant={
                    rule.mediaType === 'movie'
                      ? 'movie'
                      : rule.mediaType === 'tv'
                        ? 'tv'
                        : 'default'
                  }
                >
                  {!rule.mediaType || rule.mediaType === 'all' ? t('card.allMedia', 'All Media') : rule.mediaType}
                </Badge>
                {rule.libraryKeys && rule.libraryKeys.length > 0 &&
                  rule.libraryKeys.map((key) => (
                    <Badge key={key} variant="accent" className="ml-1">
                      {libraryTitleByKey.get(key) ?? t('card.libraryKey', 'Library {{key}}', { key })}
                    </Badge>
                  ))}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 self-end sm:gap-2 sm:self-auto shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRun}
              disabled={isRunning || !rule.enabled}
              title={!rule.enabled ? t('card.enableToRun', 'Enable rule to run') : t('card.runNow', 'Run rule now')}
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Edit2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="w-4 h-4 text-ruby-400" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onToggleExpand}>
              {expanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-surface-700">
            <h4 className="text-sm font-medium text-surface-300 mb-3">{t('card.conditionsHeading', 'Conditions')}</h4>
            <div className="space-y-2">
              {conditions.map((condition, idx) => (
                <ConditionDisplay key={idx} condition={condition} />
              ))}
            </div>
            {rule.gracePeriodDays && (
              <div className="mt-4 pt-4 border-t border-surface-700">
                <p className="text-sm text-surface-400">
                  <Clock className="w-4 h-4 inline mr-1" />
                  {t('card.gracePeriodLabel', 'Grace period:')} <span className="text-surface-50">{t('card.gracePeriodDays', '{{count}} days', { count: rule.gracePeriodDays })}</span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Flatten a rule's conditions into an array of leaves, regardless of whether
 * the rule is stored as a legacy flat array or a v2 nested tree. Also reports
 * whether the rule is v2 (tree form).
 */
function extractLeaves(rule: Rule): { leaves: RuleCondition[]; isV2: boolean } {
  const raw = rule.conditions;
  // Server now returns conditionsV2 separately — prefer that if present.
  if (rule.conditionsV2?.root) {
    return { leaves: treeLeaves(rule.conditionsV2.root), isV2: rule.conditionsV2.root.kind === 'group' };
  }
  // Serialized string (fallback)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return interpretParsed(parsed);
    } catch {
      return { leaves: [], isV2: false };
    }
  }
  return interpretParsed(raw);
}

function interpretParsed(parsed: unknown): { leaves: RuleCondition[]; isV2: boolean } {
  if (Array.isArray(parsed)) {
    return { leaves: parsed as RuleCondition[], isV2: false };
  }
  if (parsed && typeof parsed === 'object' && 'root' in (parsed as object)) {
    const tree = (parsed as RuleConditionsV2).root;
    return { leaves: treeLeaves(tree), isV2: true };
  }
  return { leaves: [], isV2: false };
}

function treeLeaves(node: ConditionNode): RuleCondition[] {
  if (node.kind === 'condition') {
    return [{ field: node.field, operator: node.operator, value: node.value as RuleCondition['value'], params: node.params }];
  }
  return node.children.flatMap(treeLeaves);
}

function ConditionDisplay({ condition }: { condition: RuleCondition }) {
  const { t } = useTranslation('rules');
  // Support both 'type' and 'field' for backwards compatibility
  const condKey = condition.field || condition.type;
  const conditionType = CONDITION_TYPES.find((ct) => ct.value === condKey);
  const Icon = conditionType?.icon || AlertTriangle;

  const getConditionText = () => {
    const field = condition.field || condition.type;
    const op = condition.operator || 'greater_than';
    const val = condition.value;

    // Build a human-readable description
    const opText =
      op === 'equals'
        ? t('condText.opIs', 'is')
        : op === 'greater_than'
          ? t('condText.opGreaterThan', 'greater than')
          : op === 'less_than'
            ? t('condText.opLessThan', 'less than')
            : op;

    switch (field) {
      case 'unwatched_days':
        return t('condText.unwatchedDays', 'Unwatched for more than {{val}} days', { val });
      case 'last_watched_days':
      case 'days_since_watched':
        if (op === 'greater_than') return t('condText.lastWatchedGt', 'Last watched more than {{val}} days ago', { val });
        return t('condText.daysSinceWatched', 'Days since watched {{op}} {{val}}', { op: opText, val });
      case 'days_since_added':
        if (op === 'greater_than') return t('condText.addedGt', 'Added more than {{val}} days ago', { val });
        return t('condText.daysSinceAdded', 'Days since added {{op}} {{val}}', { op: opText, val });
      case 'size_greater':
      case 'size_gb':
        if (op === 'greater_than') return t('condText.sizeGt', 'File size larger than {{val}} GB', { val });
        return t('condText.sizeOp', 'File size {{op}} {{val}} GB', { op: opText, val });
      case 'play_count':
        if (op === 'equals' && val === 0) return t('condText.neverWatched', 'Never watched');
        if (op === 'equals' && val === 1) return t('condText.watchedOnce', 'Watched exactly once');
        return t('condText.playCount', 'Play count {{op}} {{val}}', { op: opText, val });
      case 'added_before':
        return t('condText.addedBefore', 'Added before {{val}}', { val });
      default:
        return t('condText.generic', '{{field}} {{op}} {{val}}', { field, op: opText, val });
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm text-surface-300 bg-surface-800/50 px-3 py-2 rounded-lg">
      <Icon className="w-4 h-4 text-accent-text" />
      {getConditionText()}
    </div>
  );
}

