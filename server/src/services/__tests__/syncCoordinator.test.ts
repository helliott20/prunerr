import { describe, it, expect, vi, beforeEach } from 'vitest';

// The coordinator's closing 'complete' is only for runs that never sent one.
// Sending it after the scanner's own is what crashed streams in issue #101.

const { scanAll } = vi.hoisted(() => ({ scanAll: vi.fn() }));

vi.mock('../scanner', () => ({
  ScannerService: class {
    reinitialize() {}
    setDatabaseCallback() {}
    setPruneCallback() {}
    scanAll = (onProgress: (p: unknown) => void) => scanAll(onProgress);
  },
}));
vi.mock('../../db/repositories/mediaItems', () => ({ default: {} }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runLibrarySync, subscribeToSync } from '../syncCoordinator';

function collect(): unknown[] {
  const events: unknown[] = [];
  subscribeToSync((e) => events.push(e));
  return events;
}

const completes = (events: unknown[]) =>
  events.filter((e) => (e as { stage?: string }).stage === 'complete');

beforeEach(() => {
  scanAll.mockReset();
});

describe('runLibrarySync', () => {
  it('sends one complete when the scanner already sent its own', async () => {
    scanAll.mockImplementation(async (onProgress: (p: unknown) => void) => {
      onProgress({ stage: 'complete', message: 'Sync complete' });
      return { itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, errors: [] };
    });
    const events = collect();

    await runLibrarySync();

    expect(completes(events)).toEqual([{ stage: 'complete', message: 'Sync complete' }]);
  });

  it('still closes streams for a run that failed before completing', async () => {
    scanAll.mockRejectedValue(new Error('boom'));
    const events = collect();

    await runLibrarySync();

    expect(events.map((e) => (e as { stage: string }).stage)).toEqual(['error', 'complete']);
  });
});
