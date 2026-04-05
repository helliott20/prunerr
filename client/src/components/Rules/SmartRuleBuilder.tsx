import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  Eye,
  HardDrive,
  Clock,
  Film,
  Tv,
  Monitor,
  Sparkles,
  ChevronRight,
  AlertCircle,
  Wand2,
} from 'lucide-react';
import { rulesApi, RuleSuggestion } from '@/services/api';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import type {
  Rule,
  RuleType,
  DeletionAction,
  ConditionNode,
  ConditionGroupNode,
  ConditionLeaf,
  RuleConditionsV2,
} from '@/types';
import { DELETION_ACTION_LABELS, DELETION_ACTION_DESCRIPTIONS } from '@/types';
import { ConditionEditor } from './ConditionEditor';
import { LivePreview } from './LivePreview';
import {
  emptyRoot,
  appendChild,
  updateNode,
  removeNode,
  buildDefaultLeaf,
} from './treeOps';

const iconMap: Record<string, React.ElementType> = {
  download: Download,
  eye: Eye,
  'hard-drive': HardDrive,
  clock: Clock,
  film: Film,
  tv: Tv,
  monitor: Monitor,
};

type BuilderMode = 'templates' | 'custom';

interface SmartRuleBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rule: Partial<Rule>) => void;
  editingRule?: Rule | null;
  isLoading?: boolean;
}

/**
 * Derive a rule-type tag from the fields used in the tree. Purely cosmetic —
 * the server engine no longer cares, but CreateRuleSchema still requires it.
 */
function deriveRuleType(root: ConditionNode): RuleType {
  const fields = new Set<string>();
  const walk = (n: ConditionNode) => {
    if (n.kind === 'condition') fields.add(n.field);
    else n.children.forEach(walk);
  };
  walk(root);
  if ([...fields].some((f) => f.includes('watch') || f === 'play_count')) return 'watch_status';
  if ([...fields].some((f) => f.includes('added') || f.includes('year'))) return 'age';
  if ([...fields].some((f) => f.includes('size'))) return 'size';
  if ([...fields].some((f) => f.includes('resolution') || f.includes('codec') || f === 'bitrate' || f === 'hdr')) return 'quality';
  return 'custom';
}

/**
 * Load an existing rule's condition tree. Accepts either the v2 tree
 * (server's canonical shape) or a legacy flat array, which we wrap into a
 * depth-1 AND group.
 */
function rootFromRule(rule: Rule): ConditionNode {
  // Prefer server-provided v2 tree
  if (rule.conditionsV2?.root) return rule.conditionsV2.root;
  const raw = rule.conditions;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'root' in raw) {
    return (raw as RuleConditionsV2).root;
  }
  // Legacy: flat array → wrap in AND group
  if (Array.isArray(raw)) {
    const children: ConditionLeaf[] = raw.map((c) => ({
      kind: 'condition',
      field: c.field || c.type || 'days_since_watched',
      operator: c.operator || 'greater_than',
      value: c.value,
      ...(c.params ? { params: c.params } : {}),
    }));
    return { kind: 'group', logic: 'AND', children };
  }
  return emptyRoot();
}

export function SmartRuleBuilder({
  isOpen,
  onClose,
  onSave,
  editingRule,
  isLoading = false,
}: SmartRuleBuilderProps) {
  const [mode, setMode] = useState<BuilderMode>('templates');
  const [selectedTemplate, setSelectedTemplate] = useState<RuleSuggestion | null>(null);

  const [ruleName, setRuleName] = useState('');
  const [priority, setPriority] = useState(0);
  const [mediaType, setMediaType] = useState<'all' | 'movie' | 'show'>('all');
  const [root, setRoot] = useState<ConditionGroupNode>(emptyRoot());
  const [gracePeriod, setGracePeriod] = useState(7);
  const [deletionAction, setDeletionAction] = useState<DeletionAction>('unmonitor_and_delete');
  const [resetOverseerr, setResetOverseerr] = useState(false);

  const { data: suggestionsData, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: rulesApi.getSuggestions,
    enabled: isOpen,
  });

  // Reset on open / editing changes
  useEffect(() => {
    if (!isOpen) return;
    if (editingRule) {
      setMode('custom');
      setRuleName(editingRule.name);
      setPriority(editingRule.priority ?? 0);
      const mt =
        editingRule.mediaType === 'tv' ? 'show' : (editingRule.mediaType || 'all');
      setMediaType(mt as 'all' | 'movie' | 'show');
      const loaded = rootFromRule(editingRule);
      setRoot(
        loaded.kind === 'group' ? loaded : { kind: 'group', logic: 'AND', children: [loaded] }
      );
      setGracePeriod(editingRule.gracePeriodDays || 7);
      setDeletionAction((editingRule.deletionAction as DeletionAction) || 'unmonitor_and_delete');
      setResetOverseerr(editingRule.resetOverseerr || false);
    } else {
      setMode('templates');
      setSelectedTemplate(null);
      setRuleName('');
      setPriority(0);
      setMediaType('all');
      setRoot(emptyRoot());
      setGracePeriod(7);
      setDeletionAction('unmonitor_and_delete');
      setResetOverseerr(false);
    }
  }, [isOpen, editingRule]);

  // When a template is selected, seed the builder with its flat conditions
  const handleSelectTemplate = (template: RuleSuggestion) => {
    setSelectedTemplate(template);
    setRuleName(template.name);
    setMediaType(template.mediaType === 'all' ? 'all' : (template.mediaType as 'movie' | 'show'));
    const leaves: ConditionLeaf[] = template.conditions.map((c) => ({
      kind: 'condition',
      field: c.field,
      operator: c.operator,
      value: c.value,
    }));
    setRoot({ kind: 'group', logic: 'AND', children: leaves });
    setMode('custom');
  };

  // Tree edit handlers (stable refs not required — inline is fine here)
  const onUpdate = (path: number[], updater: (n: ConditionNode) => ConditionNode) => {
    setRoot((prev) => {
      const next = updateNode(prev, path, updater);
      return next.kind === 'group' ? next : prev;
    });
  };
  const onAppend = (path: number[], child: ConditionNode) => {
    setRoot((prev) => {
      const next = appendChild(prev, path, child);
      return next.kind === 'group' ? next : prev;
    });
  };
  const onRemove = (path: number[]) => {
    setRoot((prev) => {
      const next = removeNode(prev, path);
      return next.kind === 'group' ? next : prev;
    });
  };

  const startBlank = () => {
    const firstField = 'days_since_watched';
    setRoot({ kind: 'group', logic: 'AND', children: [buildDefaultLeaf(firstField)] });
    setMode('custom');
  };

  const hasConditions = root.children.length > 0;
  const canSave = ruleName.trim().length > 0 && hasConditions;

  const handleSave = () => {
    const finalMediaType: 'all' | 'movie' | 'tv' =
      mediaType === 'show' ? 'tv' : mediaType;
    onSave({
      name: ruleName.trim(),
      type: deriveRuleType(root),
      action: 'delete',
      mediaType: finalMediaType,
      conditions: { version: 2, root },
      gracePeriodDays: gracePeriod,
      deletionAction,
      resetOverseerr,
      priority,
      enabled: editingRule?.enabled ?? true,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingRule ? 'Edit Rule' : 'Create Rule'}
      size="5xl"
    >
      <div className="flex flex-col lg:flex-row gap-6 min-h-[500px] max-h-[75vh]">
        {/* Main Builder Area */}
        <div className="flex-1 overflow-y-auto pr-2 min-w-0">
          {/* Mode Tabs */}
          {!editingRule && (
            <div className="flex gap-2 mb-6">
              <button
                type="button"
                onClick={() => setMode('templates')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === 'templates'
                    ? 'bg-accent-500 text-surface-950'
                    : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
              >
                <Sparkles className="w-4 h-4 inline mr-2" />
                Templates
              </button>
              <button
                type="button"
                onClick={() => setMode('custom')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === 'custom'
                    ? 'bg-accent-500 text-surface-950'
                    : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
              >
                <Wand2 className="w-4 h-4 inline mr-2" />
                Custom Builder
              </button>
            </div>
          )}

          {/* Templates Mode */}
          {mode === 'templates' && (
            <div className="space-y-4">
              <p className="text-surface-400 text-sm">
                Choose a template based on your library. These are personalized suggestions.
              </p>

              {suggestionsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-32 bg-surface-800 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : suggestionsData?.suggestions?.length === 0 ? (
                <Card className="p-8 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto text-surface-500 mb-4" />
                  <p className="text-surface-400">
                    No suggestions available yet. Scan your library first to get personalized
                    recommendations, or start a blank rule.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-4"
                    onClick={startBlank}
                  >
                    Start a blank rule
                  </Button>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {suggestionsData?.suggestions.map((suggestion) => {
                      const Icon = iconMap[suggestion.icon] || Clock;
                      const isSelected = selectedTemplate?.id === suggestion.id;

                      return (
                        <button
                          key={suggestion.id}
                          type="button"
                          onClick={() => handleSelectTemplate(suggestion)}
                          className={`text-left p-4 rounded-lg border-2 transition-all ${
                            isSelected
                              ? 'border-accent-500 bg-accent-500/10'
                              : 'border-surface-700 bg-surface-800 hover:border-surface-600'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`p-2 rounded-lg ${
                                isSelected ? 'bg-accent-500/20' : 'bg-surface-700'
                              }`}
                            >
                              <Icon
                                className={`w-5 h-5 ${
                                  isSelected ? 'text-accent-400' : 'text-surface-400'
                                }`}
                              />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-medium text-white">{suggestion.name}</h4>
                              <p className="text-sm text-surface-400 mt-1">
                                {suggestion.description}
                              </p>
                              <div className="flex items-center gap-3 mt-3">
                                <Badge variant="default">{suggestion.matchCount} items</Badge>
                                <span className="text-sm text-emerald-400 font-medium">
                                  {suggestion.totalSizeFormatted}
                                </span>
                              </div>
                            </div>
                            {isSelected && <ChevronRight className="w-5 h-5 text-accent-400" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="pt-2">
                    <Button variant="ghost" size="sm" onClick={startBlank}>
                      Or start a blank rule →
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Custom Builder */}
          {mode === 'custom' && (
            <div className="space-y-5">
              {/* Metadata row */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,auto] gap-3 items-end">
                <div>
                  <label className="block text-sm font-medium text-surface-200 mb-1">
                    Rule Name
                  </label>
                  <Input
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="e.g., Clean up low-rated old movies"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-200 mb-1">
                    Priority
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value) || 0)}
                    className="w-24 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-200 mb-1">
                    Applies to
                  </label>
                  <select
                    value={mediaType}
                    onChange={(e) =>
                      setMediaType(e.target.value as 'all' | 'movie' | 'show')
                    }
                    className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
                  >
                    <option value="all">All Media</option>
                    <option value="movie">Movies</option>
                    <option value="show">TV Shows</option>
                  </select>
                </div>
              </div>

              {/* Tree editor */}
              <div>
                <label className="block text-sm font-medium text-surface-200 mb-2">
                  Conditions
                </label>
                <ConditionEditor
                  node={root}
                  path={[]}
                  depth={0}
                  onUpdate={onUpdate}
                  onAppend={onAppend}
                  onRemove={onRemove}
                />
              </div>

              {/* Action section */}
              {hasConditions && (
                <div className="pt-5 border-t border-surface-700 space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-surface-200 mb-2">
                      Grace Period
                    </label>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        value={gracePeriod}
                        onChange={(e) => setGracePeriod(Number(e.target.value))}
                        min={0}
                        max={365}
                        className="w-24"
                      />
                      <span className="text-surface-400">days before deletion</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-200 mb-2">
                      Deletion Action
                    </label>
                    <select
                      value={deletionAction}
                      onChange={(e) => setDeletionAction(e.target.value as DeletionAction)}
                      className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
                    >
                      {Object.entries(DELETION_ACTION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-surface-500 mt-1">
                      {DELETION_ACTION_DESCRIPTIONS[deletionAction]}
                    </p>
                  </div>

                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={resetOverseerr}
                        onChange={(e) => setResetOverseerr(e.target.checked)}
                        className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-accent-500 focus:ring-accent-500"
                      />
                      <span className="text-sm font-medium text-surface-100">Reset in Seerr</span>
                    </label>
                    <p className="text-xs text-surface-500 mt-1 ml-7">
                      Allow users to re-request this content after deletion.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preview Panel */}
        <div className="lg:w-80 flex-shrink-0">
          <LivePreview
            root={root}
            mediaType={mediaType}
            enabled={mode === 'custom'}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-6 mt-6 border-t border-surface-700">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave || isLoading}>
          {isLoading ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
        </Button>
      </div>
    </Modal>
  );
}
