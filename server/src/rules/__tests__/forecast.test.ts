import { describe, it, expect } from 'vitest';
import { bytesFreed, forecastItem, prepareRules, type ForecastOptions } from '../forecast';
import type { MediaItem, Rule } from '../../types';

const NOW = new Date('2026-10-03T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const item = (overrides: Partial<MediaItem> = {}): MediaItem =>
  ({
    id: 1,
    title: 'Arrival',
    type: 'movie',
    plex_id: '100',
    status: 'monitored',
    play_count: 0,
    file_size: 10 * 1024 ** 3,
    added_at: daysAgo(300),
    last_watched_at: null,
    is_protected: false,
    library_key: '1',
    ...overrides,
  }) as MediaItem;

let nextId = 1;
const rule = (root: object, overrides: Partial<Rule> = {}): Rule =>
  ({
    id: nextId++,
    name: `Rule ${nextId}`,
    action: 'delete',
    enabled: true,
    media_type: 'all',
    library_keys: [],
    priority: 0,
    grace_period_days: 7,
    deletion_action: 'unmonitor_and_delete',
    conditions: JSON.stringify({ version: 2, root }),
    ...overrides,
  }) as unknown as Rule;

const and = (...children: object[]) => ({ kind: 'group', logic: 'AND', children });
const leaf = (field: string, operator: string, value: unknown, params?: object) => ({
  kind: 'condition',
  field,
  operator,
  value,
  ...(params ? { params } : {}),
});

const opts = (overrides: Partial<ForecastOptions> = {}): ForecastOptions => ({
  now: NOW,
  horizonDays: 730,
  ctx: { now: NOW, watchLookup: new Map(), showWatchLookup: new Map() },
  inProgress: { protect: true, recentDays: 60 },
  ...overrides,
});

describe('forecastItem', () => {
  it('finds the day an age condition is crossed', () => {
    const rules = prepareRules([rule(and(leaf('days_since_added', 'greater_than', 365)))]);
    const match = forecastItem(item(), rules, opts());
    // Added 300 days ago; "more than 365" first holds at 366 days, 66 days from now.
    expect(match?.dayOffset).toBe(66);
    expect(match?.certainty).toBe('predictable');
    expect(match?.reasons[0]).toMatchObject({ field: 'days_since_added', actual: 366 });
  });

  it('matches today when the rule already holds', () => {
    const rules = prepareRules([rule(and(leaf('days_since_added', 'greater_than', 30)))]);
    expect(forecastItem(item(), rules, opts())?.dayOffset).toBe(0);
  });

  it('returns null when nothing matches inside the horizon', () => {
    const rules = prepareRules([rule(and(leaf('days_since_added', 'greater_than', 5000)))]);
    expect(forecastItem(item(), rules, opts())).toBeNull();
  });

  it('calls anything that watching could change conditional', () => {
    const rules = prepareRules([
      rule(and(leaf('play_count', 'equals', 0), leaf('days_since_added', 'greater_than', 365))),
    ]);
    expect(forecastItem(item(), rules, opts())?.certainty).toBe('conditional');
  });

  it('follows days since watched', () => {
    const rules = prepareRules([rule(and(leaf('days_since_watched', 'greater_than', 180)))]);
    const match = forecastItem(item({ last_watched_at: daysAgo(170), play_count: 1 }), rules, opts());
    expect(match?.dayOffset).toBe(11);
  });

  it('follows a person’s last watch', () => {
    const rules = prepareRules([
      rule(and(leaf('watched_by_user', 'not_watched_since', null, { username: 'dan', days: 30 }))),
    ]);
    const ctx = {
      now: NOW,
      watchLookup: new Map([['100', new Map([['dan', new Date(daysAgo(20))]])]]),
      showWatchLookup: new Map(),
    };
    const match = forecastItem(item({ play_count: 1 }), rules, opts({ ctx }));
    expect(match?.dayOffset).toBeGreaterThanOrEqual(10);
    expect(match?.dayOffset).toBeLessThanOrEqual(11);
  });

  it('gives the item to the first rule by priority on the day it first matches', () => {
    const later = rule(and(leaf('days_since_added', 'greater_than', 400)), { name: 'High priority, later' });
    const sooner = rule(and(leaf('days_since_added', 'greater_than', 320)), { name: 'Low priority, sooner' });
    // Rules arrive sorted by priority, highest first, as the scan reads them.
    const match = forecastItem(item(), prepareRules([later, sooner]), opts());
    expect(match?.rule.name).toBe('Low priority, sooner');
    expect(match?.dayOffset).toBe(21);

    const both = rule(and(leaf('days_since_added', 'greater_than', 320)), { name: 'High priority, same day' });
    expect(forecastItem(item(), prepareRules([both, sooner]), opts())?.rule.name).toBe('High priority, same day');
  });

  it('respects the rule’s scope', () => {
    const tvOnly = rule(and(leaf('days_since_added', 'greater_than', 30)), { media_type: 'show' } as Partial<Rule>);
    expect(forecastItem(item(), prepareRules([tvOnly]), opts())).toBeNull();
  });

  it('waits for an in-progress show to stall', () => {
    const show = item({
      type: 'show',
      episode_count: 10,
      watched_episode_count: 4,
      last_watched_at: daysAgo(20),
      play_count: 4,
    });
    const rules = prepareRules([rule(and(leaf('days_since_added', 'greater_than', 30)))]);
    const match = forecastItem(show, rules, opts());
    // Watched 20 days ago; protection lifts once that's more than 60 days ago.
    expect(match?.dayOffset).toBe(41);
    expect(match?.certainty).toBe('conditional');

    const unprotected = forecastItem(show, rules, opts({ inProgress: { protect: false, recentDays: 60 } }));
    expect(unprotected?.dayOffset).toBe(0);
  });
});

describe('bytesFreed', () => {
  it('frees nothing when the rule only unmonitors', () => {
    expect(bytesFreed({ file_size: 100 }, 'unmonitor_only')).toBe(0);
    expect(bytesFreed({ file_size: 100 }, 'unmonitor_and_delete')).toBe(100);
    expect(bytesFreed({ file_size: null } as never, 'delete')).toBe(0);
  });
});
