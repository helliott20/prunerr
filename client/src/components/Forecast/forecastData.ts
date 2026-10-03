import type { ForecastEntry } from '@/types';

/** Forecast lengths offered, in days. */
export const HORIZONS = [7, 30, 90, 180, 365, 730] as const;
export type Horizon = (typeof HORIZONS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayOffset(iso: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS));
}

/** Items the list shows for a horizon: queued ones, and those a rule reaches in time. */
export function withinHorizon(items: ForecastEntry[], now: Date, days: number): ForecastEntry[] {
  const end = now.getTime() + days * DAY_MS;
  return items.filter((i) => i.queued || new Date(i.eligibleAt).getTime() <= end);
}

/** Four evenly spaced days for the total tiles, ending on the horizon. */
export function checkpoints(days: number): number[] {
  const out = [0.25, 0.5, 0.75, 1].map((f) => Math.max(1, Math.round(days * f)));
  return [...new Set(out)];
}

export interface Totals {
  items: number;
  bytes: number;
  predictableBytes: number;
}

/** What is deleted (so freed) by `day` days from now, counting everything before. */
export function freedBy(items: ForecastEntry[], now: Date, day: number): Totals {
  const end = now.getTime() + day * DAY_MS;
  const totals: Totals = { items: 0, bytes: 0, predictableBytes: 0 };
  for (const item of items) {
    if (new Date(item.deleteAt).getTime() > end) continue;
    totals.items++;
    totals.bytes += item.freesBytes;
    if (item.certainty === 'predictable') totals.predictableBytes += item.freesBytes;
  }
  return totals;
}

export interface SeriesPoint {
  day: number;
  total: number;
  predictable: number;
}

/** Space freed so far, sampled across the horizon (about 60 points). */
export function freedSeries(items: ForecastEntry[], now: Date, days: number): SeriesPoint[] {
  const step = Math.max(1, Math.round(days / 60));
  const sorted = [...items]
    .map((i) => ({ day: dayOffset(i.deleteAt, now), bytes: i.freesBytes, predictable: i.certainty === 'predictable' }))
    .sort((a, b) => a.day - b.day);
  const points: SeriesPoint[] = [];
  let idx = 0;
  let total = 0;
  let predictable = 0;
  for (let day = 0; ; day = Math.min(days, day + step)) {
    while (idx < sorted.length && sorted[idx]!.day <= day) {
      total += sorted[idx]!.bytes;
      if (sorted[idx]!.predictable) predictable += sorted[idx]!.bytes;
      idx++;
    }
    points.push({ day, total, predictable });
    if (day >= days) break;
  }
  return points;
}

export type CertaintyFilter = 'all' | 'predictable' | 'conditional';
export type TypeFilter = 'all' | 'movie' | 'show';
export type SortKey = 'date' | 'size';

export interface Filters {
  ruleId: number | 'all';
  libraryKey: string | 'all';
  type: TypeFilter;
  certainty: CertaintyFilter;
  search: string;
}

export const NO_FILTERS: Filters = { ruleId: 'all', libraryKey: 'all', type: 'all', certainty: 'all', search: '' };

export function applyFilters(items: ForecastEntry[], f: Filters): ForecastEntry[] {
  const q = f.search.trim().toLowerCase();
  return items.filter(
    (i) =>
      (f.ruleId === 'all' || i.ruleId === f.ruleId) &&
      (f.libraryKey === 'all' || i.libraryKey === f.libraryKey) &&
      (f.type === 'all' || i.type === f.type) &&
      (f.certainty === 'all' || i.certainty === f.certainty) &&
      (!q || i.title.toLowerCase().includes(q))
  );
}

export function isFiltered(f: Filters): boolean {
  return f.ruleId !== 'all' || f.libraryKey !== 'all' || f.type !== 'all' || f.certainty !== 'all' || f.search.trim() !== '';
}

/** Queued first, then due at the next scan, then by date (or largest first). */
export function sortItems(items: ForecastEntry[], sort: SortKey): ForecastEntry[] {
  const rank = (i: ForecastEntry) => (i.queued ? 0 : i.eligibleNow ? 1 : 2);
  return [...items].sort((a, b) => {
    if (sort === 'size') return b.freesBytes - a.freesBytes || a.title.localeCompare(b.title);
    return rank(a) - rank(b) || a.eligibleAt.localeCompare(b.eligibleAt) || a.title.localeCompare(b.title);
  });
}

export type GroupKey = 'queued' | 'now' | `month:${string}`;

/** The heading an item sits under when sorted by date. */
export function groupOf(item: ForecastEntry): GroupKey {
  if (item.queued) return 'queued';
  if (item.eligibleNow) return 'now';
  return `month:${item.eligibleAt.slice(0, 7)}`;
}
