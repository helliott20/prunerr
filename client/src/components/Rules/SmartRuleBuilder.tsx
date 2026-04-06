import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  Zap,
  Plus,
  Trash2,
} from 'lucide-react';
import { rulesApi, RuleSuggestion } from '@/services/api';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
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
  ensureUiIds,
  stripUiIds,
  depthOf,
  MAX_DEPTH,
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

type BuilderMode = 'templates' | 'easy' | 'custom';

/* ------------------------------------------------------------------ */
/*  Easy Setup sentence builder data                                  */
/* ------------------------------------------------------------------ */

const SENTENCE_SUBJECTS = [
  { value: 'all', label: 'movies and shows' },
  { value: 'movie', label: 'movies' },
  { value: 'show', label: 'TV shows' },
];

interface SentenceConditionDef {
  id: string;
  label: string;
  field: string;
  operator: string;
  value?: number | string;
  hasInput?: boolean;
  inputSuffix?: string;
  defaultValue?: number | string;
}

const SENTENCE_CONDITIONS: SentenceConditionDef[] = [
  { id: 'never_watched', label: 'have never been watched', field: 'play_count', operator: 'equals', value: 0 },
  { id: 'watched_once', label: 'have been watched exactly once', field: 'play_count', operator: 'equals', value: 1 },
  { id: 'watched_few_times', label: 'have been watched fewer than', field: 'play_count', operator: 'less_than', hasInput: true, inputSuffix: 'times', defaultValue: 3 },
  { id: 'not_watched_recently', label: "haven't been watched in", field: 'days_since_watched', operator: 'greater_than', hasInput: true, inputSuffix: 'days', defaultValue: 90 },
  { id: 'added_long_ago', label: 'were added more than', field: 'days_since_added', operator: 'greater_than', hasInput: true, inputSuffix: 'days ago', defaultValue: 60 },
  { id: 'large_files', label: 'are larger than', field: 'size_gb', operator: 'greater_than', hasInput: true, inputSuffix: 'GB', defaultValue: 10 },
  { id: 'small_files', label: 'are smaller than', field: 'size_gb', operator: 'less_than', hasInput: true, inputSuffix: 'GB', defaultValue: 1 },
  { id: 'low_resolution', label: 'have a resolution lower than', field: 'resolution_number', operator: 'less_than', hasInput: true, inputSuffix: 'p', defaultValue: 1080 },
  { id: 'old_codec', label: 'use codec', field: 'codec', operator: 'contains', hasInput: true, inputSuffix: '', defaultValue: 'h264' },
  { id: 'released_before', label: 'were released before', field: 'year', operator: 'less_than', hasInput: true, inputSuffix: '', defaultValue: 2015 },
  { id: 'no_watchers', label: 'have been watched by fewer than', field: 'watched_by_count', operator: 'less_than', hasInput: true, inputSuffix: 'users', defaultValue: 2 },
];

interface ActiveSentenceCondition {
  defId: string;
  value: number | string;
}

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

/**
 * Convert Easy Setup sentence conditions into a v2 condition tree (AND group).
 */
function sentenceToTree(
  conditions: ActiveSentenceCondition[]
): ConditionGroupNode {
  const leaves: ConditionLeaf[] = conditions.map((ac) => {
    const def = SENTENCE_CONDITIONS.find((d) => d.id === ac.defId)!;
    return {
      kind: 'condition',
      field: def.field,
      operator: def.operator,
      value: ac.value,
    };
  });
  return { kind: 'group', logic: 'AND', children: leaves };
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

  // Easy Setup state
  const [easySubject, setEasySubject] = useState<'all' | 'movie' | 'show'>('all');
  const [easyConditions, setEasyConditions] = useState<ActiveSentenceCondition[]>([]);
  const [easyRuleName, setEasyRuleName] = useState('');
  const [easyGracePeriod, setEasyGracePeriod] = useState(7);
  const [easyDeletionAction, setEasyDeletionAction] = useState<DeletionAction>('unmonitor_and_delete');
  const [easyResetOverseerr, setEasyResetOverseerr] = useState(false);

  // Derived tree for Easy Setup preview
  const easyRoot: ConditionGroupNode =
    easyConditions.length > 0
      ? sentenceToTree(easyConditions)
      : emptyRoot();

  const { data: suggestionsData, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: rulesApi.getSuggestions,
    enabled: isOpen,
  });

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

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
      const wrapped =
        loaded.kind === 'group' ? loaded : { kind: 'group' as const, logic: 'AND' as const, children: [loaded] };
      setRoot(ensureUiIds(wrapped) as ConditionGroupNode);
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
      // Reset easy setup
      setEasySubject('all');
      setEasyConditions([]);
      setEasyRuleName('');
      setEasyGracePeriod(7);
      setEasyDeletionAction('unmonitor_and_delete');
      setEasyResetOverseerr(false);
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

  /* ---- Easy Setup helpers ---- */

  const addEasyCondition = (defId: string) => {
    const def = SENTENCE_CONDITIONS.find((d) => d.id === defId);
    if (!def) return;
    // Don't add duplicates
    if (easyConditions.some((c) => c.defId === defId)) return;
    const value = def.hasInput ? (def.defaultValue ?? 0) : (def.value ?? 0);
    setEasyConditions((prev) => [...prev, { defId, value }]);
  };

  const removeEasyCondition = (defId: string) => {
    setEasyConditions((prev) => prev.filter((c) => c.defId !== defId));
  };

  const updateEasyConditionValue = (defId: string, newValue: number | string) => {
    setEasyConditions((prev) =>
      prev.map((c) => (c.defId === defId ? { ...c, value: newValue } : c))
    );
  };

  const availableEasyConditions = SENTENCE_CONDITIONS.filter(
    (def) => !easyConditions.some((c) => c.defId === def.id)
  );

  /* ---- Save logic ---- */

  const hasConditions = root.children.length > 0;
  const hasEasyConditions = easyConditions.length > 0;

  const canSave =
    mode === 'easy'
      ? easyRuleName.trim().length > 0 && hasEasyConditions
      : ruleName.trim().length > 0 && hasConditions;

  const handleSave = () => {
    if (mode === 'easy') {
      // Convert sentence conditions to v2 tree
      const tree = sentenceToTree(easyConditions);
      if (depthOf(tree) > MAX_DEPTH) {
        alert(`Condition tree is too deep (max ${MAX_DEPTH} levels of nesting). Please simplify.`);
        return;
      }
      const cleanRoot = stripUiIds(tree);
      const finalMediaType: 'all' | 'movie' | 'tv' =
        easySubject === 'show' ? 'tv' : easySubject;
      onSave({
        name: easyRuleName.trim(),
        type: deriveRuleType(tree),
        action: 'delete',
        mediaType: finalMediaType,
        conditions: { version: 2, root: cleanRoot },
        gracePeriodDays: easyGracePeriod,
        deletionAction: easyDeletionAction,
        resetOverseerr: easyResetOverseerr,
        priority: 0,
        enabled: true,
      });
      return;
    }

    // Custom builder save
    if (depthOf(root) > MAX_DEPTH) {
      alert(
        `Condition tree is too deep (max ${MAX_DEPTH} levels of nesting). Please simplify.`
      );
      return;
    }
    const cleanRoot = stripUiIds(root);
    const finalMediaType: 'all' | 'movie' | 'tv' =
      mediaType === 'show' ? 'tv' : mediaType;
    onSave({
      name: ruleName.trim(),
      type: deriveRuleType(root),
      action: 'delete',
      mediaType: finalMediaType,
      conditions: { version: 2, root: cleanRoot },
      gracePeriodDays: gracePeriod,
      deletionAction,
      resetOverseerr,
      priority,
      enabled: editingRule?.enabled ?? true,
    });
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-950/95 backdrop-blur-sm animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/50 bg-surface-900/95 backdrop-blur-xl shrink-0">
        <h2 className="text-lg font-display font-semibold text-white">
          {editingRule ? 'Edit Rule' : 'Create Rule'}
        </h2>
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave || isLoading}>
            {isLoading ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Builder area — scrollable */}
        <div className="flex-1 overflow-y-auto p-6 min-w-0">
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
                onClick={() => setMode('easy')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === 'easy'
                    ? 'bg-accent-500 text-surface-950'
                    : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
              >
                <Zap className="w-4 h-4 inline mr-2" />
                Easy Setup
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
                    type="button"
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
                    <Button type="button" variant="ghost" size="sm" onClick={startBlank}>
                      Or start a blank rule →
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Easy Setup Mode */}
          {mode === 'easy' && (
            <div className="space-y-6">
              {/* Rule Name */}
              <div>
                <label className="block text-sm font-medium text-surface-200 mb-1">
                  Rule Name
                </label>
                <Input
                  value={easyRuleName}
                  onChange={(e) => setEasyRuleName(e.target.value)}
                  placeholder="e.g., Clean up unwatched content"
                />
              </div>

              {/* Sentence builder */}
              <div className="bg-surface-800/50 rounded-xl p-5 border border-surface-700/50">
                <p className="text-sm text-surface-400 mb-4">
                  Build your rule as a natural language sentence.
                </p>

                <div className="text-surface-100 text-base leading-relaxed">
                  <span className="text-surface-400">Mark for deletion </span>

                  {/* Subject selector */}
                  <select
                    value={easySubject}
                    onChange={(e) => setEasySubject(e.target.value as 'all' | 'movie' | 'show')}
                    className="inline-block mx-1 px-2 py-0.5 bg-accent-500/20 border border-accent-500/40 rounded text-accent-300 text-base font-medium focus:outline-none focus:ring-2 focus:ring-accent-500 cursor-pointer"
                  >
                    {SENTENCE_SUBJECTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>

                  {/* Rendered conditions */}
                  {easyConditions.length === 0 && (
                    <span className="text-surface-500 italic"> that...</span>
                  )}
                  {easyConditions.map((ac, idx) => {
                    const def = SENTENCE_CONDITIONS.find((d) => d.id === ac.defId);
                    if (!def) return null;

                    return (
                      <span key={ac.defId}>
                        <span className="text-surface-400">
                          {idx === 0 ? ' that ' : ' and '}
                        </span>
                        <span className="text-surface-100">{def.label}</span>
                        {def.hasInput && (
                          <>
                            {' '}
                            <input
                              type={typeof ac.value === 'string' ? 'text' : 'number'}
                              value={ac.value}
                              onChange={(e) => {
                                const v =
                                  typeof ac.value === 'string'
                                    ? e.target.value
                                    : Number(e.target.value) || 0;
                                updateEasyConditionValue(ac.defId, v);
                              }}
                              className="inline-block w-20 mx-1 px-2 py-0.5 bg-surface-700 border border-surface-600 rounded text-accent-300 text-base font-medium text-center focus:outline-none focus:ring-2 focus:ring-accent-500"
                            />
                            {def.inputSuffix && (
                              <span className="text-surface-400">{def.inputSuffix}</span>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => removeEasyCondition(ac.defId)}
                          className="inline-flex items-center ml-1 p-0.5 rounded text-surface-500 hover:text-ruby-400 hover:bg-ruby-500/10 transition-colors"
                          title="Remove condition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Add condition chips */}
              <div>
                <label className="block text-sm font-medium text-surface-200 mb-2">
                  Add Conditions
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableEasyConditions.map((def) => (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => addEasyCondition(def.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-surface-800 border border-surface-700 text-surface-300 hover:bg-surface-700 hover:border-surface-600 hover:text-surface-100 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {def.label}
                    </button>
                  ))}
                  {availableEasyConditions.length === 0 && (
                    <p className="text-sm text-surface-500 italic">
                      All conditions have been added.
                    </p>
                  )}
                </div>
              </div>

              {/* Action section (same as custom builder) */}
              {hasEasyConditions && (
                <div className="pt-5 border-t border-surface-700 space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-surface-200 mb-2">
                      Grace Period
                    </label>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        value={easyGracePeriod}
                        onChange={(e) => setEasyGracePeriod(Number(e.target.value))}
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
                      value={easyDeletionAction}
                      onChange={(e) => setEasyDeletionAction(e.target.value as DeletionAction)}
                      className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
                    >
                      {Object.entries(DELETION_ACTION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-surface-500 mt-1">
                      {DELETION_ACTION_DESCRIPTIONS[easyDeletionAction]}
                    </p>
                  </div>

                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={easyResetOverseerr}
                        onChange={(e) => setEasyResetOverseerr(e.target.checked)}
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

        {/* Preview Panel — side, wider, full height */}
        <div className="w-96 flex-shrink-0 border-l border-surface-700/50 p-6 flex flex-col">
          <LivePreview
            root={mode === 'easy' ? easyRoot : root}
            mediaType={mode === 'easy' ? easySubject : mediaType}
            enabled={mode === 'custom' || mode === 'easy'}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
