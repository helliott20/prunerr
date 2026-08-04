import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettingsDraft } from '../useSettingsDraft';
import type { Settings } from '@/types';

const saved: Partial<Settings> = {
  mediaServerType: 'plex',
  services: {
    plex: { url: 'http://plex.lan:32400', token: 'abc' },
    sonarr: { url: 'http://sonarr.lan:8989', apiKey: 'key' },
  },
  schedule: { enabled: true, interval: 'daily', time: '03:00', autoProcess: false },
};

describe('useSettingsDraft', () => {
  it('starts clean and mirrors the saved payload', () => {
    const { result } = renderHook(() => useSettingsDraft(saved));

    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.draft.mediaServerType).toBe('plex');
  });

  it('counts one staged change', () => {
    const { result } = renderHook(() => useSettingsDraft(saved));

    act(() => result.current.set('mediaServerType', 'jellyfin'));

    expect(result.current.dirtyCount).toBe(1);
    expect(result.current.draft.mediaServerType).toBe('jellyfin');
  });

  it('does not double-count repeated edits to the same field', () => {
    const { result } = renderHook(() => useSettingsDraft(saved));

    act(() => result.current.set('mediaServerType', 'jellyfin'));
    act(() => result.current.set('mediaServerType', 'emby'));

    expect(result.current.dirtyCount).toBe(1);
  });

  it('drops back to clean when a field is edited back to its saved value', () => {
    const { result } = renderHook(() => useSettingsDraft(saved));

    act(() => result.current.set('mediaServerType', 'jellyfin'));
    act(() => result.current.set('mediaServerType', 'plex'));

    expect(result.current.dirtyCount).toBe(0);
  });

  it('counts service credential edits per field', () => {
    const { result } = renderHook(() => useSettingsDraft(saved));

    act(() => result.current.setService('sonarr', 'url', 'http://new.lan:8989'));
    act(() => result.current.setService('sonarr', 'apiKey', 'newkey'));

    expect(result.current.dirtyCount).toBe(2);
    expect(result.current.draft.services?.sonarr?.url).toBe('http://new.lan:8989');
  });

  it('leaves untouched services intact when staging one', () => {
    const { result } = renderHook(() => useSettingsDraft(saved));

    act(() => result.current.setService('sonarr', 'url', 'http://new.lan:8989'));

    expect(result.current.draft.services?.plex?.token).toBe('abc');
  });

  it('discards staged edits', () => {
    const { result } = renderHook(() => useSettingsDraft(saved));

    act(() => result.current.set('mediaServerType', 'jellyfin'));
    act(() => result.current.discard());

    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.draft.mediaServerType).toBe('plex');
  });

  it('clears the dirty count once saved', () => {
    const { result } = renderHook(() => useSettingsDraft(saved));

    act(() => result.current.set('mediaServerType', 'jellyfin'));
    act(() => result.current.markSaved());

    expect(result.current.dirtyCount).toBe(0);
  });

  it('does not clobber staged edits when the saved payload refetches', () => {
    // React Query refetches settings on window focus; a staged edit must survive it.
    const { result, rerender } = renderHook(({ s }) => useSettingsDraft(s), {
      initialProps: { s: saved },
    });

    act(() => result.current.set('mediaServerType', 'jellyfin'));
    rerender({ s: { ...saved } });

    expect(result.current.draft.mediaServerType).toBe('jellyfin');
    expect(result.current.dirtyCount).toBe(1);
  });
});
