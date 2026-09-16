import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowUpCircle,
  CalendarClock,
  Check,
  ChevronRight,
  CircleSlash,
  Clock,
  Download,
  FolderOpen,
  HardDrive,
  Layers,
  Minus,
  Radio,
  RefreshCw,
  Trash2,
  Tv,
  Undo2,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Badge, type BadgeVariant } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';
import { DetailField } from './DetailField';
import { EpisodeDeletionModal, type EpisodeDeletionOptions } from './EpisodeDeletionModal';
import { filterSeasons, summariseSelection, type EpisodeFilter } from './sonarrPanelUtils';
import {
  useCancelSonarrEpisodeDeletions,
  useDeleteSonarrEpisodes,
  useSonarrDetail,
} from '@/hooks/useApi';
import { cn, formatBytes, formatDate, formatRelativeTime } from '@/lib/utils';
import type {
  SonarrEpisodeState,
  SonarrEpisodeSummary,
  SonarrSeasonSummary,
} from '@/types';

// One colour per episode state, shared by the season strip, the row dot and the
// status badge so a colour always means the same thing across the panel.
const STATE_STYLES: Record<
  SonarrEpisodeState,
  { strip: string; dot: string; badge: BadgeVariant }
> = {
  downloaded: { strip: 'bg-emerald-500', dot: 'bg-emerald-500', badge: 'success' },
  downloading: { strip: 'bg-cyan-500', dot: 'bg-cyan-500', badge: 'cyan' },
  missing: { strip: 'bg-ruby-500', dot: 'bg-ruby-500', badge: 'danger' },
  unaired: { strip: 'bg-surface-700', dot: 'bg-surface-600', badge: 'default' },
  unmonitored: { strip: 'bg-surface-700/50', dot: 'bg-surface-700', badge: 'muted' },
};

export interface SonarrSeriesPanelProps {
  /** Library item id; the panel resolves the Sonarr series server-side. */
  itemId: string;
}

/**
 * Live Sonarr breakdown for a show: series status, disk usage, and a season
 * tree down to per-episode file quality and download progress.
 */
export function SonarrSeriesPanel({ itemId }: SonarrSeriesPanelProps) {
  const { t } = useTranslation('library');
  const { addToast } = useToast();
  const { data, isLoading, isError, isFetching } = useSonarrDetail(itemId);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<EpisodeFilter>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingMode, setPendingMode] = useState<'queue' | 'now' | null>(null);

  const deleteEpisodes = useDeleteSonarrEpisodes(itemId);
  const cancelDeletions = useCancelSonarrEpisodeDeletions(itemId);

  const seasons = useMemo(() => data?.seasons ?? [], [data?.seasons]);
  const visibleSeasons = useMemo(() => filterSeasons(seasons, filter), [seasons, filter]);
  const selection = useMemo(() => summariseSelection(seasons, selected), [seasons, selected]);

  const toggleSeason = (seasonNumber: number) => {
    setExpandedSeasons((current) => {
      const next = new Set(current);
      if (next.has(seasonNumber)) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });
  };

  const toggleEpisode = (episodeId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(episodeId)) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
  };

  /**
   * Season checkbox: select every episode currently listed under it, or clear
   * them. Under a filter that is the filtered set, so the count in the action
   * bar always matches what is on screen.
   */
  const toggleSeasonSelection = (episodes: SonarrEpisodeSummary[]) => {
    const ids = episodes.map((episode) => episode.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = (options: EpisodeDeletionOptions) => {
    const mode = pendingMode ?? 'queue';

    deleteEpisodes.mutate(
      { episodeIds: selection.episodeIds, ...options, mode },
      {
        onSuccess: (result) => {
          setPendingMode(null);
          setSelected(new Set());
          addToast({
            type: result.failed > 0 ? 'warning' : 'success',
            title:
              mode === 'now'
                ? t('episodeDeletion.toastDeleted', 'Episodes deleted')
                : t('episodeDeletion.toastQueued', 'Episodes queued'),
            message:
              mode === 'now'
                ? t('episodeDeletion.toastDeletedMsg', 'Deleted {{count}} episodes, freeing {{size}}', {
                    count: result.deleted,
                    size: formatBytes(result.freedBytes),
                  })
                : t('episodeDeletion.toastQueuedMsg', 'Queued {{count}} episodes for deletion', {
                    count: result.queued,
                  }),
          });
        },
        onError: (error: Error) => {
          addToast({
            type: 'error',
            title: t('episodeDeletion.toastFailed', 'Could not delete episodes'),
            message: error.message,
          });
        },
      }
    );
  };

  const handleCancelQueued = () => {
    cancelDeletions.mutate(selection.queuedIds, {
      onSuccess: (result) => {
        setSelected(new Set());
        addToast({
          type: 'success',
          title: t('episodeDeletion.toastCancelled', 'Removed from the queue'),
          message: t('episodeDeletion.toastCancelledMsg', '{{count}} episodes will be kept', {
            count: result.cancelled,
          }),
        });
      },
      onError: (error: Error) => {
        addToast({
          type: 'error',
          title: t('episodeDeletion.toastCancelFailed', 'Could not cancel'),
          message: error.message,
        });
      },
    });
  };

  if (isLoading) return <SonarrPanelSkeleton />;

  if (isError) {
    return (
      <PanelShell>
        <PanelNote
          icon={<AlertTriangle className="w-8 h-8 text-ruby-400" />}
          text={t('sonarr.unreachable', 'Could not reach Sonarr. Check the connection in Settings.')}
        />
      </PanelShell>
    );
  }

  if (!data?.configured) {
    return (
      <PanelShell>
        <PanelNote
          icon={<Radio className="w-8 h-8 text-surface-500" />}
          text={t('sonarr.notConfigured', 'Connect Sonarr in Settings to see episode-level detail for this show.')}
        />
      </PanelShell>
    );
  }

  if (!data.linked || !data.series || !data.totals) {
    return (
      <PanelShell>
        <PanelNote
          icon={<CircleSlash className="w-8 h-8 text-surface-500" />}
          text={t('sonarr.notLinked', 'This show is not matched to a series in Sonarr, so there is no episode detail to show.')}
        />
      </PanelShell>
    );
  }

  const { series, totals } = data;

  return (
    <PanelShell
      fetchedAt={data.fetchedAt}
      isFetching={isFetching}
      badges={
        <>
          <Badge variant={series.monitored ? 'success' : 'muted'}>
            {series.monitored
              ? t('sonarr.monitored', 'Monitored')
              : t('sonarr.unmonitored', 'Unmonitored')}
          </Badge>
          <Badge variant={series.ended ? 'default' : 'cyan'}>
            {series.ended ? t('sonarr.ended', 'Ended') : t('sonarr.continuing', 'Continuing')}
          </Badge>
          {series.qualityProfileName && (
            <Badge variant="violet">{series.qualityProfileName}</Badge>
          )}
        </>
      }
    >
      {/* Series stats, in the same shape as the Details card above */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DetailField
          icon={<Layers className="w-4 h-4" />}
          label={t('sonarr.stats.episodes', 'Episodes on disk')}
          value={t('sonarr.stats.episodesValue', '{{files}} of {{aired}} aired', {
            files: totals.episodeFileCount,
            aired: totals.airedCount,
          })}
        />
        <DetailField
          icon={<HardDrive className="w-4 h-4" />}
          label={t('sonarr.stats.onDisk', 'Size on disk')}
          value={`${formatBytes(totals.sizeOnDisk)} · ${t('sonarr.stats.seasons', '{{count}} seasons', { count: totals.seasonCount })}`}
        />
        <DetailField
          icon={<AlertTriangle className="w-4 h-4" />}
          label={t('sonarr.stats.missing', 'Missing episodes')}
          value={
            totals.downloadingCount > 0
              ? `${totals.missingCount} · ${t('sonarr.stats.downloading', '{{count}} downloading', { count: totals.downloadingCount })}`
              : String(totals.missingCount)
          }
          {...(totals.missingCount > 0 ? { valueClassName: 'text-ruby-400' } : {})}
        />
        <DetailField
          icon={<ArrowUpCircle className="w-4 h-4" />}
          label={t('sonarr.stats.upgradable', 'Below quality cutoff')}
          value={String(totals.cutoffUnmetCount)}
        />
      </div>

      {/* Completion bar */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="text-surface-400">{t('sonarr.completion', 'Library completion')}</span>
          <span className="text-surface-500 tabular-nums">{totals.percentComplete}%</span>
        </div>
        <ProgressBar percent={totals.percentComplete} />
      </div>

      {/* Series meta */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-surface-400">
        {series.network && (
          <MetaItem icon={<Radio className="w-3.5 h-3.5" />} value={series.network} />
        )}
        {series.nextAiring && (
          <MetaItem
            icon={<CalendarClock className="w-3.5 h-3.5" />}
            value={t('sonarr.nextAiring', 'Next episode {{when}}', {
              when: formatRelativeTime(series.nextAiring),
            })}
          />
        )}
        {series.path && (
          <MetaItem
            icon={<FolderOpen className="w-3.5 h-3.5" />}
            value={series.path}
            className="text-surface-500"
          />
        )}
        {series.tags.map((tag) => (
          <Badge key={tag} variant="muted" size="sm">
            {tag}
          </Badge>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <FilterButton
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          icon={Layers}
          label={t('sonarr.filter.all', 'All episodes')}
          count={totals.episodeCount}
        />
        {totals.missingCount > 0 && (
          <FilterButton
            active={filter === 'missing'}
            onClick={() => setFilter('missing')}
            icon={AlertTriangle}
            label={t('sonarr.filter.missing', 'Missing')}
            count={totals.missingCount}
            color="ruby"
          />
        )}
        {totals.downloadingCount > 0 && (
          <FilterButton
            active={filter === 'downloading'}
            onClick={() => setFilter('downloading')}
            icon={Download}
            label={t('sonarr.filter.downloading', 'Downloading')}
            count={totals.downloadingCount}
            color="cyan"
          />
        )}
        {totals.cutoffUnmetCount > 0 && (
          <FilterButton
            active={filter === 'upgradable'}
            onClick={() => setFilter('upgradable')}
            icon={ArrowUpCircle}
            label={t('sonarr.filter.upgradable', 'Upgradable')}
            count={totals.cutoffUnmetCount}
            color="violet"
          />
        )}
        {totals.queuedCount > 0 && (
          <FilterButton
            active={filter === 'queued'}
            onClick={() => setFilter('queued')}
            icon={Clock}
            label={t('sonarr.filter.queued', 'Queued')}
            count={totals.queuedCount}
          />
        )}
      </div>

      {/* Selection actions */}
      {selection.episodeIds.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-accent-500/30 bg-accent-500/10 animate-fade-down">
          <span className="text-sm text-surface-200">
            {t('sonarr.selection.count', '{{count}} episodes selected', {
              count: selection.episodeIds.length,
            })}
            {selection.totalSize > 0 && (
              <span className="text-surface-400"> · {formatBytes(selection.totalSize)}</span>
            )}
          </span>

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {selection.queuedIds.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCancelQueued}
                isLoading={cancelDeletions.isPending}
              >
                <Undo2 className="w-4 h-4" />
                {t('sonarr.selection.cancelQueued', 'Cancel deletion ({{count}})', {
                  count: selection.queuedIds.length,
                })}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setPendingMode('queue')}>
              <Clock className="w-4 h-4" />
              {t('sonarr.selection.queue', 'Queue for deletion')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => setPendingMode('now')}>
              <Trash2 className="w-4 h-4" />
              {t('sonarr.selection.deleteNow', 'Delete now')}
            </Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-surface-400 hover:text-surface-200 px-2 py-1 transition-colors"
            >
              {t('sonarr.selection.clear', 'Clear')}
            </button>
          </div>
        </div>
      )}

      {/* Season tree */}
      <div className="mt-4 space-y-2">
        {visibleSeasons.length === 0 ? (
          <p className="text-sm text-surface-500 py-6 text-center">
            {t('sonarr.noSeasons', 'Sonarr has no seasons for this series yet.')}
          </p>
        ) : (
          visibleSeasons.map(({ season, episodes }) => (
            <SeasonRow
              key={season.seasonNumber}
              season={season}
              episodes={episodes}
              // A filter narrows the tree to what matters, so open it up.
              expanded={filter !== 'all' || expandedSeasons.has(season.seasonNumber)}
              onToggle={() => toggleSeason(season.seasonNumber)}
              toggleable={filter === 'all'}
              selected={selected}
              onToggleEpisode={toggleEpisode}
              onToggleSeason={() => toggleSeasonSelection(episodes)}
            />
          ))
        )}
      </div>

      <EpisodeDeletionModal
        isOpen={pendingMode !== null}
        onClose={() => setPendingMode(null)}
        onConfirm={handleConfirm}
        mode={pendingMode ?? 'queue'}
        episodeCount={selection.episodeIds.length}
        totalSize={selection.totalSize}
        isLoading={deleteEpisodes.isPending}
      />
    </PanelShell>
  );
}

function SeasonRow({
  season,
  episodes,
  expanded,
  onToggle,
  toggleable,
  selected,
  onToggleEpisode,
  onToggleSeason,
}: {
  season: SonarrSeasonSummary;
  episodes: SonarrEpisodeSummary[];
  expanded: boolean;
  onToggle: () => void;
  toggleable: boolean;
  selected: Set<number>;
  onToggleEpisode: (episodeId: number) => void;
  onToggleSeason: () => void;
}) {
  const { t } = useTranslation('library');

  const label =
    season.seasonNumber === 0
      ? t('sonarr.specials', 'Specials')
      : t('sonarr.season', 'Season {{number}}', { number: season.seasonNumber });

  const seasonIds = episodes.map((episode) => episode.id);
  const allSelected = seasonIds.length > 0 && seasonIds.every((id) => selected.has(id));
  const someSelected = !allSelected && seasonIds.some((id) => selected.has(id));

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden transition-colors',
        allSelected || someSelected
          ? 'border-accent-500/40 bg-accent-500/5'
          : 'border-surface-700/50 bg-surface-800/30'
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <SelectionCheckbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={onToggleSeason}
          label={t('sonarr.selection.selectSeason', 'Select the listed episodes in {{season}}', { season: label })}
        />

        <button
          type="button"
          onClick={toggleable ? onToggle : undefined}
          aria-expanded={expanded}
          disabled={!toggleable}
          className={cn(
            'flex-1 flex items-center gap-3 text-left min-w-0 -my-3 py-3 transition-colors',
            toggleable && 'hover:opacity-90 cursor-pointer',
            !toggleable && 'cursor-default'
          )}
        >
        <ChevronRight
          className={cn(
            'w-4 h-4 text-surface-500 flex-shrink-0 transition-transform duration-200',
            expanded && 'rotate-90',
            !toggleable && 'opacity-0'
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-surface-200">{label}</span>
            {!season.monitored && (
              <Badge variant="muted" size="sm">
                {t('sonarr.unmonitored', 'Unmonitored')}
              </Badge>
            )}
            {season.missingCount > 0 && (
              <Badge variant="danger" size="sm">
                {t('sonarr.missingCount', '{{count}} missing', { count: season.missingCount })}
              </Badge>
            )}
            {season.downloadingCount > 0 && (
              <Badge variant="cyan" size="sm">
                {t('sonarr.downloadingCount', '{{count}} downloading', { count: season.downloadingCount })}
              </Badge>
            )}
            {season.queuedCount > 0 && (
              <Badge variant="accent" size="sm">
                <Clock className="w-3 h-3" />
                {t('sonarr.queuedCount', '{{count}} queued', { count: season.queuedCount })}
              </Badge>
            )}
          </div>
          {/* Per-episode status strip: one segment per episode, coloured by state. */}
          <EpisodeStrip episodes={season.episodes} className="mt-2" />
        </div>

          <div className="text-right flex-shrink-0">
            <p className="text-xs text-surface-400 tabular-nums">
              {season.episodeFileCount}
              <span className="text-surface-600">/{season.airedCount || season.episodeCount}</span>
            </p>
            <p className="text-2xs text-surface-600 mt-0.5">{formatBytes(season.sizeOnDisk)}</p>
          </div>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-surface-700/50 divide-y divide-surface-700/30 animate-fade-down">
          {episodes.length === 0 ? (
            <p className="px-4 py-3 text-xs text-surface-500">
              {t('sonarr.noEpisodes', 'No episodes in this season yet.')}
            </p>
          ) : (
            episodes.map((episode) => (
              <EpisodeRow
                key={episode.id}
                episode={episode}
                selected={selected.has(episode.id)}
                onToggleSelect={() => onToggleEpisode(episode.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EpisodeStrip({
  episodes,
  className,
}: {
  episodes: SonarrEpisodeSummary[];
  className?: string;
}) {
  if (episodes.length === 0) return null;

  return (
    <div className={cn('flex gap-[2px] h-1.5', className)} aria-hidden="true">
      {episodes.map((episode) => (
        <span
          key={episode.id}
          className={cn(
            'flex-1 rounded-full min-w-[2px]',
            // Queued wins: it is the thing about to change.
            episode.queued ? 'bg-accent-500' : STATE_STYLES[episode.state].strip
          )}
        />
      ))}
    </div>
  );
}

function EpisodeRow({
  episode,
  selected,
  onToggleSelect,
}: {
  episode: SonarrEpisodeSummary;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { t } = useTranslation('library');
  const [open, setOpen] = useState(false);

  const style = STATE_STYLES[episode.state];
  const expandable = Boolean(episode.file || episode.download);

  const stateLabel: Record<SonarrEpisodeState, string> = {
    downloaded: t('sonarr.state.downloaded', 'Downloaded'),
    downloading: t('sonarr.state.downloading', 'Downloading'),
    missing: t('sonarr.state.missing', 'Missing'),
    unaired: t('sonarr.state.unaired', 'Not aired'),
    unmonitored: t('sonarr.state.unmonitored', 'Unmonitored'),
  };

  const code = `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;

  const rowClassName = cn(
    'flex-1 flex items-center gap-3 text-left min-w-0 -my-3 py-3',
    expandable && 'cursor-pointer'
  );

  const row = (
    <>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', style.dot)} />
      {/* The code gets its own aligned column from sm up; below that it rides
          along in the meta line so the title keeps the width. */}
      <span className="hidden sm:block text-2xs text-surface-500 tabular-nums w-12 flex-shrink-0">
        {code}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-surface-200 truncate">{episode.title}</p>
        {/* One clipped line so rows keep an even height at every width. */}
        <p className="mt-1 text-xs text-surface-500 truncate">
          <span className="sm:hidden tabular-nums">{code} · </span>
          {episode.airDateUtc ? formatDate(episode.airDateUtc) : t('sonarr.noAirDate', 'No air date')}
          {episode.file?.quality && (
            <>
              <span className="text-surface-700"> · </span>
              <span className="text-surface-400">{episode.file.quality}</span>
              {episode.file.qualityRevision && (
                <span className="text-accent-text"> {episode.file.qualityRevision}</span>
              )}
            </>
          )}
          {episode.file && (
            <>
              <span className="text-surface-700"> · </span>
              <span className="tabular-nums">{formatBytes(episode.file.size)}</span>
            </>
          )}
          {episode.download && (
            <>
              <span className="text-surface-700"> · </span>
              <span className="text-cyan-400 tabular-nums">{episode.download.progress}%</span>
            </>
          )}
        </p>
      </div>

      {episode.file?.qualityCutoffNotMet && (
        <Badge variant="violet" size="sm" className="hidden sm:inline-flex">
          <ArrowUpCircle className="w-3 h-3" />
          {t('sonarr.upgradable', 'Upgradable')}
        </Badge>
      )}

      {episode.queued && (
        <Badge variant="accent" size="sm" className="hidden sm:inline-flex">
          <Clock className="w-3 h-3" />
          {t('sonarr.queuedIn', 'Deletes {{when}}', {
            when: formatRelativeTime(episode.queued.deleteAfter),
          })}
        </Badge>
      )}

      <Badge variant={style.badge} size="sm">
        {stateLabel[episode.state]}
      </Badge>

      {expandable && (
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 text-surface-600 flex-shrink-0 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
      )}
    </>
  );

  return (
    <div className={cn('transition-colors', selected && 'bg-accent-500/5')}>
      <div className={cn('flex items-center gap-3 px-4 py-3', expandable && 'hover:bg-surface-800/60')}>
        <SelectionCheckbox
          checked={selected}
          onChange={onToggleSelect}
          label={t('sonarr.selection.selectEpisode', 'Select {{title}}', { title: episode.title })}
        />
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className={rowClassName}
          >
            {row}
          </button>
        ) : (
          <div className={rowClassName}>{row}</div>
        )}
      </div>

      {open && (
        <div className="px-4 pb-4 sm:pl-[6.25rem] animate-fade-down">
          {episode.download && (
            <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs font-medium text-cyan-400 truncate">
                  {episode.download.title || t('sonarr.state.downloading', 'Downloading')}
                </span>
                <span className="text-xs text-surface-500 tabular-nums flex-shrink-0">
                  {formatBytes(episode.download.size - episode.download.sizeleft)}
                  <span className="text-surface-600"> / {formatBytes(episode.download.size)}</span>
                </span>
              </div>
              <ProgressBar percent={episode.download.progress} tone="cyan" />
              {episode.download.estimatedCompletionTime && (
                <p className="text-xs text-surface-500 mt-2">
                  {t('sonarr.eta', 'Done {{when}}', {
                    when: formatRelativeTime(episode.download.estimatedCompletionTime),
                  })}
                </p>
              )}
              {episode.download.errorMessage && (
                <p className="text-xs text-ruby-400 mt-2">{episode.download.errorMessage}</p>
              )}
            </div>
          )}

          {episode.file && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              <FileField
                label={t('sonarr.file.added', 'Imported')}
                value={episode.file.dateAdded ? formatDate(episode.file.dateAdded) : undefined}
              />
              <FileField
                label={t('sonarr.file.releaseGroup', 'Release group')}
                value={episode.file.releaseGroup}
              />
              <FileField
                label={t('sonarr.file.video', 'Video')}
                value={[episode.file.resolution, episode.file.videoCodec].filter(Boolean).join(' · ')}
              />
              <FileField
                label={t('sonarr.file.audio', 'Audio')}
                value={[
                  episode.file.audioCodec,
                  episode.file.audioChannels ? `${episode.file.audioChannels}ch` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <FileField
                label={t('sonarr.file.languages', 'Languages')}
                value={episode.file.languages?.join(', ')}
              />
              <FileField
                label={t('sonarr.file.subtitles', 'Subtitles')}
                value={episode.file.subtitles?.join(', ')}
              />
              <FileField
                label={t('sonarr.file.runtime', 'Runtime')}
                value={episode.file.runTime}
              />
              <FileField
                label={t('sonarr.file.path', 'File')}
                value={episode.file.relativePath}
                className="sm:col-span-2"
              />
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

/** House checkbox: same look as the library table's row selection. */
function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all',
        checked
          ? 'bg-accent-500 border-accent-500'
          : indeterminate
            ? 'border-accent-500 bg-accent-500/30'
            : 'border-surface-600 hover:border-surface-400'
      )}
    >
      {checked ? (
        <Check className="w-3 h-3 text-white" />
      ) : (
        indeterminate && <Minus className="w-3 h-3 text-accent-text" />
      )}
    </button>
  );
}

function FileField({
  label,
  value,
  className,
}: {
  label: string;
  value?: string;
  className?: string;
}) {
  if (!value) return null;

  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-surface-500 font-medium">{label}</dt>
      <dd className="text-sm text-surface-200 mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function ProgressBar({ percent, tone = 'accent' }: { percent: number; tone?: 'accent' | 'cyan' }) {
  return (
    <div className="h-1.5 bg-surface-700/60 rounded-full overflow-hidden">
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500',
          tone === 'cyan' ? 'bg-cyan-500' : 'bg-accent-500'
        )}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function MetaItem({
  icon,
  value,
  className,
}: {
  icon: React.ReactNode;
  value: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 min-w-0', className)}>
      <span className="text-surface-500 flex-shrink-0">{icon}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

/** Same shape as the Library's type filters, with a count instead of a colour dot. */
function FilterButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  count: number;
  color?: 'ruby' | 'cyan' | 'violet';
}) {
  const colorClasses = {
    ruby: 'bg-ruby-500/20 text-ruby-400 border-ruby-500/30',
    cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    violet: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border',
        active
          ? color
            ? colorClasses[color]
            : 'bg-accent-500/20 text-accent-text border-accent-500/30'
          : 'bg-surface-800/60 text-surface-400 border-transparent hover:text-surface-200 hover:bg-surface-700/60'
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
      <span className="text-xs tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function PanelShell({
  children,
  badges,
  fetchedAt,
  isFetching,
}: {
  children: React.ReactNode;
  badges?: React.ReactNode;
  fetchedAt?: string;
  isFetching?: boolean;
}) {
  const { t } = useTranslation('library');

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <Tv className="w-4 h-4 text-surface-400" />
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
          {t('sonarr.heading', 'Sonarr')}
        </h2>
        {isFetching ? (
          <RefreshCw className="w-3 h-3 text-surface-500 animate-spin" />
        ) : (
          fetchedAt && (
            <span className="text-2xs text-surface-600">
              {t('sonarr.updated', 'updated {{when}}', { when: formatRelativeTime(fetchedAt) })}
            </span>
          )
        )}
        {badges && <div className="ml-auto flex items-center gap-2 flex-wrap">{badges}</div>}
      </div>
      {children}
    </Card>
  );
}

function PanelNote({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="p-4 rounded-2xl bg-surface-800/50 mb-4">{icon}</div>
      <p className="text-surface-400 text-sm font-medium max-w-md">{text}</p>
    </div>
  );
}

function SonarrPanelSkeleton() {
  return (
    <Card className="p-6">
      <div className="h-4 w-24 bg-surface-800/80 rounded animate-pulse mb-5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-800/80 animate-pulse" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3 w-20 bg-surface-800/60 rounded animate-pulse" />
              <div className="h-4 w-28 bg-surface-800/80 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-1.5 rounded-full bg-surface-800/80 animate-pulse mt-5" />
      <div className="mt-6 space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-surface-800/50 animate-pulse" />
        ))}
      </div>
    </Card>
  );
}

export default SonarrSeriesPanel;
