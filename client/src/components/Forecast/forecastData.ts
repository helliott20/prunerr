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
  return withinRange(items, now, 0, days);
}

/**
 * Items a rule reaches between two days from now (inclusive). A range that
 * starts today also holds what's already queued or due at the next scan.
 */
export function withinRange(items: ForecastEntry[], now: Date, fromDay: number, toDay: number): ForecastEntry[] {
  const start = now.getTime() + fromDay * DAY_MS;
  const end = now.getTime() + toDay * DAY_MS;
  return items.filter((i) => {
    if (i.queued || i.eligibleNow) return fromDay === 0;
    const at = new Date(i.eligibleAt).getTime();
    return at >= start && at <= end;
  });
}

/** `yyyy-mm-dd` for a date, in local time (what a date input holds). */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from now to the end of a `yyyy-mm-dd` day, clamped to [0, max]. */
export function daysUntilEndOf(dateInput: string, now: Date, max: number): number {
  const end = new Date(`${dateInput}T23:59:59`);
  if (Number.isNaN(end.getTime())) return 0;
  return Math.min(max, Math.max(0, Math.floor((end.getTime() - now.getTime()) / DAY_MS)));
}

/** Whole days from now to the start of a `yyyy-mm-dd` day, clamped to [0, max]. */
export function daysUntilStartOf(dateInput: string, now: Date, max: number): number {
  const start = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.min(max, Math.max(0, Math.ceil((start.getTime() - now.getTime()) / DAY_MS)));
}

export type BucketSize = 'day' | 'week' | 'month';

export interface FreedBucket {
  /** First day of the bucket (today for the first one). */
  start: Date;
  /** Last day of the bucket, inclusive. */
  end: Date;
  items: number;
  queued: number;
  predictable: number;
  /** Only if nobody watches it first. */
  conditional: number;
}

/** Days for up to two weeks, weeks up to four months, then months: about 5 to 25 bars. */
export function bucketSizeFor(days: number): BucketSize {
  return days <= 14 ? 'day' : days <= 120 ? 'week' : 'month';
}

/**
 * Space freed in each day, week or calendar month from today to `days` out.
 * Weeks run seven days from today; the first month is the rest of this one.
 * Anything overdue (a queued item waiting for the queue to run) counts today.
 */
export function freedBuckets(items: ForecastEntry[], now: Date, days: number): FreedBucket[] {
  const size = bucketSizeFor(days);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const buckets: FreedBucket[] = [];
  for (let start = today; start <= last; ) {
    const next =
      size === 'day'
        ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
        : size === 'week'
          ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
          : new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const end = new Date(Math.min(next.getTime(), last.getTime() + DAY_MS) - 1);
    buckets.push({ start, end, items: 0, queued: 0, predictable: 0, conditional: 0 });
    start = next;
  }
  for (const item of items) {
    const at = Math.max(today.getTime(), new Date(item.deleteAt).getTime());
    const bucket = buckets.find((b) => at <= b.end.getTime());
    if (!bucket) continue;
    bucket.items++;
    if (item.queued) bucket.queued += item.freesBytes;
    else if (item.certainty === 'predictable') bucket.predictable += item.freesBytes;
    else bucket.conditional += item.freesBytes;
  }
  return buckets;
}

export interface SeriesPoint {
  day: number;
  total: number;
  /** Queued or predictable: what happens even if things get watched. */
  predictable: number;
}

/** Space freed so far, sampled across the horizon (about 60 points). */
export function freedSeries(items: ForecastEntry[], now: Date, days: number): SeriesPoint[] {
  const step = Math.max(1, Math.round(days / 60));
  const sorted = [...items]
    .map((i) => ({ day: dayOffset(i.deleteAt, now), bytes: i.freesBytes, certain: i.queued || i.certainty === 'predictable' }))
    .sort((a, b) => a.day - b.day);
  const points: SeriesPoint[] = [];
  let idx = 0;
  let total = 0;
  let predictable = 0;
  for (let day = 0; ; day = Math.min(days, day + step)) {
    while (idx < sorted.length && sorted[idx]!.day <= day) {
      total += sorted[idx]!.bytes;
      if (sorted[idx]!.certain) predictable += sorted[idx]!.bytes;
      idx++;
    }
    points.push({ day, total, predictable });
    if (day >= days) break;
  }
  return points;
}

/** Average days in a month, for "per month" rates. */
export const DAYS_PER_MONTH = 30.44;

/**
 * Days until free space reaches zero, if downloads keep coming at
 * `bytesPerDay` and the rules free what they reach: everything ('all'),
 * only what's queued or predictable ('certain'), or nothing ('none').
 * Null when it doesn't fill within `maxDays`.
 */
export function daysUntilFull(
  items: ForecastEntry[],
  now: Date,
  freeBytes: number,
  bytesPerDay: number,
  counting: 'all' | 'certain' | 'none',
  maxDays: number
): number | null {
  if (bytesPerDay <= 0) return null;
  if (freeBytes <= 0) return 0;
  const frees = counting === 'none' ? [] : items.filter((i) => counting === 'all' || i.certainty === 'predictable');
  const byDay = new Map<number, number>();
  for (const i of frees) {
    const day = dayOffset(i.deleteAt, now);
    byDay.set(day, (byDay.get(day) ?? 0) + i.freesBytes);
  }
  let freed = 0;
  for (let day = 0; day <= maxDays; day++) {
    freed += byDay.get(day) ?? 0;
    if (freeBytes + freed - bytesPerDay * day <= 0) return day;
  }
  return null;
}

export type CertaintyFilter = 'all' | 'queued' | 'predictable' | 'conditional';
export type WatchFilter = 'all' | 'watched' | 'unwatched';
/** Smallest file size to show, in GB; 0 shows everything. */
export const SIZE_FILTERS = [0, 1, 10, 25, 50] as const;
export type SizeFilter = (typeof SIZE_FILTERS)[number];
export type TypeFilter = 'all' | 'movie' | 'show';
export type SortKey = 'date' | 'size';

export interface Filters {
  ruleId: number | 'all';
  libraryKey: string | 'all';
  type: TypeFilter;
  certainty: CertaintyFilter;
  watch: WatchFilter;
  minGb: SizeFilter;
  search: string;
}

export const NO_FILTERS: Filters = {
  ruleId: 'all',
  libraryKey: 'all',
  type: 'all',
  certainty: 'all',
  watch: 'all',
  minGb: 0,
  search: '',
};

/** The tag an item wears: queued items are their own kind. */
export function certaintyOf(item: ForecastEntry): Exclude<CertaintyFilter, 'all'> {
  return item.queued ? 'queued' : item.certainty;
}

const GB = 1024 ** 3;

export function applyFilters(items: ForecastEntry[], f: Filters): ForecastEntry[] {
  const q = f.search.trim().toLowerCase();
  return items.filter(
    (i) =>
      (f.ruleId === 'all' || i.ruleId === f.ruleId) &&
      (f.libraryKey === 'all' || i.libraryKey === f.libraryKey) &&
      (f.type === 'all' || i.type === f.type) &&
      (f.certainty === 'all' || certaintyOf(i) === f.certainty) &&
      (f.watch === 'all' || (f.watch === 'watched') === i.playCount > 0) &&
      i.sizeBytes >= f.minGb * GB &&
      (!q || i.title.toLowerCase().includes(q))
  );
}

export function isFiltered(f: Filters): boolean {
  return (
    f.ruleId !== 'all' ||
    f.libraryKey !== 'all' ||
    f.type !== 'all' ||
    f.certainty !== 'all' ||
    f.watch !== 'all' ||
    f.minGb !== 0 ||
    f.search.trim() !== ''
  );
}

/** Queued first, then due at the next scan, then by date (or largest first). */
export function sortItems(items: ForecastEntry[], sort: SortKey): ForecastEntry[] {
  const rank = (i: ForecastEntry) => (i.queued ? 0 : i.eligibleNow ? 1 : 2);
  return [...items].sort((a, b) => {
    if (sort === 'size') return b.freesBytes - a.freesBytes || a.title.localeCompare(b.title);
    // Queued and next-scan items show their deletion date; the rest group by eligibility.
    const when = (i: ForecastEntry) => (rank(i) < 2 ? i.deleteAt : i.eligibleAt);
    return rank(a) - rank(b) || when(a).localeCompare(when(b)) || a.title.localeCompare(b.title);
  });
}

export type GroupKey = 'queued' | 'now' | `month:${string}`;

/** The heading an item sits under when sorted by date. */
export function groupOf(item: ForecastEntry): GroupKey {
  if (item.queued) return 'queued';
  if (item.eligibleNow) return 'now';
  return `month:${item.eligibleAt.slice(0, 7)}`;
}

/** A local `yyyy-mm-dd` key for the day something happens. */
export function dayKey(d: Date): string {
  return toDateInput(d);
}

/**
 * Items keyed by the local day they would be deleted. Anything overdue (a
 * queued item waiting for the queue to run) sits on today.
 */
export function byDeletionDay(items: ForecastEntry[], now: Date): Map<string, ForecastEntry[]> {
  const today = dayKey(now);
  const out = new Map<string, ForecastEntry[]>();
  for (const item of items) {
    const at = new Date(item.deleteAt);
    const key = at.getTime() < now.getTime() ? today : dayKey(at);
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  for (const list of out.values()) list.sort((a, b) => b.freesBytes - a.freesBytes);
  return out;
}

/**
 * The weeks of a month for a calendar grid: each week is seven days, padded
 * with days from the months either side. `weekStartsOn` is 0 for Sunday,
 * 1 for Monday.
 */
export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1): Date[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(year, month, 1 - lead);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) week.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
    weeks.push(week);
    // Stop once the month is done and the week is full.
    const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (w + 1) * 7);
    if (next.getMonth() !== month && next > first) break;
  }
  return weeks;
}
