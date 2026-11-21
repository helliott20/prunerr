import { describe, it, expect } from 'vitest';
import { planHistorySync, FULL_RESYNC_INTERVAL_DAYS } from '../historySyncPlan';

const now = new Date('2026-11-21T12:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

const synced = {
  cachedCount: 500,
  latestTimestamp: daysAgo(0.5),
  lastFullSyncAt: daysAgo(1),
  lastFullSyncDays: 365,
};

describe('planHistorySync', () => {
  it('fetches the whole lookback when the cache is empty', () => {
    const plan = planHistorySync({ ...synced, cachedCount: 0, latestTimestamp: null }, 365, now);
    expect(plan.mode).toBe('full');
    expect(plan.since.toISOString()).toBe(daysAgo(365));
  });

  it('syncs incrementally from the newest cached play after a recent full sync', () => {
    const plan = planHistorySync(synced, 365, now);
    expect(plan).toEqual({ mode: 'incremental', since: new Date(synced.latestTimestamp) });
  });

  it('runs a full sync on a cache filled before full syncs were recorded', () => {
    const plan = planHistorySync({ ...synced, lastFullSyncAt: null, lastFullSyncDays: null }, 365, now);
    expect(plan.mode).toBe('full');
  });

  it('runs a full sync when the lookback is raised past what the cache covers', () => {
    const plan = planHistorySync({ ...synced, lastFullSyncDays: 90 }, 365, now);
    expect(plan.mode).toBe('full');
    expect(plan.since.toISOString()).toBe(daysAgo(365));
  });

  it('stays incremental when the lookback is lowered', () => {
    expect(planHistorySync(synced, 30, now).mode).toBe('incremental');
  });

  it('runs a full sync again once the last one is a week old, to pick up late imports', () => {
    expect(planHistorySync({ ...synced, lastFullSyncAt: daysAgo(FULL_RESYNC_INTERVAL_DAYS - 0.1) }, 365, now).mode).toBe('incremental');
    expect(planHistorySync({ ...synced, lastFullSyncAt: daysAgo(FULL_RESYNC_INTERVAL_DAYS) }, 365, now).mode).toBe('full');
  });

  it('treats an unreadable full-sync time as stale', () => {
    expect(planHistorySync({ ...synced, lastFullSyncAt: 'garbage' }, 365, now).mode).toBe('full');
  });
});
