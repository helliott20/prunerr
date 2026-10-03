import { describe, it, expect } from 'vitest';
import {
  NO_FILTERS,
  applyFilters,
  checkpoints,
  freedBy,
  freedSeries,
  groupOf,
  sortItems,
  withinHorizon,
} from '../forecastData';
import type { ForecastEntry } from '@/types';

const NOW = new Date('2026-10-03T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

let id = 0;
const entry = (overrides: Partial<ForecastEntry> = {}): ForecastEntry => ({
  id: ++id,
  title: `Item ${id}`,
  type: 'movie',
  year: 2020,
  libraryKey: '1',
  posterUrl: null,
  sizeBytes: 10,
  freesBytes: 10,
  playCount: 0,
  lastWatchedAt: null,
  addedAt: null,
  eligibleAt: inDays(10),
  deleteAt: inDays(17),
  queued: false,
  eligibleNow: false,
  ruleId: 1,
  ruleName: 'Old',
  certainty: 'predictable',
  reasons: [],
  ...overrides,
});

describe('forecast data', () => {
  it('keeps queued items and those due within the horizon', () => {
    const items = [
      entry({ queued: true, eligibleAt: inDays(-3), deleteAt: inDays(2) }),
      entry({ eligibleAt: inDays(20) }),
      entry({ eligibleAt: inDays(40) }),
    ];
    expect(withinHorizon(items, NOW, 30)).toHaveLength(2);
  });

  it('spaces four checkpoints out to the horizon', () => {
    expect(checkpoints(365)).toEqual([91, 183, 274, 365]);
    expect(checkpoints(7)).toEqual([2, 4, 5, 7]);
  });

  it('adds up what is deleted by a day, split by certainty', () => {
    const items = [
      entry({ deleteAt: inDays(5), freesBytes: 100 }),
      entry({ deleteAt: inDays(5), freesBytes: 50, certainty: 'conditional' }),
      entry({ deleteAt: inDays(50), freesBytes: 1000 }),
    ];
    expect(freedBy(items, NOW, 10)).toEqual({ items: 2, bytes: 150, predictableBytes: 100 });
  });

  it('builds a cumulative series that ends on the horizon', () => {
    const items = [entry({ deleteAt: inDays(0), freesBytes: 5 }), entry({ deleteAt: inDays(20), freesBytes: 7, certainty: 'conditional' })];
    const series = freedSeries(items, NOW, 30);
    expect(series[0]).toEqual({ day: 0, total: 5, predictable: 5 });
    expect(series[series.length - 1]).toEqual({ day: 30, total: 12, predictable: 5 });
    expect(series.every((p, i) => i === 0 || p.total >= series[i - 1]!.total)).toBe(true);
  });

  it('filters by rule, type, certainty and title', () => {
    const items = [
      entry({ title: 'Arrival', ruleId: 1 }),
      entry({ title: 'Dune', ruleId: 2, type: 'show', certainty: 'conditional' }),
    ];
    expect(applyFilters(items, { ...NO_FILTERS, ruleId: 2 }).map((i) => i.title)).toEqual(['Dune']);
    expect(applyFilters(items, { ...NO_FILTERS, type: 'movie' }).map((i) => i.title)).toEqual(['Arrival']);
    expect(applyFilters(items, { ...NO_FILTERS, certainty: 'conditional' })).toHaveLength(1);
    expect(applyFilters(items, { ...NO_FILTERS, search: 'arr' })).toHaveLength(1);
  });

  it('puts queued, then due-now, then dated items first when sorting by date', () => {
    const later = entry({ eligibleAt: inDays(30) });
    const now = entry({ eligibleNow: true, eligibleAt: inDays(0) });
    const queued = entry({ queued: true, eligibleAt: inDays(-5) });
    const sooner = entry({ eligibleAt: inDays(3) });
    expect(sortItems([later, now, queued, sooner], 'date')).toEqual([queued, now, sooner, later]);
    expect(groupOf(queued)).toBe('queued');
    expect(groupOf(now)).toBe('now');
    expect(groupOf(later)).toBe(`month:${later.eligibleAt.slice(0, 7)}`);
  });

  it('sorts largest first by what deleting frees', () => {
    const small = entry({ freesBytes: 1 });
    const big = entry({ freesBytes: 9 });
    expect(sortItems([small, big], 'size')).toEqual([big, small]);
  });
});
