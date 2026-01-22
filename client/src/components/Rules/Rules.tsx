import { useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  HardDrive,
  Eye,
  Calendar,
  Zap,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { useRules, useCreateRule, useUpdateRule, useDeleteRule, useToggleRule } from '@/hooks/useApi';
import { SmartRuleBuilder } from './SmartRuleBuilder';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import type { Rule, RuleCondition } from '@/types';

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

  const { data: rules, isLoading, isError, error, refetch } = useRules();
  const createMutation = useCreateRule();
  const updateMutation = useUpdateRule();
  const deleteMutation = useDeleteRule();
  const toggleMutation = useToggleRule();

  const handleCreateRule = () => {
    setEditingRule(null);
    setIsModalOpen(true);
  };

  const handleEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setIsModalOpen(true);
  };

  const handleDeleteRule = (ruleId: string) => {
    if (confirm('Are you sure you want to delete this rule?')) {
      deleteMutation.mutate(ruleId, { onSuccess: () => refetch() });
    }
  };

  const handleToggleRule = (ruleId: string, enabled: boolean) => {
    toggleMutation.mutate({ ruleId, enabled }, { onSuccess: () => refetch() });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Rules</h1>
          <p className="text-surface-400 mt-1">
            Configure automated cleanup rules for your library
          </p>
        </div>
        <Button onClick={handleCreateRule}>
          <Plus className="w-4 h-4 mr-2" />
          Create Rule
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
          title="Failed to load rules"
          retry={refetch}
        />
      ) : rules && rules.length > 0 ? (
        <div className="space-y-4">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              expanded={expandedRule === rule.id}
              onToggleExpand={() =>
                setExpandedRule(expandedRule === rule.id ? null : rule.id)
              }
              onEdit={() => handleEditRule(rule)}
              onDelete={() => handleDeleteRule(rule.id)}
              onToggle={(enabled) => handleToggleRule(rule.id, enabled)}
            />
          ))}
        </div>
      ) : (
        <Card className="p-12">
          <EmptyState
            icon={Zap}
            title="No rules configured"
            description="Create rules to automatically flag media for deletion based on watch status, age, size, and more."
            action={{ label: 'Create Your First Rule', onClick: handleCreateRule }}
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
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}

function RuleCard({
  rule,
  expanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onToggle,
}: RuleCardProps) {
  return (
    <Card className={`transition-colors ${!rule.enabled ? 'opacity-60' : ''}`}>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => onToggle(!rule.enabled)}
              className={`p-2 rounded-lg transition-colors ${
                rule.enabled
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                  : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
              }`}
            >
              {rule.enabled ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <div>
              <h3 className="font-medium text-white">{rule.name}</h3>
              <p className="text-sm text-surface-400 mt-0.5">
                {rule.conditions.length} condition{rule.conditions.length !== 1 ? 's' : ''} -{' '}
                <Badge variant={rule.mediaType === 'movie' ? 'movie' : rule.mediaType === 'tv' ? 'tv' : 'default'}>
                  {rule.mediaType === 'all' ? 'All Media' : rule.mediaType}
                </Badge>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
            <h4 className="text-sm font-medium text-surface-300 mb-3">Conditions</h4>
            <div className="space-y-2">
              {rule.conditions.map((condition, idx) => (
                <ConditionDisplay key={idx} condition={condition} />
              ))}
            </div>
            {rule.gracePeriodDays && (
              <div className="mt-4 pt-4 border-t border-surface-700">
                <p className="text-sm text-surface-400">
                  <Clock className="w-4 h-4 inline mr-1" />
                  Grace period: <span className="text-white">{rule.gracePeriodDays} days</span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function ConditionDisplay({ condition }: { condition: RuleCondition }) {
  // Support both 'type' and 'field' for backwards compatibility
  const condKey = condition.field || condition.type;
  const conditionType = CONDITION_TYPES.find((t) => t.value === condKey);
  const Icon = conditionType?.icon || AlertTriangle;

  const getConditionText = () => {
    const field = condition.field || condition.type;
    const op = condition.operator || 'greater_than';
    const val = condition.value;

    // Build a human-readable description
    const opText = op === 'equals' ? 'is' : op === 'greater_than' ? 'greater than' : op === 'less_than' ? 'less than' : op;

    switch (field) {
      case 'unwatched_days':
        return `Unwatched for more than ${val} days`;
      case 'last_watched_days':
      case 'days_since_watched':
        if (op === 'greater_than') return `Last watched more than ${val} days ago`;
        return `Days since watched ${opText} ${val}`;
      case 'days_since_added':
        if (op === 'greater_than') return `Added more than ${val} days ago`;
        return `Days since added ${opText} ${val}`;
      case 'size_greater':
      case 'size_gb':
        if (op === 'greater_than') return `File size larger than ${val} GB`;
        return `File size ${opText} ${val} GB`;
      case 'play_count':
        if (op === 'equals' && val === 0) return 'Never watched';
        if (op === 'equals' && val === 1) return 'Watched exactly once';
        return `Play count ${opText} ${val}`;
      case 'added_before':
        return `Added before ${val}`;
      default:
        return `${field} ${opText} ${val}`;
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm text-surface-300 bg-surface-800/50 px-3 py-2 rounded-lg">
      <Icon className="w-4 h-4 text-accent-400" />
      {getConditionText()}
    </div>
  );
}

