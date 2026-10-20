import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { mergeTags } from '../scanner';

// Issue #84 follow-up: a tag set in Radarr was ignored whenever the item also
// had a Plex label, because only the first non-empty source was kept.
describe('mergeTags', () => {
  it('keeps Arr tags alongside Plex labels', () => {
    expect(mergeTags(['Overseerr'], ['nodelete'], [])).toEqual(['Overseerr', 'nodelete']);
  });

  it('drops case-insensitive duplicates and blanks, keeping the first spelling', () => {
    expect(mergeTags(['NoDelete', ' '], ['nodelete', 'keep'], undefined)).toEqual(['NoDelete', 'keep']);
  });

  it('returns an empty list when no source has tags', () => {
    expect(mergeTags(undefined, [], null)).toEqual([]);
  });
});
