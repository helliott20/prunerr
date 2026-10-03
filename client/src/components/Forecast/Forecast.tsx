import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CalendarClock, ChevronLeft, ChevronRight, Film, Info, RefreshCw, Search, Tv } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Dropdown } from '@/components/common/dropdown';
import { MaybeLink } from '@/components/common/MaybeLink';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SegmentedControl } from '@/components/Settings/components/SegmentedControl';
import { getField, OPERATOR_LABELS, type Operator } from '@/components/Rules/FieldCatalog';
import { useForecast, queryKeys } from '@/hooks/useApi';
import { forecastApi, libraryApi } from '@/services/api';
import { usePageScroll } from '@/contexts/PageScrollContext';
import { libraryItemPath, rulePath } from '@/lib/links';
import { cn, formatBytes } from '@/lib/utils';
import type { ForecastEntry, ForecastReason, ForecastResult } from '@/types';
import {
  HORIZONS,
  NO_FILTERS,
  applyFilters,
  byDeletionDay,
  checkpoints,
  dayKey,
  dayOffset,
  daysUntilEndOf,
  daysUntilStartOf,
  freedBy,
  freedSeries,
  groupOf,
  isFiltered,
  monthGrid,
  sortItems,
  toDateInput,
  withinRange,
  type Filters,
  type GroupKey,
  type SortKey,
} from './forecastData';

const PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

type T = TFunction<'forecast'>;

function useDates() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const lang = i18n.language;
    const short = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
    const withYear = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' });
    const month = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' });
    const rel = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    const thisYear = new Date().getFullYear();
    return {
      date: (d: Date) => (d.getFullYear() === thisYear ? short : withYear).format(d),
      dateWithYear: (d: Date) => withYear.format(d),
      month: (key: string) => month.format(new Date(`${key}-01T12:00:00`)),
      relative: (days: number) =>
        days < 45 ? rel.format(days, 'day') : days < 548 ? rel.format(Math.round(days / 30.4), 'month') : rel.format(Math.round(days / 365), 'year'),
    };
  }, [i18n.language]);
}

export default function Forecast() {
  const { t } = useTranslation('forecast');
  const dates = useDates();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { scrollToTop } = usePageScroll();
  const { data, isLoading, isError, error, refetch, isFetching } = useForecast();
  const { data: plexLibraries } = useQuery({
    queryKey: ['plexLibraries'],
    queryFn: libraryApi.getPlexLibraries,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // A preset length in days, or 'custom' for the From/To dates below.
  const [period, setPeriod] = useState<string>('365');
  const [customFrom, setCustomFrom] = useState(() => toDateInput(new Date()));
  const [customTo, setCustomTo] = useState(() => toDateInput(new Date(Date.now() + 365 * DAY_MS)));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<SortKey>('date');
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  const [page, setPage] = useState(1);

  const periodOptions = [
    ...HORIZONS.map((h) => ({ value: String(h), label: horizonLabel(h, t) })),
    { value: 'custom', label: t('horizon.custom', 'Custom') },
  ];

  const libraryNames = useMemo(() => new Map((plexLibraries ?? []).map((l) => [l.key, l.title])), [plexLibraries]);
  const now = useMemo(() => (data ? new Date(data.generatedAt) : new Date()), [data]);

  const maxDays = data?.horizonDays ?? 730;
  const isCustom = period === 'custom';
  const toDay = isCustom ? Math.max(1, daysUntilEndOf(customTo, now, maxDays)) : Number(period);
  const fromDay = isCustom ? Math.min(daysUntilStartOf(customFrom, now, maxDays), toDay) : 0;
  // Totals and the chart run from today; the list can start later.
  const horizon = toDay;
  const uptoEnd = useMemo(() => (data ? withinRange(data.items, now, 0, toDay) : []), [data, now, toDay]);
  const inRange = useMemo(
    () => (fromDay === 0 ? uptoEnd : data ? withinRange(data.items, now, fromDay, toDay) : []),
    [data, now, fromDay, toDay, uptoEnd]
  );
  const filtered = useMemo(() => sortItems(applyFilters(inRange, filters), sort), [inRange, filters, sort]);

  const updateFilters = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const refresh = async () => {
    const fresh = await forecastApi.get(true);
    queryClient.setQueryData(queryKeys.forecast, fresh);
  };

  if (isLoading) return <ForecastSkeleton />;
  if (isError || !data) {
    return <ErrorState error={error as Error} title={t('errors.loadFailed', 'Failed to load the forecast')} retry={refetch} />;
  }

  const noRules = data.deleteRuleCount === 0 && !data.items.some((i) => i.queued);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goToPage = (next: number) => {
    setPage(next);
    scrollToTop();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end gap-4 lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-50">{t('header.title', 'Forecast')}</h1>
          <p className="text-surface-400 mt-1 max-w-2xl">
            {t(
              'header.subtitle',
              'What your rules will make eligible for deletion if nothing changes. New downloads aren’t counted, and nothing here is deleted.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 w-full lg:w-auto lg:shrink-0">
          {/* Seven periods don't fit across a phone, so it gets a dropdown. */}
          <div className="sm:hidden w-full">
            <Dropdown
              size="input"
              className="w-full"
              ariaLabel={t('header.horizon', 'Forecast period')}
              value={period}
              options={periodOptions}
              onChange={(v) => {
                setPeriod(v);
                setPage(1);
              }}
            />
          </div>
          <SegmentedControl<string>
            value={period}
            options={periodOptions}
            onChange={(v) => {
              setPeriod(v);
              setPage(1);
            }}
            ariaLabel={t('header.horizon', 'Forecast period')}
            className="hidden sm:inline-flex"
          />
          <Button
            variant="ghost"
            size="sm"
            // Phones have no room for it; the page recalculates on load anyway.
            className="hidden sm:inline-flex shrink-0"
            onClick={refresh}
            disabled={isFetching}
            aria-label={t('header.refresh', 'Recalculate')}
            title={t('header.refresh', 'Recalculate')}
          >
            <RefreshCw className={cn('w-4 h-4 shrink-0', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {isCustom && (
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="sm:w-48">
              <Input
                id="forecast-from"
                type="date"
                label={t('range.from', 'From')}
                value={customFrom}
                min={toDateInput(now)}
                max={customTo}
                onChange={(e) => {
                  if (e.target.value) setCustomFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="sm:w-48">
              <Input
                id="forecast-to"
                type="date"
                label={t('range.to', 'To')}
                value={customTo}
                min={customFrom}
                max={toDateInput(new Date(now.getTime() + maxDays * DAY_MS))}
                onChange={(e) => {
                  if (e.target.value) setCustomTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <p className="text-sm text-surface-400 sm:pb-3">
              {t('range.hint', 'Up to {{years}} years ahead. Totals and the chart count from today; the list shows what a rule reaches in this range.', {
                years: Math.round(maxDays / 365),
              })}
            </p>
          </div>
        </Card>
      )}

      <Notices data={data} t={t} />

      {noRules ? (
        <Card className="p-12">
          <EmptyState
            icon={CalendarClock}
            title={t('empty.noRulesTitle', 'No cleanup rules yet')}
            description={t('empty.noRulesDesc', 'The forecast shows what your enabled delete rules will reach. Create a rule to see it.')}
            action={{ label: t('empty.createRule', 'Create a rule'), onClick: () => navigate('/rules') }}
          />
        </Card>
      ) : (
        <>
          <TotalTiles items={uptoEnd} now={now} horizon={horizon} t={t} dates={dates} />

          {/* One toolbar: view, search, filters, and what the tags mean */}
          <Card className="p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <SegmentedControl<'list' | 'calendar'>
                  value={view}
                  options={[
                    { value: 'calendar', label: t('view.calendar', 'Calendar') },
                    { value: 'list', label: t('view.list', 'List') },
                  ]}
                  onChange={setView}
                  ariaLabel={t('view.label', 'View')}
                  className="sm:shrink-0 sm:self-center"
                />
                <div className="flex-1 min-w-0">
                <Input
                  placeholder={t('filters.search', 'Search titles…')}
                  value={filters.search}
                  onChange={(e) => updateFilters({ search: e.target.value })}
                  icon={<Search className="w-4 h-4" />}
                  aria-label={t('filters.search', 'Search titles…')}
                />
                </div>
              </div>
              <div className={cn('grid grid-cols-2 gap-2', view === 'list' ? 'sm:grid-cols-3 lg:grid-cols-5' : 'lg:grid-cols-4')}>
                <Dropdown
                  size="input"
                  className="w-full overflow-hidden"
                  wrapperClassName="min-w-0"
                  ariaLabel={t('filters.rule', 'Rule')}
                  value={String(filters.ruleId)}
                  options={[
                    { value: 'all', label: t('filters.allRules', 'All rules') },
                    ...data.rules.map((r) => ({ value: String(r.id), label: r.name })),
                  ]}
                  onChange={(v) => updateFilters({ ruleId: v === 'all' ? 'all' : Number(v) })}
                />
                <Dropdown
                  size="input"
                  className="w-full overflow-hidden"
                  wrapperClassName="min-w-0"
                  ariaLabel={t('filters.library', 'Library')}
                  value={filters.libraryKey}
                  options={[
                    { value: 'all', label: t('filters.allLibraries', 'All libraries') },
                    ...(plexLibraries ?? []).filter((l) => !l.excluded).map((l) => ({ value: l.key, label: l.title })),
                  ]}
                  onChange={(v) => updateFilters({ libraryKey: v })}
                />
                <Dropdown
                  size="input"
                  className="w-full overflow-hidden"
                  wrapperClassName="min-w-0"
                  ariaLabel={t('filters.type', 'Type')}
                  value={filters.type}
                  options={[
                    { value: 'all' as const, label: t('filters.allTypes', 'Movies & TV') },
                    { value: 'movie' as const, label: t('filters.movies', 'Movies') },
                    { value: 'show' as const, label: t('filters.shows', 'TV shows') },
                  ]}
                  onChange={(v) => updateFilters({ type: v })}
                />
                <Dropdown
                  size="input"
                  className="w-full overflow-hidden"
                  wrapperClassName="min-w-0"
                  ariaLabel={t('filters.certainty', 'Certainty')}
                  value={filters.certainty}
                  options={[
                    { value: 'all' as const, label: t('filters.anyCertainty', 'Any certainty') },
                    { value: 'predictable' as const, label: t('certainty.predictable', 'Predictable') },
                    { value: 'conditional' as const, label: t('certainty.conditional', 'Conditional') },
                  ]}
                  onChange={(v) => updateFilters({ certainty: v })}
                />
                {/* The calendar is ordered by day already. */}
                {view === 'list' && (
                <Dropdown
                  size="input"
                  className="w-full overflow-hidden"
                  wrapperClassName="min-w-0"
                  align="end"
                  ariaLabel={t('filters.sort', 'Sort')}
                  value={sort}
                  options={[
                    { value: 'date' as const, label: t('filters.sortDate', 'Soonest first') },
                    { value: 'size' as const, label: t('filters.sortSize', 'Largest first') },
                  ]}
                  onChange={(v) => {
                    setSort(v);
                    setPage(1);
                  }}
                />
                )}
              </div>
              <Legend t={t} />
            </div>
          </Card>

          {isCustom && fromDay > 0 && (
            <p className="text-sm text-surface-300">
              {t('range.summary', 'Between {{from}} and {{to}}: {{count}} items, {{size}}', {
                from: dates.dateWithYear(new Date(now.getTime() + fromDay * DAY_MS)),
                to: dates.dateWithYear(new Date(now.getTime() + toDay * DAY_MS)),
                count: filtered.length,
                size: formatBytes(filtered.reduce((sum, i) => sum + i.freesBytes, 0)),
              })}
            </p>
          )}

          {filtered.length === 0 ? (
            <Card className="p-12">
              {isFiltered(filters) ? (
                <EmptyState
                  icon={Search}
                  variant="filtered"
                  title={t('empty.filteredTitle', 'Nothing matches these filters')}
                  description={t('empty.filteredDesc', 'Try a different rule, library or search.')}
                  action={{ label: t('empty.clearFilters', 'Clear filters'), onClick: () => updateFilters(NO_FILTERS) }}
                />
              ) : (
                <EmptyState
                  icon={CalendarClock}
                  variant="success"
                  title={t('empty.nothingTitle', 'Nothing due in this period')}
                  description={
                    isCustom
                      ? t('empty.nothingInRange', 'None of your rules reach anything between {{from}} and {{to}}.', {
                          from: dates.dateWithYear(new Date(now.getTime() + fromDay * DAY_MS)),
                          to: dates.dateWithYear(new Date(now.getTime() + toDay * DAY_MS)),
                        })
                      : t('empty.nothingDesc', 'None of your rules reach anything in the next {{period}}.', {
                          period: horizonLabel(horizon, t),
                        })
                  }
                  action={
                    !isCustom && horizon < 730
                      ? { label: t('empty.tryLonger', 'Look two years ahead'), onClick: () => setPeriod('730') }
                      : undefined
                  }
                />
              )}
            </Card>
          ) : view === 'calendar' ? (
            <CalendarView key={`${fromDay}-${toDay}`} items={filtered} now={now} libraryNames={libraryNames} t={t} dates={dates} />
          ) : (
            <ItemList
              items={pageItems}
              total={filtered}
              grouped={sort === 'date'}
              now={now}
              libraryNames={libraryNames}
              t={t}
              dates={dates}
            />
          )}

          {view === 'list' && filtered.length > PAGE_SIZE && (
            <div className="flex flex-col sm:flex-row items-center gap-2 sm:justify-between">
              <p className="text-sm text-surface-400">
                {t('pagination.showing', 'Showing {{from}}–{{to}} of {{total}}', {
                  from: (page - 1) * PAGE_SIZE + 1,
                  to: Math.min(page * PAGE_SIZE, filtered.length),
                  total: filtered.length,
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => goToPage(page - 1)} disabled={page === 1} aria-label={t('pagination.previous', 'Previous page')}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-surface-300">
                  {t('pagination.pageOf', 'Page {{page}} of {{totalPages}}', { page, totalPages })}
                </span>
                <Button variant="ghost" size="sm" onClick={() => goToPage(page + 1)} disabled={page === totalPages} aria-label={t('pagination.next', 'Next page')}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          <FreedChart data={data} items={uptoEnd} now={now} horizon={horizon} t={t} dates={dates} />

          <Footnotes data={data} t={t} />
        </>
      )}
    </div>
  );
}

/** One rule condition, as it will stand on the day the item is due. */
function reasonText(r: ForecastReason, t: T): string {
  const n = typeof r.actual === 'number' ? Math.round(r.actual) : null;
  const val = Array.isArray(r.value) ? r.value.join('–') : String(r.value ?? '');
  switch (r.field) {
    case 'days_since_added':
      if (n !== null) return t('why.added', '{{days}} days since added (rule: {{op}} {{val}})', { days: n, op: opLabel(r.operator), val });
      break;
    case 'days_since_watched':
      if (n !== null) return t('why.watched', '{{days}} days since last watched (rule: {{op}} {{val}})', { days: n, op: opLabel(r.operator), val });
      break;
    case 'play_count':
      if ((r.operator === 'equals' && r.value === 0) || (r.operator === 'less_than' && r.value === 1)) {
        return t('why.neverWatched', 'Never watched');
      }
      if (r.operator === 'equals' && r.value === 1) return t('why.watchedOnce', 'Watched once');
      break;
    case 'requested_by':
      if (r.operator === 'equals') return t('why.requestedBy', 'Requested by {{user}}', { user: val });
      break;
    case 'watched_by_user': {
      const user = String(r.params?.['username'] ?? '');
      const days = r.params?.['days'];
      if (r.operator === 'not_watched_since') return t('why.userNotWatched', '{{user}} hasn’t watched it in {{days}} days', { user, days });
      if (r.operator === 'never_watched') return t('why.userNever', '{{user}} has never watched it', { user });
      break;
    }
  }
  const field = getField(r.field)?.label ?? r.field;
  const op = opLabel(r.operator);
  return r.value === null || r.value === undefined || r.value === '' ? `${field} ${op}` : `${field} ${op} ${val}`;
}

function opLabel(op: string): string {
  return OPERATOR_LABELS[op as Operator] ?? op.replace(/_/g, ' ');
}

function watchText(item: ForecastEntry, t: T, dates: ReturnType<typeof useDates>): string {
  if (item.playCount === 0 || !item.lastWatchedAt) return t('watch.never', 'Never watched');
  return t('watch.last', 'Last watched {{date}}', { date: dates.dateWithYear(new Date(item.lastWatchedAt)) });
}

function horizonLabel(days: number, t: T): string {
  switch (days) {
    case 7: return t('horizon.7', '7 days');
    case 30: return t('horizon.30', '30 days');
    case 90: return t('horizon.90', '3 months');
    case 180: return t('horizon.180', '6 months');
    case 365: return t('horizon.365', '1 year');
    default: return t('horizon.730', '2 years');
  }
}

function Notices({ data, t }: { data: ForecastResult; t: T }) {
  const notes: string[] = [];
  if (!data.scanEnabled) {
    notes.push(t('notice.scanOff', 'Automatic scanning is off, so nothing is queued until you run a scan. Dates show when items become due.'));
  }
  if (data.scanEnabled && !data.autoProcess) {
    notes.push(t('notice.autoProcessOff', 'The deletion queue isn’t processed automatically, so items wait in the queue until you delete them.'));
  }
  if (notes.length === 0) return null;
  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <div key={n} className="flex items-start gap-2 rounded-xl border border-accent-500/30 bg-accent-500/10 px-4 py-3 text-sm text-surface-200">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-accent-text" />
          {n}
        </div>
      ))}
    </div>
  );
}

function TotalTiles({ items, now, horizon, t, dates }: { items: ForecastEntry[]; now: Date; horizon: number; t: T; dates: ReturnType<typeof useDates> }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {checkpoints(horizon).map((day) => {
        const totals = freedBy(items, now, day);
        const pct = (b: number) => (totals.bytes > 0 ? (b / totals.bytes) * 100 : 0);
        const queuedPct = pct(totals.queuedBytes);
        const predPct = pct(totals.predictableBytes);
        return (
          <Card key={day} className="p-4 flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wider text-surface-400">
              {t('tiles.by', 'Freed by {{date}}', { date: dates.date(new Date(now.getTime() + day * DAY_MS)) })}
            </p>
            <p className="text-xl sm:text-2xl font-display font-bold text-surface-50">{formatBytes(totals.bytes)}</p>
            <p className="text-sm text-surface-400">
              {[
                t('tiles.items', '{{count}} items', { count: totals.items }),
                totals.queuedBytes > 0 ? t('tiles.queued', '{{size}} already queued', { size: formatBytes(totals.queuedBytes) }) : null,
                totals.predictableBytes > 0
                  ? t('tiles.predictable', '{{size}} predictable', { size: formatBytes(totals.predictableBytes) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="mt-2 h-2 rounded-full bg-surface-800 overflow-hidden flex" aria-hidden="true">
              <div className="h-full bg-surface-300" style={{ width: `${queuedPct}%` }} />
              <div className="h-full bg-accent-500" style={{ width: `${predPct}%` }} />
              <div className="h-full bg-violet-500" style={{ width: `${totals.bytes > 0 ? 100 - queuedPct - predPct : 0}%` }} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function FreedChart({
  data,
  items,
  now,
  horizon,
  t,
  dates,
}: {
  data: ForecastResult;
  items: ForecastEntry[];
  now: Date;
  horizon: number;
  t: T;
  dates: ReturnType<typeof useDates>;
}) {
  const series = useMemo(() => freedSeries(items, now, horizon), [items, now, horizon]);
  const storage = data.storage;
  const base = storage.configured && storage.freeBytes !== null ? storage.freeBytes : 0;
  const last = series[series.length - 1] ?? { total: 0, predictable: 0, day: horizon };
  const top = base + Math.max(last.total, 1);
  const bottom = storage.configured ? base : 0;
  const span = Math.max(1, top - bottom);
  const W = 600;
  const H = 200;
  const x = (day: number) => (day / horizon) * W;
  const y = (bytes: number) => H - ((base + bytes - bottom) / span) * (H - 8) - 4;
  const path = (key: 'total' | 'predictable') =>
    series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');

  const yTicks = [0, 0.5, 1].map((f) => bottom + span * f);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(horizon * f));
  const endDate = dates.dateWithYear(new Date(now.getTime() + horizon * DAY_MS));

  const where = storage.configured
    ? storage.source === 'arr'
      ? t('chart.whereArr', 'across the {{count}} drives Sonarr and Radarr use', { count: storage.driveCount })
      : t('chart.whereUnraid', 'on the Unraid array')
    : '';

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display font-semibold text-surface-50">
            {storage.configured ? t('chart.titleFree', 'Free space if your rules run') : t('chart.titleFreed', 'Space your rules would free')}
          </h2>
          <p className="text-sm text-surface-400 mt-0.5">
            {storage.configured
              ? t('chart.subtitleFree', 'From {{free}} free today, {{where}}', { free: formatBytes(base), where })
              : t('chart.subtitleNoStorage', 'Connect Unraid, Sonarr or Radarr to see free space here.')}
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-surface-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-violet-500" />
            {t('chart.legendAll', 'Everything that matches')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 rounded bg-accent-500" />
            {t('chart.legendCertain', 'Queued or predictable')}
          </span>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col justify-between text-[11px] font-mono text-surface-500 h-[200px] py-0.5 text-right shrink-0">
          {[...yTicks].reverse().map((v) => (
            <span key={v}>{formatBytes(v)}</span>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[200px] block" role="img">
            <title>
              {t('chart.alt', '{{freed}} freed by {{date}}, {{predictable}} of it predictable', {
                freed: formatBytes(last.total),
                date: endDate,
                predictable: formatBytes(last.predictable),
              })}
            </title>
            {[0.5].map((f) => (
              <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="text-surface-800" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={`${path('total')} L${W} ${H} L0 ${H} Z`} className="text-accent-500" fill="currentColor" fillOpacity="0.08" />
            <path d={path('total')} className="text-violet-500" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
            <path d={path('predictable')} className="text-accent-500" fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="relative h-5 mt-1 text-[11px] font-mono text-surface-500">
            {xTicks.map((day, i) => (
              <span
                key={day}
                // Phones only have room for the ends and the middle.
                className={cn('absolute whitespace-nowrap', (i === 1 || i === 3) && 'hidden sm:inline')}
                style={{
                  left: `${(day / horizon) * 100}%`,
                  transform: i === 0 ? 'none' : i === xTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                }}
              >
                {day === 0 ? t('chart.today', 'Today') : dates.date(new Date(now.getTime() + day * DAY_MS))}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-sm text-surface-300 bg-surface-800/50 rounded-lg px-4 py-3">
        {last.total === 0
          ? t('chart.sentenceNone', 'Nothing is due to be deleted by {{date}}.', { date: endDate })
          : storage.configured
            ? t('chart.sentenceFree', 'By {{date}} your rules would free about {{freed}}, leaving {{free}} free. {{predictable}} of that is already queued or only depends on age or the file itself, so it happens unless you change a rule or protect the item; the rest moves if someone watches it.', {
                date: endDate,
                freed: formatBytes(last.total),
                free: formatBytes(base + last.total),
                predictable: formatBytes(last.predictable),
              })
            : t('chart.sentenceFreed', 'By {{date}} your rules would free about {{freed}}. {{predictable}} of that is already queued or only depends on age or the file itself, so it happens unless you change a rule or protect the item; the rest moves if someone watches it.', {
                date: endDate,
                freed: formatBytes(last.total),
                predictable: formatBytes(last.predictable),
              })}
      </p>
    </Card>
  );
}

function Legend({ t }: { t: T }) {
  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-x-6 text-xs text-surface-400">
      <span className="inline-flex items-start gap-2">
        <CertaintyPill certainty="queued" t={t} />
        {t('legend.queued', 'Already in the deletion queue.')}
      </span>
      <span className="inline-flex items-start gap-2">
        <CertaintyPill certainty="predictable" t={t} />
        {t('legend.predictable', 'Only depends on age or the file itself.')}
      </span>
      <span className="inline-flex items-start gap-2">
        <CertaintyPill certainty="conditional" t={t} />
        {t('legend.conditional', 'Depends on watching. If someone watches it, its date moves.')}
      </span>
    </div>
  );
}

function CertaintyPill({ certainty, t }: { certainty: ForecastEntry['certainty'] | 'queued'; t: T }) {
  if (certainty === 'queued') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-surface-700/60 text-surface-200">
        <span className="w-1.5 h-1.5 rounded-full bg-surface-300" aria-hidden="true" />
        {t('certainty.queued', 'Queued')}
      </span>
    );
  }
  return certainty === 'predictable' ? (
    <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-accent-500/15 text-accent-text">
      <span className="w-1.5 h-1.5 rounded-full bg-accent-500" aria-hidden="true" />
      {t('certainty.predictable', 'Predictable')}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-500/15 text-violet-text">
      <span className="w-1.5 h-1.5 rounded-full border border-violet-500" aria-hidden="true" />
      {t('certainty.conditional', 'Conditional')}
    </span>
  );
}

function groupTitle(key: GroupKey, t: T, dates: ReturnType<typeof useDates>): string {
  if (key === 'queued') return t('groups.queued', 'Already in the deletion queue');
  if (key === 'now') return t('groups.now', 'Due at the next scan');
  return dates.month(key.slice(6));
}

function ItemList({
  items,
  total,
  grouped,
  now,
  libraryNames,
  t,
  dates,
}: {
  items: ForecastEntry[];
  total: ForecastEntry[];
  grouped: boolean;
  now: Date;
  libraryNames: Map<string, string>;
  t: T;
  dates: ReturnType<typeof useDates>;
}) {
  // Each heading carries its group's totals across every page, not just this one.
  const groupTotals = useMemo(() => {
    const m = new Map<GroupKey, { count: number; bytes: number }>();
    for (const i of total) {
      const g = groupOf(i);
      const cur = m.get(g) ?? { count: 0, bytes: 0 };
      cur.count++;
      cur.bytes += i.freesBytes;
      m.set(g, cur);
    }
    return m;
  }, [total]);

  const rows: Array<{ group: GroupKey; item: ForecastEntry; first: boolean }> = [];
  let prev: GroupKey | null = null;
  for (const item of items) {
    const group = groupOf(item);
    rows.push({ group, item, first: grouped && group !== prev });
    prev = group;
  }

  const heading = (group: GroupKey) => {
    const totals = groupTotals.get(group);
    return (
      <>
        <span className="font-display font-semibold text-surface-100">{groupTitle(group, t, dates)}</span>
        {totals && (
          <span className="text-surface-400">
            {t('groups.totals', '{{count}} items · {{size}}', { count: totals.count, size: formatBytes(totals.bytes) })}
          </span>
        )}
      </>
    );
  };

  return (
    <Card className="overflow-hidden">
      {/* Phones: cards */}
      <div className="sm:hidden divide-y divide-surface-800/60">
        {rows.map(({ group, item, first }) => (
          <div key={item.id}>
            {first && <div className="flex justify-between gap-2 px-4 py-2.5 bg-surface-800/50 text-sm">{heading(group)}</div>}
            <ItemCard item={item} now={now} libraryNames={libraryNames} t={t} dates={dates} />
          </div>
        ))}
      </div>

      {/* Wider screens: table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              {[
                t('table.expected', 'Expected'),
                t('table.item', 'Item'),
                t('table.why', 'Rule & why'),
                t('table.certainty', 'Certainty'),
                t('table.frees', 'Frees'),
              ].map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    'px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50',
                    i === 4 ? 'text-right' : 'text-left'
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ group, item, first }) => (
              <ItemRowGroup key={item.id} first={first} heading={heading(group)}>
                <ItemRow item={item} now={now} libraryNames={libraryNames} t={t} dates={dates} />
              </ItemRowGroup>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ItemRowGroup({ first, heading, children }: { first: boolean; heading: ReactNode; children: ReactNode }) {
  return (
    <>
      {first && (
        <tr>
          <td colSpan={5} className="px-4 py-2.5 bg-surface-800/40 border-t border-surface-800">
            <div className="flex justify-between gap-3 text-sm">{heading}</div>
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

interface ItemProps {
  item: ForecastEntry;
  now: Date;
  libraryNames: Map<string, string>;
  t: T;
  dates: ReturnType<typeof useDates>;
}

function whenText({ item, now, t, dates }: ItemProps): { main: string; sub: string } {
  const del = new Date(item.deleteAt);
  if (item.queued && del.getTime() <= now.getTime()) {
    return { main: t('when.dueNow', 'Due now'), sub: t('when.waitingQueue', 'waiting for the queue to run') };
  }
  if (item.queued) {
    return {
      main: dates.date(del),
      sub: t('when.queuedDelete', 'deleted {{when}}', { when: dates.relative(dayOffset(item.deleteAt, now)) }),
    };
  }
  if (item.eligibleNow) {
    return { main: t('when.nextScan', 'Next scan'), sub: t('when.deletedOn', 'deleted ~{{date}}', { date: dates.date(del) }) };
  }
  const eligible = new Date(item.eligibleAt);
  const sameDay = Math.abs(del.getTime() - eligible.getTime()) < DAY_MS;
  return {
    main: dates.date(eligible),
    sub: sameDay
      ? dates.relative(dayOffset(item.eligibleAt, now))
      : t('when.deletedOn', 'deleted ~{{date}}', { date: dates.date(del) }),
  };
}

function ItemMeta({ item, libraryNames, t, dates }: ItemProps) {
  const library = item.libraryKey ? libraryNames.get(item.libraryKey) : undefined;
  return (
    <span className="text-xs text-surface-400">
      {[library, item.type === 'show' ? t('type.show', 'TV show') : t('type.movie', 'Movie'), watchText(item, t, dates)]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

function Why({ item, t }: { item: ForecastEntry; t: T }) {
  return (
    <div className="min-w-0">
      {item.ruleName && (
        <MaybeLink to={rulePath(item.ruleId)} className="text-sm text-surface-100 hover:text-accent-text">
          {item.ruleName}
        </MaybeLink>
      )}
      {item.queued ? (
        <p className="text-xs text-surface-400">{t('why.queued', 'Queued by this rule')}</p>
      ) : (
        <p className="text-xs text-surface-400">{item.reasons.map((r) => reasonText(r, t)).join(' · ')}</p>
      )}
    </div>
  );
}

function Frees({ item, t }: { item: ForecastEntry; t: T }) {
  if (item.freesBytes === 0 && item.sizeBytes > 0) {
    return <span className="text-xs text-surface-400">{t('frees.unmonitorOnly', 'Unmonitor only')}</span>;
  }
  return <span className="font-mono text-sm text-surface-100">{formatBytes(item.freesBytes)}</span>;
}

function Poster({ item }: { item: ForecastEntry }) {
  const Icon = item.type === 'show' ? Tv : Film;
  return item.posterUrl ? (
    <img src={item.posterUrl} alt="" loading="lazy" className="w-9 h-[54px] rounded object-cover bg-surface-800 shrink-0" />
  ) : (
    <div className="w-9 h-[54px] rounded bg-surface-800 flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4 text-surface-500" />
    </div>
  );
}

function ItemRow(props: ItemProps) {
  const { item, t } = props;
  const when = whenText(props);
  return (
    <tr className="border-t border-surface-800/60 align-top">
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="text-sm font-semibold text-surface-100">{when.main}</div>
        <div className="text-xs text-surface-500">{when.sub}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-start gap-3 min-w-[220px]">
          <Poster item={item} />
          <div className="min-w-0">
            <MaybeLink to={libraryItemPath(item.id)} className="block text-sm font-semibold text-surface-50 hover:text-accent-text">
              {item.title}
              {item.year ? <span className="font-normal text-surface-500"> ({item.year})</span> : null}
            </MaybeLink>
            <ItemMeta {...props} />
          </div>
        </div>
      </td>
      <td className="px-4 py-3 max-w-[360px]">
        <Why item={item} t={t} />
      </td>
      <td className="px-4 py-3">
        <CertaintyPill certainty={item.queued ? 'queued' : item.certainty} t={t} />
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <Frees item={item} t={t} />
      </td>
    </tr>
  );
}

function ItemCard(props: ItemProps) {
  const { item, t, dates } = props;
  const base = whenText(props);
  // Cards have no column heading, so say what the first date is.
  const when =
    !item.queued && !item.eligibleNow
      ? { ...base, main: t('when.matchesOn', 'Matches {{date}}', { date: dates.date(new Date(item.eligibleAt)) }) }
      : base;
  return (
    <div className="flex gap-3 px-4 py-3">
      <Poster item={item} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <MaybeLink to={libraryItemPath(item.id)} className="text-sm font-semibold text-surface-50">
            {item.title}
          </MaybeLink>
          <Frees item={item} t={t} />
        </div>
        <ItemMeta {...props} />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-surface-200">{when.main}</span>
          <span className="text-surface-500">{when.sub}</span>
          <CertaintyPill certainty={item.queued ? 'queued' : item.certainty} t={t} />
        </div>
        <Why item={item} t={t} />
      </div>
    </div>
  );
}

/** First day of the week for the browser's region: Sunday or Monday. */
function weekStart(): 0 | 1 {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const firstDay = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay;
    return firstDay === 7 ? 0 : 1;
  } catch {
    return 1;
  }
}

/**
 * A month at a time, each item on the day it would be deleted, in the
 * style of a release calendar. Pick a day to see what goes that day.
 */
function CalendarView({
  items,
  now,
  libraryNames,
  t,
  dates,
}: {
  items: ForecastEntry[];
  now: Date;
  libraryNames: Map<string, string>;
  t: T;
  dates: ReturnType<typeof useDates>;
}) {
  const { i18n } = useTranslation();
  const days = useMemo(() => byDeletionDay(items, now), [items, now]);
  const keys = useMemo(() => [...days.keys()].sort(), [days]);
  const todayKey = dayKey(now);
  const firstKey = keys[0] ?? todayKey;
  const lastKey = keys[keys.length - 1] ?? todayKey;

  const [month, setMonth] = useState(() => {
    const d = new Date(`${firstKey}T12:00:00`);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  // Start on today when something goes today, else the first day something does.
  const [selected, setSelected] = useState(days.has(todayKey) ? todayKey : firstKey);

  // Hovering a day for half a second shows what goes that day. Mouse only:
  // on a touch screen a tap selects the day instead.
  const [hovered, setHovered] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const startHover = (key: string, pointerType: string) => {
    window.clearTimeout(hoverTimer.current);
    if (pointerType !== 'mouse' || !days.has(key)) return;
    hoverTimer.current = window.setTimeout(() => setHovered(key), 500);
  };
  const endHover = () => {
    window.clearTimeout(hoverTimer.current);
    setHovered(null);
  };
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const minMonth = Math.min(now.getFullYear() * 12 + now.getMonth(), Number(firstKey.slice(0, 4)) * 12 + Number(firstKey.slice(5, 7)) - 1);
  const maxMonth = Number(lastKey.slice(0, 4)) * 12 + Number(lastKey.slice(5, 7)) - 1;
  const current = month.year * 12 + month.month;
  const goTo = (index: number) => setMonth({ year: Math.floor(index / 12), month: index % 12 });
  const thisMonth = now.getFullYear() * 12 + now.getMonth();
  const goToToday = () => {
    goTo(thisMonth);
    setSelected(todayKey);
  };

  const weeks = useMemo(() => monthGrid(month.year, month.month, weekStart()), [month]);
  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }), [i18n.language]);
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }), [i18n.language]);
  const monthKey = `${month.year}-${String(month.month + 1).padStart(2, '0')}`;

  const monthTotals = useMemo(() => {
    let count = 0;
    let bytes = 0;
    for (const [key, list] of days) {
      if (!key.startsWith(monthKey)) continue;
      count += list.length;
      bytes += list.reduce((sum, i) => sum + i.freesBytes, 0);
    }
    return { count, bytes };
  }, [days, monthKey]);

  const selectedItems = days.get(selected) ?? [];
  const selectedBytes = selectedItems.reduce((sum, i) => sum + i.freesBytes, 0);

  return (
    <div className="space-y-4">
      <Card className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <Button variant="ghost" size="sm" onClick={() => goTo(current - 1)} disabled={current <= minMonth} aria-label={t('calendar.previous', 'Previous month')}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="text-center">
            <h2 className="font-display font-semibold text-surface-50">{dates.month(monthKey)}</h2>
            <p className="text-xs text-surface-400">
              {t('groups.totals', '{{count}} items · {{size}}', { count: monthTotals.count, size: formatBytes(monthTotals.bytes) })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(current !== thisMonth || selected !== todayKey) && (
              <Button variant="ghost" size="sm" onClick={goToToday}>
                {t('calendar.today', 'Today')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => goTo(current + 1)} disabled={current >= maxMonth} aria-label={t('calendar.next', 'Next month')}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wider text-surface-500 mb-1">
          {weeks[0]!.map((d) => (
            <div key={d.toISOString()}>{weekdayFmt.format(d)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((d, index) => {
            const key = dayKey(d);
            const list = days.get(key) ?? [];
            const bytes = list.reduce((sum, i) => sum + i.freesBytes, 0);
            const inMonth = d.getMonth() === month.month;
            const isToday = key === todayKey;
            const isSelected = key === selected;
            const column = index % 7;
            const lowerHalf = index >= weeks.length * 7 - 14;
            return (
              <div
                key={key}
                className="relative"
                onPointerEnter={(e) => startHover(key, e.pointerType)}
                onPointerLeave={endHover}
              >
              <button
                type="button"
                onClick={() => {
                  setSelected(key);
                  endHover();
                }}
                aria-pressed={isSelected}
                aria-label={
                  list.length > 0
                    ? t('calendar.dayLabel', '{{date}}: {{count}} items, {{size}}', { date: dayFmt.format(d), count: list.length, size: formatBytes(bytes) })
                    : dayFmt.format(d)
                }
                aria-current={isToday ? 'date' : undefined}
                className={cn(
                  'relative flex w-full h-full flex-col items-stretch gap-1 rounded-lg border p-1 sm:p-1.5 min-h-[56px] sm:min-h-[104px] text-left transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60',
                  // Today is amber; the day being looked at gets a plain ring, so the two never look alike.
                  isToday
                    ? 'border-accent-500/70 bg-accent-500/[0.07]'
                    : list.length > 0
                      ? 'border-surface-700/60 bg-surface-800/50 hover:bg-surface-800'
                      : 'border-surface-800/60 bg-transparent hover:bg-surface-800/40',
                  isSelected && 'ring-2 ring-surface-300 ring-offset-1 ring-offset-surface-900',
                  // Phones: filled tiles, a solid today, and a bright ring for the chosen day.
                  'max-sm:min-h-[64px] max-sm:rounded-xl max-sm:border-transparent',
                  isToday ? 'max-sm:bg-accent-500/30' : 'max-sm:bg-surface-800/70',
                  isSelected && 'max-sm:ring-surface-100 max-sm:ring-offset-0',
                  (!inMonth || (key < todayKey && list.length === 0)) && 'opacity-40'
                )}
              >
                <div className="flex items-center justify-between gap-1 max-sm:flex-row-reverse">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full text-xs font-semibold',
                        isToday ? 'bg-accent-500 text-surface-950 max-sm:bg-transparent max-sm:text-surface-50 max-sm:font-bold' : 'text-surface-200'
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {isToday && (
                      <span className="hidden lg:inline text-[10px] font-semibold uppercase tracking-wider text-accent-text">
                        {t('calendar.today', 'Today')}
                      </span>
                    )}
                  </span>
                  {list.length > 0 && (
                    <span className="hidden sm:inline text-[10px] font-mono text-surface-400 truncate">{formatBytes(bytes)}</span>
                  )}
                </div>
                {list.length > 0 && (
                  <>
                    {/* Posters on wider screens, a count on phones. */}
                    <div className="hidden sm:flex items-end gap-1">
                      {list.slice(0, 3).map((item) => (
                        <CalendarPoster key={item.id} item={item} />
                      ))}
                      {list.length > 3 && <span className="text-[10px] font-semibold text-surface-400 pb-0.5">+{list.length - 3}</span>}
                    </div>
                    {/* Phones: a dot per item, coloured like its tag. */}
                    <span className="sm:hidden mt-auto flex items-center justify-center gap-1 pb-0.5" aria-hidden="true">
                      {list.slice(0, 3).map((item) => (
                        <span key={item.id} className={cn('w-1.5 h-1.5 rounded-full', tagFill(item))} />
                      ))}
                      {list.length > 3 && <span className="text-[9px] font-semibold leading-none text-surface-400">+</span>}
                    </span>
                  </>
                )}
              </button>
              {hovered === key && list.length > 0 && (
                <DayHoverCard
                  items={list}
                  title={dayFmt.format(d)}
                  bytes={bytes}
                  t={t}
                  className={cn(
                    lowerHalf ? 'bottom-full mb-2' : 'top-full mt-2',
                    column <= 1 ? 'left-0' : column >= 5 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                  )}
                />
              )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-surface-500">{t('calendar.hint', 'Each item is shown on the day it would be deleted, after its rule’s grace period.')}</p>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex justify-between gap-3 px-4 py-3 bg-surface-800/50 text-sm">
          <span className="font-display font-semibold text-surface-100">
            {selected === todayKey && <span className="text-accent-text">{t('calendar.today', 'Today')} · </span>}
            {dayFmt.format(new Date(`${selected}T12:00:00`))}
          </span>
          {selectedItems.length > 0 && (
            <span className="text-surface-400">
              {t('groups.totals', '{{count}} items · {{size}}', { count: selectedItems.length, size: formatBytes(selectedBytes) })}
            </span>
          )}
        </div>
        {selectedItems.length === 0 ? (
          <p className="px-4 py-6 text-sm text-surface-400">{t('calendar.emptyDay', 'Nothing would be deleted on this day.')}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {selectedItems.map((item) => (
              <div key={item.id} className="sm:border-t sm:border-surface-800/60 lg:odd:border-r">
                <div className="sm:hidden px-3 pt-3 last:pb-3">
                  <DayItemCard item={item} now={now} t={t} dates={dates} />
                </div>
                <div className="hidden sm:block">
                  <ItemCard item={item} now={now} libraryNames={libraryNames} t={t} dates={dates} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** The fill for an item's tag colour: grey queued, amber predictable, violet conditional. */
function tagFill(item: ForecastEntry): string {
  if (item.queued) return 'bg-surface-300';
  return item.certainty === 'predictable' ? 'bg-accent-500' : 'bg-violet-500';
}

/** A phone-sized card for one item on the chosen day: bar, poster, title, rule, when. */
function DayItemCard({ item, now, t, dates }: { item: ForecastEntry; now: Date; t: T; dates: ReturnType<typeof useDates> }) {
  const del = new Date(item.deleteAt);
  const when =
    item.queued && del.getTime() <= now.getTime()
      ? t('when.dueNow', 'Due now')
      : t('dayCard.deletes', 'Deletes {{date}}', { date: dates.date(del) });
  const tag = item.queued
    ? t('certainty.queued', 'Queued')
    : item.certainty === 'predictable'
      ? t('certainty.predictable', 'Predictable')
      : t('certainty.conditional', 'Conditional');
  return (
    <MaybeLink to={libraryItemPath(item.id)} className="flex items-stretch gap-3 rounded-xl bg-surface-800/60 p-3">
      <span className={cn('w-1 shrink-0 rounded-full', tagFill(item))} aria-hidden="true" />
      <Poster item={item} />
      <span className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
        <span className="text-[15px] font-semibold text-surface-50 truncate">{item.title}</span>
        {item.ruleName && <span className="text-xs text-surface-400 truncate">{item.ruleName}</span>}
        <span className="text-xs text-surface-400">
          {[when, formatBytes(item.freesBytes), tag].join(' · ')}
        </span>
      </span>
    </MaybeLink>
  );
}

const HOVER_CARD_LIMIT = 8;

/** The titles going on one day, shown while a day is hovered. */
function DayHoverCard({
  items,
  title,
  bytes,
  t,
  className,
}: {
  items: ForecastEntry[];
  title: string;
  bytes: number;
  t: T;
  className?: string;
}) {
  return (
    // The day's button already says how many items go that day; this is a visual aid.
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute z-30 w-72 rounded-xl border border-surface-700/70 bg-surface-900 p-3 shadow-xl shadow-black/40',
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-surface-100">{title}</span>
        <span className="text-[11px] font-mono text-surface-400">{formatBytes(bytes)}</span>
      </div>
      <ul className="space-y-1.5">
        {items.slice(0, HOVER_CARD_LIMIT).map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <span
              className={cn(
                'mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full',
                item.queued ? 'bg-surface-300' : item.certainty === 'predictable' ? 'bg-accent-500' : 'border border-violet-500'
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-surface-100">{item.title}</span>
              {item.ruleName && <span className="block truncate text-[11px] text-surface-500">{item.ruleName}</span>}
            </span>
            <span className="shrink-0 text-[11px] font-mono text-surface-400">{formatBytes(item.freesBytes)}</span>
          </li>
        ))}
      </ul>
      {items.length > HOVER_CARD_LIMIT && (
        <p className="mt-2 text-[11px] text-surface-500">
          {t('calendar.more', '+{{count}} more — click the day to see them all', { count: items.length - HOVER_CARD_LIMIT })}
        </p>
      )}
    </div>
  );
}

function CalendarPoster({ item }: { item: ForecastEntry }) {
  const Icon = item.type === 'show' ? Tv : Film;
  return item.posterUrl ? (
    <img src={item.posterUrl} alt="" loading="lazy" className="w-7 h-10 lg:w-8 lg:h-12 rounded object-cover bg-surface-800" />
  ) : (
    <span className="w-7 h-10 lg:w-8 lg:h-12 rounded bg-surface-700/60 flex items-center justify-center">
      <Icon className="w-3 h-3 text-surface-500" />
    </span>
  );
}

function Footnotes({ data, t }: { data: ForecastResult; t: T }) {
  const left = data.skipped.protected + data.skipped.excluded;
  const notes: Array<string | null> = [
    left > 0 ? t('footnotes.protected', '{{count}} protected or excluded items are left out.', { count: left }) : null,
    data.skipped.flagOrNotify > 0
      ? t('footnotes.flagOnly', '{{count}} items are matched first by a rule that only flags or notifies, so nothing deletes them.', {
          count: data.skipped.flagOrNotify,
        })
      : null,
    t('footnotes.inProgress', 'Shows someone is part-way through are counted from the day they stall, if Safety protects them.'),
    data.diskPressureActive
      ? t('footnotes.diskPressure', 'Disk-pressure cleanup can also remove items when free space drops below your target; it isn’t included here.')
      : null,
  ];
  return (
    <ul className="space-y-1 text-xs text-surface-500 list-disc pl-5">
      {notes
        .filter((n): n is string => n !== null)
        .map((n) => (
          <li key={n}>{n}</li>
        ))}
    </ul>
  );
}

function ForecastSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-14 w-72 rounded-lg bg-surface-800/50 animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-surface-800/50 animate-pulse" />
        ))}
      </div>
      <div className="h-72 rounded-xl bg-surface-800/50 animate-pulse" />
      <div className="h-96 rounded-xl bg-surface-800/50 animate-pulse" />
    </div>
  );
}
