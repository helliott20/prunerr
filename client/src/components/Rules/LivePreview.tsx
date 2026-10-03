import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from 'framer-motion';
import { Eye, AlertCircle, Film, Shield, HardDrive, Clock, ChevronLeft, ChevronRight, PlayCircle } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Toggle } from '@/components/Settings/components/Toggle';
import { rulesApi } from '@/services/api';
import { formatBytes } from '@/lib/utils';
import { libraryItemPath } from '@/lib/links';
import type { ConditionNode } from '@/types';
import { stripUiIds } from './treeOps';

/** Compact summary surfaced to consumers (e.g. the mobile preview chip). */
export interface LivePreviewSummary {
  /** True while a fresh preview request is in flight. */
  isPending: boolean;
  /** True when there are no conditions yet — preview hasn't been requested. */
  isEmpty: boolean;
  /** True when the latest preview request failed. */
  hasError: boolean;
  total: number;
  freedGB: number;
}

interface LivePreviewProps {
  root: ConditionNode;
  mediaType?: 'all' | 'movie' | 'show' | 'tv';
  /** Restrict the preview to these Plex library keys. Empty = all libraries. */
  libraryKeys?: string[];
  /** If false, shows an inert placeholder. */
  enabled?: boolean;
  /**
   * Optional callback that fires whenever the preview's headline numbers
   * change. Used by the mobile floating-chip UI so the chip can show
   * live counts without re-fetching.
   */
  onSummaryChange?: (summary: LivePreviewSummary) => void;
}

const DEBOUNCE_MS = 400;

interface PreviewData {
  totalMatches?: number;
  wouldQueue?: number;
  wouldSkipProtected?: number;
  /** Shows skipped because someone is part-way through (Settings → Safety). */
  wouldSkipInProgress?: number;
  /** Matches already sitting in the deletion queue — not new work. */
  alreadyPending?: number;
  storageFreedGB?: number;
  samples?: Array<{
    id: number;
    title: string;
    size: number;
    rating: number | null;
    posterUrl?: string | null;
    isProtected?: boolean;
    inProgress?: boolean;
    /** Who is part-way through it. */
    inProgressFor?: string[];
  }>;
  /** Size of the list the samples are paged from. */
  sampleTotal?: number;
}

const SAMPLE_LIMIT = 10;
const SHOW_PROTECTED_KEY = 'rules-preview-show-protected';

/**
 * Whether the top-matches list includes protected items. Rules never act on
 * protected items, so they're hidden by default; the choice is remembered.
 */
function useShowProtected(): [boolean, (value: boolean) => void] {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SHOW_PROTECTED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const update = (value: boolean) => {
    setShow(value);
    try {
      localStorage.setItem(SHOW_PROTECTED_KEY, String(value));
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
  };
  return [show, update];
}

/**
 * Live preview panel for the v2 rule builder. Calls POST /api/rules/preview
 * with the current condition tree (debounced) and renders stats + samples.
 */
export function LivePreview({ root, mediaType = 'all', libraryKeys, enabled = true, onSummaryChange }: LivePreviewProps) {
  const { t } = useTranslation('rules');
  const [debouncedRoot, setDebouncedRoot] = useState<ConditionNode>(root);
  const [debouncedMediaType, setDebouncedMediaType] = useState(mediaType);
  const [debouncedLibraryKeys, setDebouncedLibraryKeys] = useState(libraryKeys);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);
  // Paging through the matches, and whether protected ones are listed. Either
  // changing only refreshes the match list, so the stats stay on screen.
  const [page, setPage] = useState(0);
  const [showProtected, setShowProtected] = useShowProtected();
  const [isPaging, setIsPaging] = useState(false);
  const listOnlyRef = useRef(false);
  // What the current match list was computed for. The page only resets when
  // this actually changes — the debounce also fires on mount and whenever the
  // editor re-renders, and those must not throw the user back to page one.
  const queryKeyRef = useRef(previewQueryKey(root, mediaType, libraryKeys));

  // Generation counter to discard stale responses — if the user edits rapidly
  // we must ignore older in-flight results that arrive after newer ones.
  const generation = useRef(0);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedRoot(root);
      setDebouncedMediaType(mediaType);
      setDebouncedLibraryKeys(libraryKeys);
      const key = previewQueryKey(root, mediaType, libraryKeys);
      if (key !== queryKeyRef.current) {
        queryKeyRef.current = key;
        setPage(0);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [root, mediaType, libraryKeys]);

  useEffect(() => {
    if (!enabled) return;
    if (!hasAnyCondition(debouncedRoot)) return;
    const myGen = ++generation.current;
    const listOnly = listOnlyRef.current;
    listOnlyRef.current = false;
    if (listOnly) setIsPaging(true);
    else setIsPending(true);
    setError(null);
    rulesApi
      .previewV2({
        version: 2,
        root: stripUiIds(debouncedRoot),
        mediaType: debouncedMediaType,
        ...(debouncedLibraryKeys && debouncedLibraryKeys.length > 0
          ? { libraryKeys: debouncedLibraryKeys }
          : {}),
        sampleOffset: page * SAMPLE_LIMIT,
        sampleLimit: SAMPLE_LIMIT,
        includeProtectedSamples: showProtected,
      })
      .then((data) => {
        if (myGen !== generation.current) return; // stale
        setPreview(data);
        setIsPending(false);
        setIsPaging(false);
      })
      .catch((err: Error) => {
        if (myGen !== generation.current) return; // stale
        setError(err);
        setIsPending(false);
        setIsPaging(false);
      });
  }, [debouncedRoot, debouncedMediaType, debouncedLibraryKeys, enabled, page, showProtected]);

  const handlePageChange = (next: number) => {
    listOnlyRef.current = true;
    setPage(next);
  };

  const handleShowProtectedChange = (value: boolean) => {
    listOnlyRef.current = true;
    setShowProtected(value);
    setPage(0);
  };

  // Surface a compact summary to any consumer (mobile chip etc.). We fire on
  // every state change so the chip stays in sync with whatever the panel
  // would render — pending spinner, error, empty, or actual numbers.
  useEffect(() => {
    if (!onSummaryChange) return;
    const isEmpty = !hasAnyCondition(debouncedRoot);
    onSummaryChange({
      isPending,
      isEmpty,
      hasError: !!error,
      total: preview?.totalMatches ?? 0,
      freedGB: preview?.storageFreedGB ?? 0,
    });
  }, [preview, error, isPending, debouncedRoot, onSummaryChange]);

  return (
    <Card className="p-5 bg-surface-800/50 h-full flex flex-col backdrop-blur-none">
      <h4 className="text-sm font-medium text-surface-300 mb-4 flex items-center gap-2">
        <Eye className="w-4 h-4" />
        {t('preview.title', 'Live Preview')}
      </h4>

      <div className="flex-1 min-h-0 flex flex-col">
        {!hasAnyCondition(debouncedRoot) ? (
          <EmptyPreview />
        ) : isPending ? (
          <LoadingSkeleton />
        ) : error ? (
          <PreviewError message={error.message} />
        ) : preview ? (
          <PreviewStats
            preview={preview}
            page={page}
            onPageChange={handlePageChange}
            showProtected={showProtected}
            onShowProtectedChange={handleShowProtectedChange}
            isPaging={isPaging}
          />
        ) : (
          <EmptyPreview />
        )}
      </div>
    </Card>
  );
}

// ────────────────────── Subcomponents ──────────────────────

function EmptyPreview() {
  const { t } = useTranslation('rules');
  return (
    <div className="text-center py-8 text-surface-500">
      <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
      <p className="text-sm">{t('preview.emptyHint', 'Add conditions to see a preview')}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-20 bg-surface-700 rounded animate-pulse" />
      <div className="h-8 bg-surface-700 rounded animate-pulse" />
      <div className="h-32 bg-surface-700 rounded animate-pulse" />
    </div>
  );
}

function PreviewError({ message }: { message: string }) {
  const { t } = useTranslation('rules');
  return (
    <div className="text-center py-6 text-ruby-text">
      <AlertCircle className="w-6 h-6 mx-auto mb-2" />
      <p className="text-sm font-medium">{t('preview.failed', 'Preview failed')}</p>
      <p className="text-xs text-surface-400 mt-1">{message}</p>
    </div>
  );
}

function PreviewStats({
  preview,
  page,
  onPageChange,
  showProtected,
  onShowProtectedChange,
  isPaging,
}: {
  preview: PreviewData;
  page: number;
  onPageChange: (page: number) => void;
  showProtected: boolean;
  onShowProtectedChange: (value: boolean) => void;
  isPaging: boolean;
}) {
  const { t } = useTranslation('rules');
  const total = preview.totalMatches ?? 0;
  const queue = preview.wouldQueue ?? 0;
  const skipped = preview.wouldSkipProtected ?? 0;
  const inProgress = preview.wouldSkipInProgress ?? 0;
  const pending = preview.alreadyPending ?? 0;
  const pillCount = 2 + (pending > 0 ? 1 : 0) + (inProgress > 0 ? 1 : 0);
  const freedGB = preview.storageFreedGB ?? 0;
  const samples = preview.samples ?? [];
  const sampleTotal = preview.sampleTotal ?? samples.length;
  const pageCount = Math.max(1, Math.ceil(sampleTotal / SAMPLE_LIMIT));
  const firstShown = page * SAMPLE_LIMIT + 1;
  const lastShown = page * SAMPLE_LIMIT + samples.length;
  // Everything that matched is protected and those are hidden.
  const allHidden = !showProtected && sampleTotal === 0 && total > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <div className="text-center py-4 bg-surface-700/60 rounded-lg shrink-0">
        <div className="text-3xl font-bold text-surface-50">
          <CountUp value={total} />
        </div>
        <div className="text-sm text-surface-400">{t('preview.itemsWouldMatch', 'items would match')}</div>
        <div className="text-lg font-medium text-emerald-text mt-1">
          {t('preview.reclaimableSuffix', '{{size}} reclaimable', { size: formatStorageGB(freedGB) })}
        </div>
      </div>

      <div className={`grid ${pillCount === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-2 shrink-0`}>
        <StatPill
          icon={<HardDrive className="w-4 h-4" />}
          label={t('preview.queue', 'Queue')}
          value={queue}
          tone="accent"
        />
        <StatPill
          icon={<Shield className="w-4 h-4" />}
          label={t('preview.protected', 'Protected')}
          value={skipped}
          tone="neutral"
        />
        {inProgress > 0 && (
          <StatPill
            icon={<PlayCircle className="w-4 h-4" />}
            label={t('preview.inProgress', 'In progress')}
            value={inProgress}
            tone="neutral"
          />
        )}
        {pending > 0 && (
          <StatPill
            icon={<Clock className="w-4 h-4" />}
            label={t('preview.alreadyPending', 'Pending')}
            value={pending}
            tone="neutral"
          />
        )}
      </div>

      {total > 0 && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
            <p className="text-xs text-surface-500">{t('preview.matchesBySize', 'Matches by size:')}</p>
            {skipped + inProgress > 0 && (
              <label className="flex items-center gap-2 text-xs text-surface-400">
                {t('preview.showProtected', 'Show protected')}
                <Toggle
                  checked={showProtected}
                  onChange={onShowProtectedChange}
                  label={t('preview.showProtected', 'Show protected')}
                />
              </label>
            )}
          </div>
          {allHidden && (
            <p className="text-xs text-surface-500 py-2">
              {t('preview.allProtected', 'Every match is protected, so this rule won’t delete anything.')}
            </p>
          )}
          <div
            className={`space-y-2 overflow-y-auto flex-1 min-h-0 transition-opacity ${isPaging ? 'opacity-50' : ''}`}
            aria-busy={isPaging}
          >
            {samples.map((item) => (
              // Opened in a new tab: the preview lives inside the rule builder,
              // so navigating in place would throw away the rule being edited.
              <Link
                key={item.id}
                to={libraryItemPath(item.id) ?? ''}
                target="_blank"
                rel="noopener noreferrer"
                title={t('preview.openItem', 'Open in a new tab')}
                className="flex items-center gap-2 p-2 bg-surface-700/50 rounded text-sm hover:bg-surface-700 transition-colors"
              >
                {item.posterUrl ? (
                  <img
                    src={item.posterUrl}
                    alt=""
                    className="w-8 h-11 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-8 h-11 bg-surface-600 rounded flex items-center justify-center flex-shrink-0">
                    <Film className="w-4 h-4 text-surface-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-surface-200 truncate flex items-center gap-1.5">
                    {item.isProtected && (
                      <Shield
                        className="w-3.5 h-3.5 text-accent-text flex-shrink-0"
                        aria-label={t('preview.protected', 'Protected')}
                      />
                    )}
                    {item.inProgress && (
                      <PlayCircle
                        className="w-3.5 h-3.5 text-violet-text flex-shrink-0"
                        aria-label={t('preview.inProgress', 'In progress')}
                      />
                    )}
                    <span className="truncate">{item.title}</span>
                  </p>
                  {item.inProgressFor && item.inProgressFor.length > 0 && (
                    <p className="text-xs text-violet-text truncate">
                      {t('preview.inProgressFor', 'Watching: {{names}}', { names: item.inProgressFor.join(', ') })}
                    </p>
                  )}
                  <p className="text-xs text-surface-500">
                    {formatBytes(item.size)}
                    {item.rating !== null && ` • ${item.rating.toFixed(1)}`}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 pt-2 shrink-0">
              <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                disabled={page === 0 || isPaging}
                aria-label={t('preview.previousPage', 'Previous page')}
                className="p-1.5 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-surface-400 tabular-nums">
                {t('preview.pageRange', '{{first}}–{{last}} of {{total}}', {
                  first: firstShown,
                  last: lastShown,
                  total: sampleTotal,
                })}
              </span>
              <button
                type="button"
                onClick={() => onPageChange(page + 1)}
                disabled={page >= pageCount - 1 || isPaging}
                aria-label={t('preview.nextPage', 'Next page')}
                className="p-1.5 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'accent' | 'neutral';
}) {
  const toneClass =
    tone === 'accent'
      ? 'bg-accent-500/10 text-surface-50 border-accent-500/30'
      : 'bg-surface-700/60 text-surface-300 border-surface-600/40';
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${toneClass}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-xs opacity-80">{label}</div>
        <div className="text-base font-semibold">{value}</div>
      </div>
    </div>
  );
}

/**
 * Animates an integer from its previous value up to `value` whenever it
 * changes (e.g. 0 → 42 when a preview resolves). Respects reduced-motion by
 * snapping instantly. Uses a motion value so only the text node updates, not
 * the React tree.
 */
function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.5, ease: [0.4, 0, 0.2, 1] });
    return () => controls.stop();
  }, [value, reduce, mv]);

  return <motion.span>{text}</motion.span>;
}

// ────────────────────── Helpers ──────────────────────

function formatStorageGB(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
  return `${gb.toFixed(2)} GB`;
}

function previewQueryKey(
  root: ConditionNode,
  mediaType: string,
  libraryKeys: string[] | undefined
): string {
  return JSON.stringify([stripUiIds(root), mediaType, libraryKeys ?? []]);
}

function hasAnyCondition(node: ConditionNode): boolean {
  if (node.kind === 'condition') return true;
  return node.children.some(hasAnyCondition);
}

