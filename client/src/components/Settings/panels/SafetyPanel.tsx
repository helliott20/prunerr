import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useToast } from '@/components/common/Toast';
import { useStats } from '@/hooks/useApi';
import { cn } from '@/lib/utils';

import { PanelSection } from '../components/PanelSection';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsEmptyState } from '../components/SettingsEmptyState';
import type { PanelProps } from '../types';

/** One library reported by `GET /api/library/plex-libraries`. */
interface LibraryInfo {
  key: string;
  title: string;
  type: string;
  excluded: boolean;
  /** Not returned by every backend yet; the type label stands in when absent. */
  count?: number;
}

type PatternField = 'title' | 'type';
type PatternOperator = 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'regex';

interface ExclusionPattern {
  field: PatternField;
  operator: PatternOperator;
  value: string;
}

const SAVER_LIBRARIES = 'libraryExclusions';
const SAVER_PATTERNS = 'exclusionPatterns';

/** Only patterns with a real value are ever persisted, so only they count as dirty. */
function meaningful(patterns: ExclusionPattern[]): ExclusionPattern[] {
  return patterns.filter((pattern) => pattern.value.trim() !== '');
}

function keysOf(libraries: LibraryInfo[]): string {
  return JSON.stringify(
    libraries
      .filter((library) => library.excluded)
      .map((library) => library.key)
      .sort()
  );
}

/**
 * Safety: which libraries Prunerr is even allowed to look at, and which titles
 * are shielded once it does. Both sub-sections own their own endpoint, so each
 * registers a saver with the shell rather than writing on click.
 */
export default function SafetyPanel({
  draft,
  fresh,
  mediaServer,
  registerSection,
  registerSaver,
  setExternalDirty,
}: PanelProps) {
  const { t } = useTranslation('settings');
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: stats } = useStats();

  // --- library exclusions ---------------------------------------------------

  const [libraries, setLibraries] = useState<LibraryInfo[]>([]);
  const [librariesLoading, setLibrariesLoading] = useState(false);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const [savedLibraryKeys, setSavedLibraryKeys] = useState('[]');

  const fetchLibraries = useCallback(async () => {
    setLibrariesLoading(true);
    try {
      const response = await fetch('/api/library/plex-libraries');
      if (response.ok) {
        const payload = await response.json();
        if (payload.success) {
          const next = payload.data as LibraryInfo[];
          setLibraries(next);
          // Refreshing rebases onto server truth: nothing is staged any more.
          setSavedLibraryKeys(keysOf(next));
        }
      }
    } catch {
      /* the empty state already says the libraries could not be read */
    } finally {
      setLibrariesLoading(false);
    }
  }, []);

  // Auto-fetch once the media server has credentials. Which credential counts
  // depends on the backend — Plex uses a token, Jellyfin and Emby an API key.
  useEffect(() => {
    if (librariesLoaded) return;
    const config = draft.services?.[mediaServer.configKey];
    if (config?.url && (config.token || config.apiKey)) {
      setLibrariesLoaded(true);
      void fetchLibraries();
    }
  }, [draft.services, fetchLibraries, librariesLoaded, mediaServer.configKey]);

  const toggleLibrary = useCallback((key: string) => {
    setLibraries((previous) =>
      previous.map((library) =>
        library.key === key ? { ...library, excluded: !library.excluded } : library
      )
    );
  }, []);

  const currentLibraryKeys = useMemo(() => keysOf(libraries), [libraries]);
  const librariesDirty = currentLibraryKeys !== savedLibraryKeys;

  const saveLibraryExclusions = useCallback(async () => {
    if (!librariesDirty) return;
    const excludedKeys = libraries.filter((library) => library.excluded).map((library) => library.key);

    let removedItems = 0;
    try {
      const response = await fetch('/api/library/plex-libraries/exclusions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludedKeys }),
      });
      const payload = await response.json();
      removedItems = payload?.data?.removedItems ?? 0;
    } catch {
      throw new Error(
        t('toasts.failedSaveLibraryMsg', 'Could not save library exclusions')
      );
    }

    setSavedLibraryKeys(keysOf(libraries));

    if (removedItems > 0) {
      addToast({
        type: 'info',
        title: t('toasts.librariesExcludedTitle', 'Libraries excluded'),
        message: t('toasts.librariesExcludedMsg', 'Removed {{count}} items from excluded libraries', {
          count: removedItems,
        }),
      });
    }

    // Excluding a library changes what the rest of the app is looking at.
    queryClient.invalidateQueries({ queryKey: ['library'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  }, [addToast, libraries, librariesDirty, queryClient, t]);

  // --- exclusion patterns ---------------------------------------------------

  const [patterns, setPatterns] = useState<ExclusionPattern[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [savedPatternsJson, setSavedPatternsJson] = useState('[]');
  const patternsSeeded = useRef(false);

  // Seed once from the loaded settings payload, then the panel owns them.
  useEffect(() => {
    if (patternsSeeded.current) return;
    if (Object.keys(draft).length === 0) return;
    patternsSeeded.current = true;
    const loaded = (draft.exclusionPatterns ?? []) as ExclusionPattern[];
    setPatterns(loaded);
    setSavedPatternsJson(JSON.stringify(meaningful(loaded)));
  }, [draft]);

  const currentPatternsJson = useMemo(() => JSON.stringify(meaningful(patterns)), [patterns]);
  const patternsDirty = currentPatternsJson !== savedPatternsJson;

  const addPattern = useCallback(() => {
    setPatterns((previous) => {
      const next: ExclusionPattern[] = [
        ...previous,
        { field: 'title', operator: 'contains', value: '' },
      ];
      setEditingIndex(next.length - 1);
      return next;
    });
  }, []);

  const removePattern = useCallback((index: number) => {
    setPatterns((previous) => previous.filter((_, i) => i !== index));
    setEditingIndex(null);
  }, []);

  const updatePattern = useCallback((index: number, updates: Partial<ExclusionPattern>) => {
    setPatterns((previous) =>
      previous.map((pattern, i) => (i === index ? { ...pattern, ...updates } : pattern))
    );
  }, []);

  const savePatterns = useCallback(async () => {
    if (!patternsDirty) return;
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'exclusion_patterns',
          value: currentPatternsJson,
        }),
      });
      if (!response.ok) throw new Error('request failed');
    } catch {
      throw new Error(
        t('toasts.failedSavePatternsMsg', 'Could not save exclusion patterns')
      );
    }
    setSavedPatternsJson(currentPatternsJson);
  }, [currentPatternsJson, patternsDirty, t]);

  // --- shell wiring ---------------------------------------------------------

  useEffect(() => {
    registerSaver(SAVER_LIBRARIES, saveLibraryExclusions);
  }, [registerSaver, saveLibraryExclusions]);

  useEffect(() => {
    registerSaver(SAVER_PATTERNS, savePatterns);
  }, [registerSaver, savePatterns]);

  useEffect(() => {
    setExternalDirty(SAVER_LIBRARIES, librariesDirty);
  }, [librariesDirty, setExternalDirty]);

  useEffect(() => {
    setExternalDirty(SAVER_PATTERNS, patternsDirty);
  }, [patternsDirty, setExternalDirty]);

  // Leaving the panel drops its local edits with it, so it must drop the dirty
  // flag too — otherwise the save pill would outlive anything to save.
  useEffect(
    () => () => {
      registerSaver(SAVER_LIBRARIES, null);
      registerSaver(SAVER_PATTERNS, null);
      setExternalDirty(SAVER_LIBRARIES, false);
      setExternalDirty(SAVER_PATTERNS, false);
    },
    [registerSaver, setExternalDirty]
  );

  // --- protection stats -----------------------------------------------------

  const totalItems = (stats?.movieCount ?? 0) + (stats?.tvShowCount ?? 0);
  const eligible = (stats?.unwatchedMovies ?? 0) + (stats?.unwatchedShows ?? 0);
  const protectedItems = Math.max(0, totalItems - eligible);
  const hasStats = !fresh && totalItems > 0;
  const excludedLibraries = libraries.filter((library) => library.excluded).length;

  const includedCount = libraries.filter((library) => !library.excluded).length;

  const fieldLabels: Record<PatternField, string> = {
    title: t('exclusionPatterns.fields.title', 'Title'),
    type: t('exclusionPatterns.fields.type', 'Type'),
  };

  const operatorLabels: Record<PatternOperator, string> = {
    contains: t('exclusionPatterns.operators.contains', 'Contains'),
    equals: t('exclusionPatterns.operators.equals', 'Equals'),
    starts_with: t('exclusionPatterns.operators.startsWith', 'Starts with'),
    ends_with: t('exclusionPatterns.operators.endsWith', 'Ends with'),
    regex: t('exclusionPatterns.operators.regex', 'Regex'),
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* ---------------- library exclusions ---------------- */}
        <PanelSection
          id="library-exclusions"
          register={registerSection}
          title={t('libraryExclusions.title', 'Library Exclusions')}
          description={t(
            'libraryExclusions.includedCountServer',
            '{{included}} of {{total}} {{server}} libraries included in scans',
            { included: includedCount, total: libraries.length, server: mediaServer.name }
          )}
          action={
            <button
              type="button"
              onClick={() => void fetchLibraries()}
              disabled={librariesLoading}
              title={t('libraryExclusions.refresh', 'Refresh libraries from {{server}}', {
                server: mediaServer.name,
              })}
              aria-label={t('libraryExclusions.refresh', 'Refresh libraries from {{server}}', {
                server: mediaServer.name,
              })}
              className="flex h-11 w-11 items-center justify-center rounded-[10px] text-surface-400 transition-colors hover:bg-accent-500/10 hover:text-accent-text-hover disabled:opacity-50"
            >
              <RefreshCw
                aria-hidden
                className={cn('h-4 w-4', librariesLoading && 'animate-spin motion-reduce:animate-none')}
              />
            </button>
          }
        >
          <SettingsCard className="p-4">
            {librariesLoading && libraries.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-surface-400">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                <span className="text-[12.5px]">
                  {t('libraryExclusions.loading', 'Loading libraries from {{server}}...', {
                    server: mediaServer.name,
                  })}
                </span>
              </div>
            ) : libraries.length === 0 ? (
              <SettingsEmptyState
                title={t('libraryExclusions.emptyTitle', 'No libraries loaded')}
                body={
                  fresh
                    ? t(
                        'libraryExclusions.emptyFresh',
                        'Connect {{server}} and your libraries will appear here — everything is included by default.',
                        { server: mediaServer.name }
                      )
                    : t(
                        'libraryExclusions.empty',
                        'No libraries found. Make sure {{server}} is configured and connected.',
                        { server: mediaServer.name }
                      )
                }
              />
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {libraries.map((library) => {
                  const included = !library.excluded;

                  return (
                    <li key={library.key}>
                      <label
                        className={cn(
                          'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[11px]',
                          'border border-surface-700/90 bg-surface-800/50 px-[13px] py-[11px]',
                          'transition-colors hover:border-surface-600/90'
                        )}
                      >
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={included}
                          onChange={() => toggleLibrary(library.key)}
                        />
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border',
                            'transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500/60',
                            included
                              ? 'border-accent-500 bg-accent-500 text-amber-950'
                              : 'border-surface-600 bg-transparent text-transparent'
                          )}
                        >
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-[13px]',
                            included ? 'text-surface-100' : 'text-surface-500'
                          )}
                        >
                          {library.title}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-surface-500">
                          {library.count === undefined
                            ? library.type
                            : library.count.toLocaleString()}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </SettingsCard>
        </PanelSection>

        {/* ---------------- exclusion patterns ---------------- */}
        <PanelSection
          id="exclusion-patterns"
          register={registerSection}
          title={t('exclusionPatterns.title', 'Exclusion Patterns')}
          description={t(
            'exclusionPatterns.description',
            'Items matching these patterns will be automatically protected from deletion during scans'
          )}
          action={
            <Button variant="outline" size="sm" className="min-h-[36px]" onClick={addPattern}>
              <Plus aria-hidden className="h-3.5 w-3.5" />
              {t('exclusionPatterns.add', 'Add Pattern')}
            </Button>
          }
        >
          <SettingsCard className="flex flex-col gap-3 p-4">
            {patterns.length === 0 ? (
              <SettingsEmptyState
                title={t('exclusionPatterns.emptyTitle', 'No patterns yet')}
                body={t(
                  'exclusionPatterns.emptyBody',
                  'Add one to permanently shield titles — e.g. anything containing “Christmas”.'
                )}
              />
            ) : (
              patterns.map((pattern, index) =>
                editingIndex === index ? (
                  <div
                    key={index}
                    className="flex flex-col gap-3 rounded-xl border border-accent-500/25 bg-surface-800/60 px-3.5 py-3"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <select
                        className="select"
                        aria-label={t('exclusionPatterns.fieldLabel', 'Field')}
                        value={pattern.field}
                        onChange={(event) =>
                          updatePattern(index, { field: event.target.value as PatternField })
                        }
                      >
                        <option value="title">{fieldLabels.title}</option>
                        <option value="type">{fieldLabels.type}</option>
                      </select>
                      <select
                        className="select"
                        aria-label={t('exclusionPatterns.operatorLabel', 'Operator')}
                        value={pattern.operator}
                        onChange={(event) =>
                          updatePattern(index, { operator: event.target.value as PatternOperator })
                        }
                      >
                        {(Object.keys(operatorLabels) as PatternOperator[]).map((operator) => (
                          <option key={operator} value={operator}>
                            {operatorLabels[operator]}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={pattern.value}
                        aria-label={t('exclusionPatterns.valueLabel', 'Value')}
                        onChange={(event) => updatePattern(index, { value: event.target.value })}
                        placeholder={
                          pattern.field === 'type'
                            ? t('exclusionPatterns.typePlaceholder', 'movie or show')
                            : t('exclusionPatterns.valuePlaceholder', 'Pattern to match...')
                        }
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => removePattern(index)}
                        className="flex h-11 items-center gap-2 rounded-[10px] px-3 text-[11.5px] font-semibold text-surface-400 transition-colors hover:bg-ruby-500/10 hover:text-ruby-text"
                      >
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                        {t('exclusionPatterns.remove', 'Remove')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingIndex(null)}
                        className="flex h-11 items-center rounded-[10px] border border-surface-600/80 px-4 text-[11.5px] font-semibold text-surface-200 transition-colors hover:bg-surface-800/60 hover:text-surface-50"
                      >
                        {t('common.done', 'Done')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-xl border border-surface-700/90 bg-surface-800/50 px-3.5 py-2 sm:gap-3"
                  >
                    {/* Field, operator and value share a row only once there is
                        width for it — on a phone the value gets its own line
                        instead of a truncated sliver between two labels. */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                        <span className="shrink-0 rounded-full bg-cyan-400/[0.12] px-2.5 py-0.5 text-[11.5px] font-medium text-cyan-text">
                          {fieldLabels[pattern.field]}
                        </span>
                        <span className="shrink-0 text-xs text-surface-400">
                          {operatorLabels[pattern.operator]}
                        </span>
                      </div>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-surface-50">
                        {pattern.value || t('exclusionPatterns.noValue', 'No value yet')}
                      </span>
                    </div>
                    <span
                      className="hidden shrink-0 font-mono text-[11.5px] text-surface-500 sm:inline"
                      title={t(
                        'exclusionPatterns.hitsUnknown',
                        'Match count is calculated on the next scan'
                      )}
                    >
                      —
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingIndex(index)}
                      aria-label={t('exclusionPatterns.edit', 'Edit pattern')}
                      title={t('exclusionPatterns.edit', 'Edit pattern')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-surface-400 transition-colors hover:bg-surface-700/50 hover:text-surface-50"
                    >
                      <Pencil aria-hidden className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePattern(index)}
                      aria-label={t('exclusionPatterns.remove', 'Remove')}
                      title={t('exclusionPatterns.remove', 'Remove')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-surface-400 transition-colors hover:bg-ruby-500/10 hover:text-ruby-text"
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              )
            )}

            {patterns.length > 0 && (
              <p className="text-[11.5px] text-surface-500">
                {t(
                  'exclusionPatterns.activeCount',
                  '{{count}} active pattern. Items matching any pattern will be skipped during rule evaluation.',
                  { count: meaningful(patterns).length }
                )}
              </p>
            )}
          </SettingsCard>
        </PanelSection>
      </div>

      {/* ---------------- right column ---------------- */}
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[264px]">
        <div className="rounded-[14px] border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
          <p className="text-[13.5px] font-medium text-emerald-text">
            {t('safety.protectedNow.title', 'Protected right now')}
          </p>
          <p className="mt-1 font-display text-[30px] font-bold leading-tight text-surface-50">
            {hasStats ? protectedItems.toLocaleString() : '—'}
          </p>
          <p className="text-xs text-surface-300">
            {hasStats
              ? t('safety.protectedNow.caption', 'Titles your current rules will not touch')
              : t('safety.protectedNow.captionEmpty', 'Nothing scanned yet')}
          </p>
        </div>

        <SettingsCard className="p-4">
          <p className="font-display text-[13.5px] font-semibold text-surface-50">
            {t('safety.effect.title', 'Effect of current rules')}
          </p>
          <dl className="mt-3">
            <StatRow
              label={t('safety.effect.eligible', 'Eligible for cleanup')}
              value={(hasStats ? eligible : 0).toLocaleString()}
            />
            <StatRow
              label={t('safety.effect.protected', 'Protected')}
              value={(hasStats ? protectedItems : 0).toLocaleString()}
              tone="emerald"
            />
            <StatRow
              label={t('safety.effect.excludedLibraries', 'Excluded libraries')}
              value={excludedLibraries.toLocaleString()}
            />
          </dl>
        </SettingsCard>
      </aside>
    </div>
  );
}

function StatRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'emerald';
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-surface-700/60 py-2.5 first:border-t-0 first:pt-0">
      <dt className="text-xs text-surface-400">{label}</dt>
      <dd
        className={cn(
          'font-mono text-[12.5px] font-semibold',
          tone === 'emerald' ? 'text-emerald-text' : 'text-surface-50'
        )}
      >
        {value}
      </dd>
    </div>
  );
}
