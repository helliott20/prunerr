import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
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
import { Toggle } from '@/components/Settings/components/Toggle';
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
  SIZE_FILTERS,
  applyFilters,
  byDeletionDay,
  dayKey,
  dayOffset,
  daysUntilEndOf,
  daysUntilStartOf,
  daysUntilFull,
  DAYS_PER_MONTH,
  bucketSizeFor,
  freedBuckets,
  inBucket,
  groupOf,
  isFiltered,
  monthGrid,
  sortItems,
  toDateInput,
  withinRange,
  type BucketSize,
  type FreedBucket,
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
    const monthShort = new Intl.DateTimeFormat(lang, { month: 'short' });
    const monthShortYear = new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric' });
    const rel = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    const thisYear = new Date().getFullYear();
    return {
      date: (d: Date) => (d.getFullYear() === thisYear ? short : withYear).format(d),
      dateWithYear: (d: Date) => withYear.format(d),
      dayMonth: (d: Date) => short.format(d),
      month: (key: string) => month.format(new Date(`${key}-01T12:00:00`)),
      // The year only where it starts, so a row of months reads "Nov, Dec, Jan 2028".
      monthShort: (d: Date) => (d.getMonth() === 0 ? monthShortYear : monthShort).format(d),
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
  // #79 leaves new downloads out; counting them at the measured rate is opt-in.
  const [countDownloads, setCountDownloads] = useState(false);
  // A bar picked in the chart narrows the list to its day, week or month.
  const [picked, setPicked] = useState<PickedBar | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
  const filtered = useMemo(
    () => sortItems(applyFilters(picked ? inBucket(inRange, now, picked) : inRange, filters), sort),
    [inRange, filters, sort, picked, now]
  );
  const pickBar = (bar: PickedBar) => {
    setPicked(bar);
    setView('list');
    setPage(1);
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  const downloadsPerDay = countDownloads && data.storage.configured ? (data.storage.growth?.bytesPerDay ?? 0) : 0;
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
            {downloadsPerDay > 0
              ? t(
                  'header.subtitleGrowth',
                  'What your rules will make eligible for deletion if nothing changes. Free space counts new downloads at your recent rate, and nothing here is deleted.'
                )
              : t(
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
                setPicked(null);
                setPage(1);
              }}
            />
          </div>
          <SegmentedControl<string>
            value={period}
            options={periodOptions}
            onChange={(v) => {
              setPeriod(v);
              setPicked(null);
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
          {/* The capacity answer comes before the item-by-item detail. */}
          <FreedSummary
            data={data}
            items={uptoEnd}
            now={now}
            horizon={horizon}
            countDownloads={countDownloads}
            onCountDownloads={setCountDownloads}
            picked={picked}
            onPick={pickBar}
            t={t}
            dates={dates}
          />

          {/* One toolbar: view, search, filters, and what the tags mean */}
          <Card ref={listRef} className="p-4 scroll-mt-4">
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
              <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-2', view === 'list' ? 'xl:grid-cols-7' : 'xl:grid-cols-6')}>
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
                    { value: 'queued' as const, label: t('certainty.queued', 'Queued') },
                    { value: 'predictable' as const, label: t('certainty.predictable', 'Predictable') },
                    { value: 'conditional' as const, label: t('certainty.conditional', 'Conditional') },
                  ]}
                  onChange={(v) => updateFilters({ certainty: v })}
                />
                <Dropdown
                  size="input"
                  className="w-full overflow-hidden"
                  wrapperClassName="min-w-0"
                  ariaLabel={t('filters.watch', 'Watched')}
                  value={filters.watch}
                  options={[
                    { value: 'all' as const, label: t('filters.anyWatch', 'Seen or not') },
                    { value: 'watched' as const, label: t('filters.watched', 'Watched') },
                    { value: 'unwatched' as const, label: t('filters.unwatched', 'Never watched') },
                  ]}
                  onChange={(v) => updateFilters({ watch: v })}
                />
                <Dropdown
                  size="input"
                  className="w-full overflow-hidden"
                  wrapperClassName="min-w-0"
                  ariaLabel={t('filters.size', 'Size')}
                  value={String(filters.minGb)}
                  options={SIZE_FILTERS.map((gb) => ({
                    value: String(gb),
                    label: gb === 0 ? t('filters.anySize', 'Any size') : t('filters.minSize', 'Over {{size}} GB', { size: gb }),
                  }))}
                  onChange={(v) => updateFilters({ minGb: Number(v) as Filters['minGb'] })}
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

          {picked && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-accent-500/15 text-accent-text px-3 py-1 font-medium">
                {t('summary.picked', '{{period}}: {{count}} items, {{size}}', {
                  period: picked.label,
                  count: filtered.length,
                  size: formatBytes(filtered.reduce((sum, i) => sum + i.freesBytes, 0)),
                })}
              </span>
              <button
                type="button"
                className="font-medium text-accent-text hover:text-accent-text-hover"
                onClick={() => setPicked(null)}
              >
                {t('summary.showAll', 'Show the whole period')}
              </button>
            </div>
          )}

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

          <Footnotes data={data} t={t} />
        </>
      )}
    </div>
  );
}

/** One rule condition, as it will stand on the day the item is due. */
function reasonText(r: ForecastReason, t: T): string {
  // Under a NONE group the rule matches because the condition is false.
  if (r.negated) return t('why.not', 'not: {{reason}}', { reason: reasonText({ ...r, negated: false }, t) });
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

const PER = { day: 'summary.perDay', week: 'summary.perWeek', month: 'summary.perMonth' } as const;

const SEGMENTS = [
  { key: 'queued', className: 'bg-surface-300', fill: 'fill-surface-300' },
  { key: 'predictable', className: 'bg-accent-500', fill: 'fill-accent-500' },
  { key: 'conditional', className: 'bg-violet-500', fill: 'fill-violet-500' },
] as const;

function FreedSummary({
  data,
  items,
  now,
  horizon,
  countDownloads,
  onCountDownloads,
  picked,
  onPick,
  t,
  dates,
}: {
  data: ForecastResult;
  items: ForecastEntry[];
  now: Date;
  horizon: number;
  countDownloads: boolean;
  onCountDownloads: (on: boolean) => void;
  picked: PickedBar | null;
  onPick: (bar: PickedBar) => void;
  t: T;
  dates: ReturnType<typeof useDates>;
}) {
  const buckets = useMemo(() => freedBuckets(items, now, horizon), [items, now, horizon]);
  const sum = (key: (typeof SEGMENTS)[number]['key']) => buckets.reduce((n, b) => n + b[key], 0);
  const parts = { queued: sum('queued'), predictable: sum('predictable'), conditional: sum('conditional') };
  const freed = parts.queued + parts.predictable + parts.conditional;
  const endDate = dates.dateWithYear(new Date(now.getTime() + horizon * DAY_MS));

  const storage = data.storage;
  const free = storage.configured && storage.freeBytes !== null ? storage.freeBytes : null;
  const where = storage.configured
    ? storage.source === 'arr'
      ? t('chart.whereArr', 'across the {{count}} drives Sonarr and Radarr use', { count: storage.driveCount })
      : t('chart.whereUnraid', 'on the Unraid array')
    : '';
  // New downloads, when there's enough history to measure them; counted only when switched on.
  const measured = free !== null && storage.growth && storage.growth.bytesPerDay > 0 ? storage.growth : null;
  const growth = countDownloads ? measured : null;

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg sm:text-xl font-semibold text-surface-50">
        {freed === 0 ? (
          t('summary.none', 'Nothing is due to be deleted by {{date}}.', { date: endDate })
        ) : (
          <Trans
            t={t}
            i18nKey="summary.headline"
            defaults="Your rules free <b>{{size}}</b> by {{date}}"
            values={{ size: formatBytes(freed), date: endDate }}
            components={{ b: <span className="text-accent-text" /> }}
          />
        )}
      </h2>
      {freed > 0 && (
        <p className="mt-1 text-sm text-surface-400 flex flex-wrap gap-x-4 gap-y-1">
          {SEGMENTS.filter((s) => parts[s.key] > 0).map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-sm', s.className)} aria-hidden="true" />
              {t(`summary.${s.key}`, { size: formatBytes(parts[s.key]) })}
            </span>
          ))}
        </p>
      )}
      <p className="mt-1 text-sm text-surface-400">
        {free !== null && growth
          ? t('summary.freeGrowth', '{{free}} free today {{where}}. New downloads add at least {{rate}} a month (measured over {{days}} days).', {
              free: formatBytes(free),
              where,
              rate: formatBytes(growth.bytesPerDay * DAYS_PER_MONTH),
              days: growth.measuredDays,
            })
          : free !== null
          ? t('summary.free', '{{free}} free today {{where}}, {{then}} after these deletions if nothing new is downloaded.', {
              free: formatBytes(free),
              then: formatBytes(Math.min(storage.totalBytes ?? Infinity, free + freed)),
              where,
            })
          : t('chart.subtitleNoStorage', 'Connect Unraid, Sonarr or Radarr to see free space here.')}
      </p>

      {measured && (
        <div className="flex items-center gap-3 mt-4">
          <Toggle checked={countDownloads} onChange={onCountDownloads} label={t('chart.countDownloads', 'Count new downloads')} />
          <span className="text-sm text-surface-300">
            {t('chart.countDownloadsHint', 'Count new downloads (at least {{rate}} a month lately) and see when the disk fills', {
              rate: formatBytes(measured.bytesPerDay * DAYS_PER_MONTH),
            })}
          </span>
        </div>
      )}

      {growth && free !== null && <DiskFull data={data} now={now} free={free} bytesPerDay={growth.bytesPerDay} t={t} dates={dates} />}

      {freed > 0 && (
        <FreedBars buckets={buckets} size={bucketSizeFor(horizon)} freed={freed} picked={picked} onPick={onPick} t={t} dates={dates} />
      )}
    </Card>
  );
}

/** A round step for about four gridlines up to `max`, in the 1024-based units formatBytes uses. */
function niceStep(max: number): number {
  let unit = 1;
  while (max / unit >= 1024) unit *= 1024;
  const raw = max / unit / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= raw)! * pow;
  return step * unit;
}

export interface PickedBar {
  start: Date;
  end: Date;
  label: string;
}

interface BarHover {
  idx: number;
  leftPx: number;
}

const TIP_W = 200;

/** Stacked bars of space freed per day, week or month; the running total is in the tooltip. */
function FreedBars({
  buckets,
  size,
  freed,
  picked,
  onPick,
  t,
  dates,
}: {
  buckets: FreedBucket[];
  size: BucketSize;
  freed: number;
  picked: PickedBar | null;
  onPick: (bar: PickedBar) => void;
  t: T;
  dates: ReturnType<typeof useDates>;
}) {
  // Same approach as the dashboard's storage chart: the viewBox tracks the
  // measured width so one unit is one CSS pixel and the text stays crisp.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState<BarHover | null>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 200;
  const padT = 14;
  const padB = 22;
  const padL = 58;
  const padR = 8;
  const baseY = H - padB;
  const plotH = baseY - padT;
  const innerW = W - padL - padR;
  const n = buckets.length;
  const slot = innerW / Math.max(1, n);
  const barW = Math.max(2, Math.min(48, slot * 0.68));

  const tallest = Math.max(1, ...buckets.map((b) => b.queued + b.predictable + b.conditional));
  const step = niceStep(tallest);
  const top = Math.max(step, Math.ceil(tallest / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const y = (bytes: number) => baseY - (bytes / top) * plotH;
  const cx = (i: number) => padL + slot * i + slot / 2;

  const cumulative = buckets.reduce<number[]>(
    (out, b) => [...out, (out[out.length - 1] ?? 0) + b.queued + b.predictable + b.conditional],
    []
  );

  const axisLabel = (b: FreedBucket, i: number) =>
    i === 0 ? t('chart.today', 'Today') : size === 'month' ? dates.monthShort(b.start) : dates.dayMonth(b.start);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 64))));
  const periodLabel = (b: FreedBucket, i: number) => {
    const sameDay = b.end.getTime() - b.start.getTime() < DAY_MS;
    if (sameDay) return dates.dayMonth(b.start);
    // A whole calendar month reads as its name; the part of this month that's left as a range.
    if (size === 'month' && !(i === 0 && b.start.getDate() !== 1)) return dates.month(dayKey(b.start).slice(0, 7));
    return `${dates.dayMonth(b.start)} – ${dates.dayMonth(b.end)}`;
  };

  const pick = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((px - padL) / slot)));
    const center = (cx(idx) / W) * rect.width;
    const maxLeft = rect.width - TIP_W - 6;
    setHover({ idx, leftPx: maxLeft < 6 ? (rect.width - TIP_W) / 2 : Math.max(6, Math.min(maxLeft, center - TIP_W / 2)) });
  };

  const hovered = hover ? buckets[hover.idx] : undefined;
  // While hovering, every other bar fades; otherwise every bar but a picked one.
  const dimmed = (i: number) =>
    hover ? hover.idx !== i : picked !== null && picked.start.getTime() !== buckets[i]!.start.getTime();

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <p className="text-xs font-medium uppercase tracking-wider text-surface-500">{t(PER[size])}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-400">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-sm', s.className)} aria-hidden="true" />
              {t(`certainty.${s.key}`)}
            </span>
          ))}
        </div>
      </div>
      <div
        ref={wrapRef}
        className="relative w-full cursor-crosshair touch-pan-y"
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const idx = Math.min(n - 1, Math.max(0, Math.floor((((e.clientX - rect.left) / rect.width) * W - padL) / slot)));
          const b = buckets[idx];
          if (b && b.items > 0) onPick({ start: b.start, end: b.end, label: periodLabel(b, idx) });
        }}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
        onTouchStart={(e) => e.touches[0] && pick(e.touches[0].clientX, e.currentTarget)}
        onTouchMove={(e) => e.touches[0] && pick(e.touches[0].clientX, e.currentTarget)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img">
          <title>{t('summary.alt', 'Space freed per period, {{size}} in total by {{date}}', { size: formatBytes(freed), date: periodLabel(buckets[n - 1]!, n - 1) })}</title>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="text-surface-800" stroke="currentColor" strokeWidth="1" />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" className="fill-surface-500 font-mono text-[11px]">
                {v === 0 ? '0' : formatBytes(v)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            let at = baseY;
            return (
              <g key={b.start.getTime()} opacity={dimmed(i) ? 0.45 : 1}>
                {SEGMENTS.map((s) => {
                  const h = (b[s.key] / top) * plotH;
                  if (h <= 0) return null;
                  at -= h;
                  return <rect key={s.key} x={cx(i) - barW / 2} y={at} width={barW} height={h} className={s.fill} />;
                })}
              </g>
            );
          })}
          {buckets.map((b, i) =>
            i % every === 0 ? (
              <text
                key={b.start.getTime()}
                x={cx(i)}
                y={H - 6}
                textAnchor={i === 0 && slot < 40 ? 'start' : 'middle'}
                className={cn('font-mono text-[11px]', i === 0 ? 'fill-accent-500' : 'fill-surface-500')}
              >
                {axisLabel(b, i)}
              </text>
            ) : null
          )}
        </svg>

        {/* Laid out like the dashboard's storage tooltip: period, total, the split, then the running total. */}
        {hover && hovered && (
          <div
            className="absolute top-1 z-20 pointer-events-none rounded-xl border border-surface-700 bg-surface-900/95 backdrop-blur px-3 py-2.5 shadow-xl text-xs"
            style={{ left: hover.leftPx, width: TIP_W }}
          >
            <div className="flex items-center gap-1.5 font-semibold text-surface-50 mb-2">
              <span className="w-[7px] h-[7px] rounded-full bg-accent-500" />
              {periodLabel(hovered, hover.idx)}
            </div>
            <div className="flex justify-between gap-2 pb-1.5 mb-1 border-b border-surface-700/60">
              <span className="text-surface-400">{t('summary.tipItems', '{{count}} items', { count: hovered.items })}</span>
              <span className="font-semibold tabular-nums text-accent-text">
                {formatBytes(hovered.queued + hovered.predictable + hovered.conditional)}
              </span>
            </div>
            {SEGMENTS.filter((s) => hovered[s.key] > 0).map((s) => (
              <div key={s.key} className="flex justify-between gap-2 mt-1">
                <span className="inline-flex items-center gap-1.5 text-surface-400">
                  <span className={cn('w-[7px] h-[7px] rounded-full', s.className)} />
                  {t(`certainty.${s.key}`)}
                </span>
                <span className="font-semibold tabular-nums text-surface-100">{formatBytes(hovered[s.key])}</span>
              </div>
            ))}
            <div className="flex justify-between gap-2 mt-1.5 pt-1.5 border-t border-surface-700/60">
              <span className="text-surface-400">{t('summary.runningTotal', 'Running total')}</span>
              <span className="font-semibold tabular-nums text-surface-100">{formatBytes(cumulative[hover.idx]!)}</span>
            </div>
            {hovered.items > 0 && <p className="mt-2 text-surface-500">{t('summary.tipClick', 'Click to list them')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** When the disk fills at the measured download rate: without the rules, and with them. */
function DiskFull({
  data,
  now,
  free,
  bytesPerDay,
  t,
  dates,
}: {
  data: ForecastResult;
  now: Date;
  free: number;
  bytesPerDay: number;
  t: T;
  dates: ReturnType<typeof useDates>;
}) {
  // Looks as far ahead as the forecast goes, whatever period is picked.
  const full = useMemo(() => {
    const when = (counting: 'all' | 'certain' | 'none') => daysUntilFull(data.items, now, free, bytesPerDay, counting, data.horizonDays);
    return { none: when('none'), certain: when('certain'), all: when('all') };
  }, [data.items, data.horizonDays, now, free, bytesPerDay]);

  const rows = [
    { key: 'none', label: t('chart.legendNoRules', 'Without your rules'), day: full.none, className: 'bg-surface-400' },
    // Only worth a row when the certain part of the rules makes a difference on its own.
    ...(full.certain !== full.none && full.certain !== full.all
      ? [{ key: 'certain', label: t('chart.rowCertain', 'With your rules, counting only what’s certain'), day: full.certain, className: 'bg-accent-500' }]
      : []),
    { key: 'all', label: t('chart.rowAll', 'With your rules, if none of it gets watched'), day: full.all, className: 'bg-violet-500' },
  ];
  const longest = Math.max(1, ...rows.map((r) => r.day ?? data.horizonDays));
  const whenText = (day: number | null) =>
    day === null
      ? t('chart.fullNever', 'not within {{years}} years', { years: Math.round(data.horizonDays / 365) })
      : day === 0
        ? t('chart.fullNow', 'now')
        : t('chart.fullAround', 'around {{date}}', { date: dates.month(dayKey(new Date(now.getTime() + day * DAY_MS)).slice(0, 7)) });

  return (
    <div className="mt-4 rounded-lg bg-surface-800/50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-surface-500 mb-2">
        {t('chart.fullTitle', 'Disk full at this rate')}
      </p>
      <dl className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-1 sm:grid-cols-[minmax(0,18rem)_1fr] gap-x-4 gap-y-1 items-center text-sm">
            <dt className="text-surface-300">{r.label}</dt>
            <dd className="flex items-center gap-3 min-w-0">
              <span className="flex-1 h-2 rounded-full bg-surface-700/60 overflow-hidden">
                <span className={cn('block h-full rounded-full', r.className)} style={{ width: `${((r.day ?? data.horizonDays) / longest) * 100}%` }} />
              </span>
              <span className="w-36 shrink-0 font-medium text-surface-100">{whenText(r.day)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
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
        <p className="text-xs text-surface-400">
          {item.ruleName ? t('why.queued', 'Queued by this rule') : t('why.queuedManually', 'Queued by hand')}
        </p>
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
