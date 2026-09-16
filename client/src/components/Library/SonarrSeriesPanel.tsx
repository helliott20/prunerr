import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowUpCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Download,
  FolderOpen,
  HardDrive,
  Layers,
  Radio,
  RefreshCw,
  Tv,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { useSonarrDetail } from '@/hooks/useApi';
import { cn, formatBytes, formatDate, formatRelativeTime } from '@/lib/utils';
import { filterSeasons, type EpisodeFilter } from './sonarrPanelUtils';
import type {
  SonarrEpisodeState,
  SonarrEpisodeSummary,
  SonarrSeasonSummary,
} from '@/types';

// Colour language for episode state, shared by the season strip, the state
// dots and the episode pills so one colour always means one thing.
const STATE_STYLES: Record<
  SonarrEpisodeState,
  { strip: string; dot: string; text: string; icon: typeof CheckCircle2 }
> = {
  downloaded: {
    strip: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
    icon: CheckCircle2,
  },
  downloading: {
    strip: 'bg-cyan-400 animate-pulse',
    dot: 'bg-cyan-400',
    text: 'text-cyan-400',
    icon: Download,
  },
  missing: {
    strip: 'bg-ruby-500',
    dot: 'bg-ruby-500',
    text: 'text-ruby-400',
    icon: AlertTriangle,
  },
  unaired: {
    strip: 'bg-surface-700',
    dot: 'bg-surface-600',
    text: 'text-surface-400',
    icon: CalendarClock,
  },
  unmonitored: {
    strip: 'bg-surface-700/50',
    dot: 'bg-surface-700',
    text: 'text-surface-500',
    icon: CircleSlash,
  },
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
  const { data, isLoading, isError, isFetching } = useSonarrDetail(itemId);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<EpisodeFilter>('all');

  const visibleSeasons = useMemo(
    () => filterSeasons(data?.seasons ?? [], filter),
    [data?.seasons, filter]
  );

  const toggleSeason = (seasonNumber: number) => {
    setExpandedSeasons((current) => {
      const next = new Set(current);
      if (next.has(seasonNumber)) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });
  };

  if (isLoading) return <SonarrPanelSkeleton />;

  if (isError) {
    return (
      <PanelShell>
        <PanelNote
          icon={<AlertTriangle className="w-4 h-4 text-ruby-400" />}
          text={t('sonarr.unreachable', 'Could not reach Sonarr. Check the connection in Settings.')}
        />
      </PanelShell>
    );
  }

  if (!data?.configured) {
    return (
      <PanelShell>
        <PanelNote
          icon={<Radio className="w-4 h-4 text-surface-500" />}
          text={t('sonarr.notConfigured', 'Connect Sonarr in Settings to see episode-level detail for this show.')}
        />
      </PanelShell>
    );
  }

  if (!data.linked || !data.series || !data.totals) {
    return (
      <PanelShell>
        <PanelNote
          icon={<CircleSlash className="w-4 h-4 text-surface-500" />}
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
          <Badge variant={series.monitored ? 'success' : 'muted'} size="sm">
            {series.monitored
              ? t('sonarr.monitored', 'Monitored')
              : t('sonarr.unmonitored', 'Unmonitored')}
          </Badge>
          <Badge variant={series.ended ? 'default' : 'cyan'} size="sm">
            {series.ended ? t('sonarr.ended', 'Ended') : t('sonarr.continuing', 'Continuing')}
          </Badge>
          {series.qualityProfileName && (
            <Badge variant="violet" size="sm">
              {series.qualityProfileName}
            </Badge>
          )}
        </>
      }
    >
      {/* Series stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={<Layers className="w-3.5 h-3.5" />}
          label={t('sonarr.stats.episodes', 'Episodes on disk')}
          value={`${totals.episodeFileCount} / ${totals.airedCount}`}
          hint={t('sonarr.stats.airedHint', '{{count}} aired', { count: totals.airedCount })}
        />
        <StatTile
          icon={<HardDrive className="w-3.5 h-3.5" />}
          label={t('sonarr.stats.onDisk', 'Size on disk')}
          value={formatBytes(totals.sizeOnDisk)}
          hint={t('sonarr.stats.seasons', '{{count}} seasons', { count: totals.seasonCount })}
        />
        <StatTile
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          label={t('sonarr.stats.missing', 'Missing')}
          value={String(totals.missingCount)}
          tone={totals.missingCount > 0 ? 'warn' : 'default'}
        />
        <StatTile
          icon={<ArrowUpCircle className="w-3.5 h-3.5" />}
          label={t('sonarr.stats.upgradable', 'Upgradable')}
          value={String(totals.cutoffUnmetCount)}
          hint={
            totals.downloadingCount > 0
              ? t('sonarr.stats.downloading', '{{count}} downloading', { count: totals.downloadingCount })
              : undefined
          }
        />
      </div>

      {/* Completion bar */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-medium text-surface-400">
            {t('sonarr.completion', 'Library completion')}
          </span>
          <span className="text-xs font-mono text-surface-300">{totals.percentComplete}%</span>
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
            className="font-mono text-2xs break-all"
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
        <FilterPill
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={t('sonarr.filter.all', 'All episodes')}
          count={totals.episodeCount}
        />
        {totals.missingCount > 0 && (
          <FilterPill
            active={filter === 'missing'}
            onClick={() => setFilter('missing')}
            label={t('sonarr.filter.missing', 'Missing')}
            count={totals.missingCount}
            tone="ruby"
          />
        )}
        {totals.downloadingCount > 0 && (
          <FilterPill
            active={filter === 'downloading'}
            onClick={() => setFilter('downloading')}
            label={t('sonarr.filter.downloading', 'Downloading')}
            count={totals.downloadingCount}
            tone="cyan"
          />
        )}
        {totals.cutoffUnmetCount > 0 && (
          <FilterPill
            active={filter === 'upgradable'}
            onClick={() => setFilter('upgradable')}
            label={t('sonarr.filter.upgradable', 'Upgradable')}
            count={totals.cutoffUnmetCount}
            tone="violet"
          />
        )}
      </div>

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
            />
          ))
        )}
      </div>
    </PanelShell>
  );
}

function SeasonRow({
  season,
  episodes,
  expanded,
  onToggle,
  toggleable,
}: {
  season: SonarrSeasonSummary;
  episodes: SonarrEpisodeSummary[];
  expanded: boolean;
  onToggle: () => void;
  toggleable: boolean;
}) {
  const { t } = useTranslation('library');

  const label =
    season.seasonNumber === 0
      ? t('sonarr.specials', 'Specials')
      : t('sonarr.season', 'Season {{number}}', { number: season.seasonNumber });

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-800/30 overflow-hidden">
      <button
        type="button"
        onClick={toggleable ? onToggle : undefined}
        aria-expanded={expanded}
        disabled={!toggleable}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
          toggleable && 'hover:bg-surface-800/60 cursor-pointer',
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
            <span className="text-sm font-medium text-surface-100">{label}</span>
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
          </div>
          {/* Per-episode status strip: one segment per episode, coloured by state. */}
          <EpisodeStrip episodes={season.episodes} className="mt-2" />
        </div>

        <div className="text-right flex-shrink-0">
          <p className="text-sm font-mono text-surface-200">
            {season.episodeFileCount}/{season.airedCount || season.episodeCount}
          </p>
          <p className="text-2xs text-surface-500 mt-0.5">{formatBytes(season.sizeOnDisk)}</p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-surface-700/50 divide-y divide-surface-700/30 animate-fade-down">
          {episodes.length === 0 ? (
            <p className="px-4 py-3 text-xs text-surface-500">
              {t('sonarr.noEpisodes', 'No episodes in this season yet.')}
            </p>
          ) : (
            episodes.map((episode) => <EpisodeRow key={episode.id} episode={episode} />)
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
          className={cn('flex-1 rounded-full min-w-[2px]', STATE_STYLES[episode.state].strip)}
        />
      ))}
    </div>
  );
}

function EpisodeRow({ episode }: { episode: SonarrEpisodeSummary }) {
  const { t } = useTranslation('library');
  const [open, setOpen] = useState(false);

  const style = STATE_STYLES[episode.state];
  const StateIcon = style.icon;
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
    'w-full flex items-center gap-3 px-4 py-2.5 text-left',
    expandable && 'hover:bg-surface-800/40 transition-colors cursor-pointer'
  );

  const row = (
    <>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', style.dot)} />
      <span className="font-mono text-2xs text-surface-500 w-12 flex-shrink-0">{code}</span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-surface-200 truncate">{episode.title}</p>
        <p className="text-2xs text-surface-500 mt-0.5">
          {episode.airDateUtc
            ? formatDate(episode.airDateUtc)
            : t('sonarr.noAirDate', 'No air date')}
          {episode.download && ` · ${episode.download.progress}%`}
        </p>
      </div>

      {episode.file?.quality && (
        <span className="hidden sm:inline-flex items-center gap-1 text-2xs text-surface-400 font-medium">
          {episode.file.quality}
          {episode.file.qualityRevision && (
            <span className="text-accent-text">{episode.file.qualityRevision}</span>
          )}
        </span>
      )}

      {episode.file?.qualityCutoffNotMet && (
        <ArrowUpCircle
          className="w-3.5 h-3.5 text-violet-400 flex-shrink-0"
          aria-label={t('sonarr.cutoffNotMet', 'Below quality cutoff')}
        />
      )}

      <span className="hidden sm:block text-2xs font-mono text-surface-400 w-20 text-right flex-shrink-0">
        {episode.file ? formatBytes(episode.file.size) : ''}
      </span>

      <span className={cn('flex items-center gap-1.5 text-2xs flex-shrink-0', style.text)}>
        <StateIcon className="w-3.5 h-3.5" />
        <span className="hidden md:inline">{stateLabel[episode.state]}</span>
      </span>

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
    <div className="bg-surface-900/20">
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

      {open && (
        <div className="px-4 pb-3 pl-[4.25rem] animate-fade-down">
          {episode.download && (
            <div className="mb-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs text-cyan-400 font-medium truncate">
                  {episode.download.title || t('sonarr.state.downloading', 'Downloading')}
                </span>
                <span className="text-2xs font-mono text-surface-400 flex-shrink-0">
                  {formatBytes(episode.download.size - episode.download.sizeleft)} /{' '}
                  {formatBytes(episode.download.size)}
                </span>
              </div>
              <ProgressBar percent={episode.download.progress} tone="cyan" />
              {episode.download.estimatedCompletionTime && (
                <p className="text-2xs text-surface-500 mt-2">
                  {t('sonarr.eta', 'Done {{when}}', {
                    when: formatRelativeTime(episode.download.estimatedCompletionTime),
                  })}
                </p>
              )}
              {episode.download.errorMessage && (
                <p className="text-2xs text-ruby-400 mt-2">{episode.download.errorMessage}</p>
              )}
            </div>
          )}

          {episode.file && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
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
                mono
              />
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

function FileField({
  label,
  value,
  className,
  mono,
}: {
  label: string;
  value?: string;
  className?: string;
  mono?: boolean;
}) {
  if (!value) return null;

  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-2xs text-surface-500">{label}</dt>
      <dd className={cn('text-xs text-surface-300 break-all', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

function ProgressBar({ percent, tone = 'accent' }: { percent: number; tone?: 'accent' | 'cyan' }) {
  return (
    <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden">
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500',
          tone === 'cyan' ? 'bg-cyan-400' : 'bg-emerald-500'
        )}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn';
}) {
  return (
    <div className="rounded-xl bg-surface-800/40 border border-surface-700/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-surface-500">
        {icon}
        <span className="text-2xs font-medium uppercase tracking-wider truncate">{label}</span>
      </div>
      <p
        className={cn(
          'text-lg font-semibold mt-1 tabular-nums',
          tone === 'warn' ? 'text-accent-text' : 'text-surface-100'
        )}
      >
        {value}
      </p>
      {hint && <p className="text-2xs text-surface-500">{hint}</p>}
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

function FilterPill({
  active,
  onClick,
  label,
  count,
  tone = 'default',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: 'default' | 'ruby' | 'cyan' | 'violet';
}) {
  const activeTone: Record<string, string> = {
    default: 'bg-surface-700/70 text-surface-50 border-surface-600',
    ruby: 'bg-ruby-500/15 text-ruby-400 border-ruby-500/40',
    cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/40',
    violet: 'bg-violet-500/15 text-violet-400 border-violet-500/40',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
        active
          ? activeTone[tone]
          : 'bg-surface-800/40 text-surface-400 border-surface-700/50 hover:text-surface-200 hover:border-surface-600/70'
      )}
    >
      {label}
      <span className="font-mono text-2xs opacity-70">{count}</span>
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
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <Tv className="w-4 h-4 text-surface-400" />
          <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
            {t('sonarr.heading', 'Sonarr')}
          </h2>
          {isFetching && <RefreshCw className="w-3 h-3 text-surface-500 animate-spin" />}
          {!isFetching && fetchedAt && (
            <span className="text-2xs text-surface-600">
              {t('sonarr.updated', 'updated {{when}}', { when: formatRelativeTime(fetchedAt) })}
            </span>
          )}
        </div>
        {badges && <div className="flex items-center gap-2 flex-wrap">{badges}</div>}
      </div>
      {children}
    </Card>
  );
}

function PanelNote({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-surface-400">
      <span className="flex-shrink-0 mt-0.5">{icon}</span>
      <p>{text}</p>
    </div>
  );
}

function SonarrPanelSkeleton() {
  return (
    <Card className="p-6">
      <div className="h-4 w-24 bg-surface-800/80 rounded animate-pulse mb-5" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-surface-800/60 animate-pulse" />
        ))}
      </div>
      <div className="h-1.5 rounded-full bg-surface-800/80 animate-pulse mt-5" />
      <div className="mt-6 space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-surface-800/50 animate-pulse" />
        ))}
      </div>
    </Card>
  );
}

export default SonarrSeriesPanel;
