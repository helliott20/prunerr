import { describe, it, expect } from 'vitest';

import {
  buildEpisodeHistoryEntries,
  episodeCount,
  episodeDetailLines,
  type TimelineEntry,
} from '../episodeActivity';
import type { SonarrHistoryEvent } from '@/types';

const HOUR = 60 * 60 * 1000;
const base = new Date('2026-03-01T12:00:00Z').getTime();

function event(
  overrides: Partial<SonarrHistoryEvent> & Pick<SonarrHistoryEvent, 'id' | 'date'>
): SonarrHistoryEvent {
  return {
    episodeId: overrides.id,
    seasonNumber: 1,
    episodeNumber: overrides.id,
    episodeTitle: `Episode ${overrides.id}`,
    eventType: 'imported',
    ...overrides,
  };
}

describe('buildEpisodeHistoryEntries', () => {
  it('groups a burst of the same event into one row', () => {
    const entries = buildEpisodeHistoryEntries([
      event({ id: 3, date: new Date(base).toISOString() }),
      event({ id: 2, date: new Date(base - HOUR).toISOString() }),
      event({ id: 1, date: new Date(base - 2 * HOUR).toISOString() }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('episodes_imported');
    expect(episodeCount(entries[0]!)).toBe(3);
    // The row is dated by the newest event in the group.
    expect(entries[0]!.createdAt).toBe(new Date(base).toISOString());
  });

  it('starts a new row once the gap exceeds the window', () => {
    const entries = buildEpisodeHistoryEntries([
      event({ id: 2, date: new Date(base).toISOString() }),
      event({ id: 1, date: new Date(base - 48 * HOUR).toISOString() }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => episodeCount(e))).toEqual([1, 1]);
  });

  it('never merges different event types', () => {
    const entries = buildEpisodeHistoryEntries([
      event({ id: 2, date: new Date(base).toISOString(), eventType: 'imported' }),
      event({ id: 1, date: new Date(base - HOUR).toISOString(), eventType: 'grabbed' }),
    ]);

    expect(entries.map((e) => e.action)).toEqual(['episodes_imported', 'episodes_grabbed']);
  });

  it('gives each row a distinct id that cannot collide with real activity ids', () => {
    const entries = buildEpisodeHistoryEntries([
      event({ id: 2, date: new Date(base).toISOString() }),
      event({ id: 1, date: new Date(base - 48 * HOUR).toISOString() }),
    ]);

    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
    expect(entries.every((e) => e.id < 0)).toBe(true);
  });

  it('returns nothing for an empty history', () => {
    expect(buildEpisodeHistoryEntries([])).toEqual([]);
  });
});

describe('episodeDetailLines', () => {
  const entry = (metadata: Record<string, unknown> | null): TimelineEntry => ({
    id: 1,
    eventType: 'deletion',
    action: 'episodes_deleted',
    actorType: 'user',
    actorId: null,
    actorName: null,
    targetType: null,
    targetId: null,
    targetTitle: null,
    metadata,
    createdAt: new Date(base).toISOString(),
  });

  it('reads our own grouped deletion metadata, showing sizes', () => {
    const lines = episodeDetailLines(
      entry({ episodes: [{ code: 'S01E01', title: 'Pilot', size: 1024 }] }),
      (bytes) => `${bytes} B`
    );
    expect(lines).toEqual([{ code: 'S01E01', title: 'Pilot', meta: '1024 B' }]);
  });

  it('prefers quality when the entry came from Sonarr history', () => {
    const lines = episodeDetailLines(
      entry({ episodes: [{ code: 'S02E03', title: 'Who Is Alive?', quality: 'WEBDL-1080p' }] }),
      String
    );
    expect(lines[0]).toMatchObject({ meta: 'WEBDL-1080p' });
  });

  it('ignores entries without an episode list or with malformed rows', () => {
    expect(episodeDetailLines(entry(null), String)).toEqual([]);
    expect(episodeDetailLines(entry({ episodes: 'nope' }), String)).toEqual([]);
    expect(episodeDetailLines(entry({ episodes: [null, 5, { title: 'no code' }] }), String)).toEqual([]);
  });
});

describe('episodeCount', () => {
  it('falls back to the episode list when no count is stored', () => {
    const entry: TimelineEntry = {
      id: 1,
      eventType: 'deletion',
      action: 'episodes_deleted',
      actorType: 'user',
      actorId: null,
      actorName: null,
      targetType: null,
      targetId: null,
      targetTitle: null,
      metadata: { episodes: [{ code: 'S01E01' }, { code: 'S01E02' }] },
      createdAt: new Date(base).toISOString(),
    };
    expect(episodeCount(entry)).toBe(2);
  });
});
