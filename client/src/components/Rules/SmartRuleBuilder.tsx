import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Download,
  Eye,
  HardDrive,
  Clock,
  Film,
  Tv,
  Sparkles,
  ChevronRight,
  Plus,
  Trash2,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { rulesApi, RuleSuggestion } from '@/services/api';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import type { Rule, RuleCondition } from '@/types';

// Map icon names to Lucide components
const iconMap: Record<string, React.ElementType> = {
  download: Download,
  eye: Eye,
  'hard-drive': HardDrive,
  clock: Clock,
  film: Film,
  tv: Tv,
};

// Sentence builder options
const SENTENCE_SUBJECTS = [
  { value: 'all', label: 'movies and shows' },
  { value: 'movie', label: 'movies' },
  { value: 'show', label: 'TV shows' },
];

const SENTENCE_CONDITIONS = [
  {
    id: 'never_watched',
    label: 'have never been watched',
    field: 'play_count',
    operator: 'equals',
    value: 0,
  },
  {
    id: 'watched_once',
    label: 'have been watched exactly once',
    field: 'play_count',
    operator: 'equals',
    value: 1,
  },
  {
    id: 'watched_few_times',
    label: 'have been watched fewer than',
    field: 'play_count',
    operator: 'less_than',
    hasInput: true,
    inputSuffix: 'times',
    defaultValue: 3,
  },
  {
    id: 'not_watched_recently',
    label: "haven't been watched in",
    field: 'days_since_watched',
    operator: 'greater_than',
    hasInput: true,
    inputSuffix: 'days',
    defaultValue: 90,
  },
  {
    id: 'added_long_ago',
    label: 'were added more than',
    field: 'days_since_added',
    operator: 'greater_than',
    hasInput: true,
    inputSuffix: 'days ago',
    defaultValue: 60,
  },
  {
    id: 'large_files',
    label: 'are larger than',
    field: 'size_gb',
    operator: 'greater_than',
    hasInput: true,
    inputSuffix: 'GB',
    defaultValue: 10,
  },
  {
    id: 'small_files',
    label: 'are smaller than',
    field: 'size_gb',
    operator: 'less_than',
    hasInput: true,
    inputSuffix: 'GB',
    defaultValue: 1,
  },
];

interface SmartRuleBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rule: Partial<Rule>) => void;
  editingRule?: Rule | null;
  isLoading?: boolean;
}

type BuilderMode = 'templates' | 'sentence' | 'advanced';

interface SentenceCondition {
  id: string;
  value?: number;
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

  // Sentence builder state
  const [mediaType, setMediaType] = useState<'all' | 'movie' | 'show'>('all');
  const [sentenceConditions, setSentenceConditions] = useState<SentenceCondition[]>([]);

  // Final rule state
  const [ruleName, setRuleName] = useState('');
  const [gracePeriod, setGracePeriod] = useState(7);
  const [conditions, setConditions] = useState<RuleCondition[]>([]);

  // Fetch suggestions
  const { data: suggestionsData, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['ruleSuggestions'],
    queryFn: rulesApi.getSuggestions,
    enabled: isOpen,
  });

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: ({ conditions, mediaType }: { conditions: Array<{ field: string; operator: string; value: string | number | boolean }>; mediaType?: 'all' | 'movie' | 'show' }) =>
      rulesApi.preview(conditions, mediaType),
  });

  // Build conditions from sentence builder
  const buildConditionsFromSentence = useCallback(() => {
    const builtConditions: Array<{ field: string; operator: string; value: string | number | boolean }> = [];

    for (const sc of sentenceConditions) {
      const condDef = SENTENCE_CONDITIONS.find(c => c.id === sc.id);
      if (condDef) {
        builtConditions.push({
          field: condDef.field,
          operator: condDef.operator,
          value: sc.value ?? condDef.value ?? condDef.defaultValue ?? 0,
        });
      }
    }

    return builtConditions;
  }, [sentenceConditions]);

  // Update preview when conditions change
  useEffect(() => {
    if (mode === 'sentence' && sentenceConditions.length > 0) {
      const built = buildConditionsFromSentence();
      if (built.length > 0) {
        previewMutation.mutate({ conditions: built, mediaType });
      }
    } else if (mode === 'templates' && selectedTemplate) {
      previewMutation.mutate({
        conditions: selectedTemplate.conditions,
        mediaType: selectedTemplate.mediaType
      });
    } else if (mode === 'advanced' && conditions.length > 0) {
      // Build conditions for preview in advanced mode
      const advancedConditions = conditions.map(c => {
        let value = c.value;
        // Convert string numbers to actual numbers (handle "0" correctly)
        if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) {
          value = Number(value);
        }
        return {
          field: c.field || c.type || 'days_since_watched',
          operator: c.operator || 'greater_than',
          value,
        };
      });
      previewMutation.mutate({ conditions: advancedConditions, mediaType });
    }
  }, [mode, sentenceConditions, selectedTemplate, mediaType, conditions]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      if (editingRule) {
        // Editing mode - go to advanced
        setMode('advanced');
        setRuleName(editingRule.name);
        // Convert 'tv' to 'show' for internal consistency
        const mt = editingRule.mediaType === 'tv' ? 'show' : (editingRule.mediaType || 'all');
        setMediaType(mt as 'all' | 'movie' | 'show');
        setConditions(editingRule.conditions || []);
        setGracePeriod(editingRule.gracePeriodDays || 7);
      } else {
        // Creating mode - start with templates
        setMode('templates');
        setSelectedTemplate(null);
        setSentenceConditions([]);
        setRuleName('');
        setMediaType('all');
        setConditions([]);
        setGracePeriod(7);
      }
    }
  }, [isOpen, editingRule]);

  const handleSelectTemplate = (template: RuleSuggestion) => {
    setSelectedTemplate(template);
    setRuleName(template.name);
    setMediaType(template.mediaType);
    setConditions(template.conditions as RuleCondition[]);
  };

  const handleAddSentenceCondition = (conditionId: string) => {
    if (!sentenceConditions.find(c => c.id === conditionId)) {
      const condDef = SENTENCE_CONDITIONS.find(c => c.id === conditionId);
      setSentenceConditions([
        ...sentenceConditions,
        { id: conditionId, value: condDef?.defaultValue }
      ]);
    }
  };

  const handleUpdateSentenceConditionValue = (conditionId: string, value: number) => {
    setSentenceConditions(
      sentenceConditions.map(c => c.id === conditionId ? { ...c, value } : c)
    );
  };

  const handleRemoveSentenceCondition = (conditionId: string) => {
    setSentenceConditions(sentenceConditions.filter(c => c.id !== conditionId));
  };

  const handleSave = () => {
    let finalConditions: RuleCondition[] = [];
    let finalMediaType: 'all' | 'movie' | 'tv' = mediaType === 'show' ? 'tv' : mediaType;

    if (mode === 'templates' && selectedTemplate) {
      finalConditions = selectedTemplate.conditions as RuleCondition[];
      // Convert 'show' back to 'tv' for the Rule type
      finalMediaType = selectedTemplate.mediaType === 'show' ? 'tv' : selectedTemplate.mediaType;
    } else if (mode === 'sentence') {
      finalConditions = buildConditionsFromSentence() as RuleCondition[];
    } else {
      // Advanced mode - convert string values to numbers where appropriate
      finalConditions = conditions.map(c => {
        let value = c.value;
        if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) {
          value = Number(value);
        }
        return { ...c, value };
      });
    }

    onSave({
      name: ruleName,
      mediaType: finalMediaType,
      conditions: finalConditions,
      gracePeriodDays: gracePeriod,
      enabled: editingRule?.enabled ?? true,
    });
  };

  const preview = previewMutation.data;
  const canSave = ruleName.trim() && (
    (mode === 'templates' && selectedTemplate) ||
    (mode === 'sentence' && sentenceConditions.length > 0) ||
    (mode === 'advanced' && conditions.length > 0)
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingRule ? 'Edit Rule' : 'Create Smart Rule'}
      size="5xl"
    >
      <div className="flex flex-col lg:flex-row gap-6 min-h-[500px] max-h-[75vh]">
        {/* Main Builder Area */}
        <div className="flex-1 overflow-y-auto pr-2 min-w-0">
          {/* Mode Tabs */}
          {!editingRule && (
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setMode('templates')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === 'templates'
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
              >
                <Sparkles className="w-4 h-4 inline mr-2" />
                Templates
              </button>
              <button
                onClick={() => setMode('sentence')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === 'sentence'
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
              >
                <Zap className="w-4 h-4 inline mr-2" />
                Build Your Own
              </button>
              <button
                onClick={() => setMode('advanced')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mode === 'advanced'
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
              >
                Advanced
              </button>
            </div>
          )}

          {/* Templates Mode */}
          {mode === 'templates' && (
            <div className="space-y-4">
              <p className="text-surface-400 text-sm mb-4">
                Choose a template based on your library. These are personalized suggestions.
              </p>

              {suggestionsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-32 bg-surface-800 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : suggestionsData?.suggestions?.length === 0 ? (
                <Card className="p-8 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto text-surface-500 mb-4" />
                  <p className="text-surface-400">
                    No suggestions available yet. Scan your library first to get personalized recommendations.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {suggestionsData?.suggestions.map((suggestion) => {
                    const Icon = iconMap[suggestion.icon] || Clock;
                    const isSelected = selectedTemplate?.id === suggestion.id;

                    return (
                      <button
                        key={suggestion.id}
                        onClick={() => handleSelectTemplate(suggestion)}
                        className={`text-left p-4 rounded-lg border-2 transition-all ${
                          isSelected
                            ? 'border-accent-500 bg-accent-500/10'
                            : 'border-surface-700 bg-surface-800 hover:border-surface-600'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${isSelected ? 'bg-accent-500/20' : 'bg-surface-700'}`}>
                            <Icon className={`w-5 h-5 ${isSelected ? 'text-accent-400' : 'text-surface-400'}`} />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium text-white">{suggestion.name}</h4>
                            <p className="text-sm text-surface-400 mt-1">{suggestion.description}</p>
                            <div className="flex items-center gap-3 mt-3">
                              <Badge variant="default">
                                {suggestion.matchCount} items
                              </Badge>
                              <span className="text-sm text-emerald-400 font-medium">
                                {suggestion.totalSizeFormatted}
                              </span>
                            </div>
                          </div>
                          {isSelected && (
                            <ChevronRight className="w-5 h-5 text-accent-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedTemplate && (
                <div className="mt-6 pt-6 border-t border-surface-700">
                  <label className="block text-sm font-medium text-surface-100 mb-2">
                    Rule Name
                  </label>
                  <Input
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="Give your rule a name"
                  />
                </div>
              )}
            </div>
          )}

          {/* Sentence Builder Mode */}
          {mode === 'sentence' && (
            <div className="space-y-6">
              <div className="bg-surface-800 rounded-lg p-6">
                <p className="text-surface-300 mb-4">Build your rule in plain English:</p>

                {/* The sentence */}
                <div className="text-lg leading-relaxed">
                  <span className="text-white">Mark for deletion </span>
                  <select
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value as 'all' | 'movie' | 'show')}
                    className="inline-block mx-1 px-3 py-1.5 bg-surface-700 border border-surface-500 rounded-lg text-white font-medium focus:outline-none focus:ring-2 focus:ring-accent-500 cursor-pointer hover:bg-surface-600"
                  >
                    {SENTENCE_SUBJECTS.map(s => (
                      <option key={s.value} value={s.value} className="bg-surface-800 text-white">{s.label}</option>
                    ))}
                  </select>
                  <span className="text-white"> that </span>

                  {sentenceConditions.length === 0 ? (
                    <span className="text-surface-500 italic">... (add conditions below)</span>
                  ) : (
                    sentenceConditions.map((sc, idx) => {
                      const condDef = SENTENCE_CONDITIONS.find(c => c.id === sc.id);
                      if (!condDef) return null;

                      return (
                        <span key={sc.id} className="inline-flex items-center">
                          {idx > 0 && <span className="text-white mx-2">and</span>}
                          <span className="text-accent-300">{condDef.label}</span>
                          {condDef.hasInput && (
                            <>
                              <input
                                type="number"
                                value={sc.value ?? condDef.defaultValue}
                                onChange={(e) => handleUpdateSentenceConditionValue(sc.id, Number(e.target.value))}
                                className="inline-block w-16 mx-2 px-2 py-1 bg-surface-700 border border-surface-600 rounded text-white text-center focus:outline-none focus:ring-2 focus:ring-accent-500"
                              />
                              <span className="text-surface-400">{condDef.inputSuffix}</span>
                            </>
                          )}
                          <button
                            onClick={() => handleRemoveSentenceCondition(sc.id)}
                            className="ml-2 p-1 text-surface-500 hover:text-ruby-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Condition Chips */}
              <div>
                <p className="text-sm text-surface-400 mb-3">Add conditions:</p>
                <div className="flex flex-wrap gap-2">
                  {SENTENCE_CONDITIONS.filter(c => !sentenceConditions.find(sc => sc.id === c.id)).map(condition => (
                    <button
                      key={condition.id}
                      onClick={() => handleAddSentenceCondition(condition.id)}
                      className="px-3 py-2 bg-surface-700 hover:bg-surface-600 text-surface-300 rounded-lg text-sm transition-colors flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      {condition.label} {condition.hasInput && `${condition.defaultValue} ${condition.inputSuffix}`}
                    </button>
                  ))}
                </div>
              </div>

              {sentenceConditions.length > 0 && (
                <div className="pt-4 border-t border-surface-700">
                  <label className="block text-sm font-medium text-surface-100 mb-2">
                    Rule Name
                  </label>
                  <Input
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="e.g., Clean up old unwatched movies"
                  />
                </div>
              )}
            </div>
          )}

          {/* Advanced Mode */}
          {mode === 'advanced' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-surface-100 mb-2">
                  Rule Name
                </label>
                <Input
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g., Delete old unwatched movies"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-100 mb-2">
                  Apply To
                </label>
                <select
                  value={mediaType}
                  onChange={(e) => setMediaType(e.target.value as 'all' | 'movie' | 'show')}
                  className="input"
                >
                  <option value="all">All Media</option>
                  <option value="movie">Movies Only</option>
                  <option value="show">TV Shows Only</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-100 mb-2">
                  Conditions
                </label>
                <div className="space-y-3">
                  {conditions.map((condition, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <select
                        value={condition.field || condition.type || 'days_since_watched'}
                        onChange={(e) => {
                          const updated = [...conditions];
                          updated[idx] = { ...updated[idx], field: e.target.value };
                          setConditions(updated);
                        }}
                        className="input flex-1"
                      >
                        <option value="days_since_watched">Days Since Last Watched</option>
                        <option value="days_since_added">Days Since Added</option>
                        <option value="play_count">Play Count</option>
                        <option value="size_gb">File Size (GB)</option>
                      </select>
                      <select
                        value={condition.operator || 'greater_than'}
                        onChange={(e) => {
                          const updated = [...conditions];
                          updated[idx] = {
                            ...updated[idx],
                            operator: e.target.value as RuleCondition['operator']
                          };
                          setConditions(updated);
                        }}
                        className="input w-32"
                      >
                        <option value="greater_than">Greater than</option>
                        <option value="less_than">Less than</option>
                        <option value="equals">Equals</option>
                      </select>
                      <Input
                        type="number"
                        value={String(condition.value)}
                        onChange={(e) => {
                          const updated = [...conditions];
                          updated[idx] = { ...updated[idx], value: e.target.value };
                          setConditions(updated);
                        }}
                        className="w-24"
                        placeholder="Value"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="w-4 h-4 text-ruby-400" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setConditions([...conditions, { field: 'days_since_watched', operator: 'greater_than', value: '90' }])}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Condition
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Grace Period - shown for all modes when conditions exist */}
          {canSave && (
            <div className="mt-6 pt-6 border-t border-surface-700">
              <label className="block text-sm font-medium text-surface-100 mb-2">
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
              <p className="text-xs text-surface-500 mt-1">
                Items will wait in the queue for this period before being deleted
              </p>
            </div>
          )}
        </div>

        {/* Preview Panel */}
        <div className="lg:w-80 flex-shrink-0">
          <Card className="p-4 bg-surface-800/50 sticky top-0">
            <h4 className="text-sm font-medium text-surface-300 mb-4 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Live Preview
            </h4>

            {previewMutation.isPending ? (
              <div className="space-y-3">
                <div className="h-8 bg-surface-700 rounded animate-pulse" />
                <div className="h-20 bg-surface-700 rounded animate-pulse" />
              </div>
            ) : preview ? (
              <div className="space-y-4">
                <div className="text-center py-4 bg-surface-700 rounded-lg">
                  <div className="text-3xl font-bold text-white">{preview.matchCount}</div>
                  <div className="text-sm text-surface-400">items would match</div>
                  <div className="text-lg font-medium text-emerald-400 mt-1">
                    {preview.totalSizeFormatted}
                  </div>
                </div>

                {preview.breakdown && (
                  <div className="flex gap-2 justify-center">
                    {preview.breakdown.movies > 0 && (
                      <Badge variant="movie">{preview.breakdown.movies} movies</Badge>
                    )}
                    {preview.breakdown.shows > 0 && (
                      <Badge variant="tv">{preview.breakdown.shows} shows</Badge>
                    )}
                  </div>
                )}

                {preview.sampleItems?.length > 0 && (
                  <div>
                    <p className="text-xs text-surface-500 mb-2">Sample matches:</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {preview.sampleItems.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 p-2 bg-surface-700/50 rounded text-sm"
                        >
                          {item.posterUrl ? (
                            <img
                              src={item.posterUrl}
                              alt={item.title}
                              className="w-8 h-12 object-cover rounded"
                            />
                          ) : (
                            <div className="w-8 h-12 bg-surface-600 rounded flex items-center justify-center">
                              {item.type === 'movie' ? (
                                <Film className="w-4 h-4 text-surface-500" />
                              ) : (
                                <Tv className="w-4 h-4 text-surface-500" />
                              )}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-surface-200 truncate">{item.title}</p>
                            <p className="text-xs text-surface-500">
                              {item.playCount} plays
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-surface-500">
                <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {mode === 'templates'
                    ? 'Select a template to see preview'
                    : 'Add conditions to see preview'}
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-6 mt-6 border-t border-surface-700">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!canSave || isLoading}
        >
          {isLoading ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
        </Button>
      </div>
    </Modal>
  );
}
