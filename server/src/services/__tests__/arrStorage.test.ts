import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../init', () => ({ getSonarrService: () => null, getRadarrService: () => null }));

import { buildArrDrives, mountFor } from '../arrStorage';
import type { ArrDiskSpace, ArrRootFolder } from '../types';

const TB = 1024 ** 4;
const GB = 1024 ** 3;
const disk = (path: string, totalSpace: number, freeSpace: number, label = ''): ArrDiskSpace => ({ path, label, totalSpace, freeSpace });
const root = (path: string, accessible = true): ArrRootFolder => ({ id: 1, path, accessible, freeSpace: null });

describe('mountFor', () => {
  const mounts = [disk('/', 100 * GB, 40 * GB), disk('/data', 20 * TB, 5 * TB), disk('/tv', 8 * TB, 2 * TB)];

  it('picks the longest mount that contains the folder', () => {
    expect(mountFor('/data/media/movies', mounts)?.path).toBe('/data');
    expect(mountFor('/tv/', mounts)?.path).toBe('/tv');
    expect(mountFor('/srv/other', mounts)?.path).toBe('/');
  });

  it('matches whole path segments only', () => {
    expect(mountFor('/tv2/shows', mounts)?.path).toBe('/');
  });

  it('handles Windows paths', () => {
    expect(mountFor('D:\\TV Shows', [disk('C:\\', TB, GB), disk('D:\\', 4 * TB, TB)])?.path).toBe('D:\\');
  });
});

describe('buildArrDrives', () => {
  it('keeps only drives with media root folders, ignoring system mounts', () => {
    const drives = buildArrDrives([
      {
        app: 'sonarr',
        // As Sonarr reports it inside Docker: the container root, config and downloads too.
        diskSpace: [disk('/', 100 * GB, 40 * GB), disk('/config', 100 * GB, 40 * GB), disk('/tv', 20 * TB, 5 * TB), disk('/downloads', 2 * TB, TB)],
        rootFolders: [root('/tv/')],
      },
    ]);
    expect(drives).toHaveLength(1);
    expect(drives[0]).toMatchObject({
      path: '/tv',
      totalBytes: 20 * TB,
      freeBytes: 5 * TB,
      usedBytes: 15 * TB,
      usedPercent: 75,
      rootFolders: ['/tv/'],
      apps: ['sonarr'],
      name: '/tv/',
    });
  });

  it('counts a drive both apps see once, even under different paths', () => {
    const drives = buildArrDrives([
      { app: 'sonarr', diskSpace: [disk('/tv', 20 * TB, 5 * TB)], rootFolders: [root('/tv')] },
      // Read a moment later: a few hundred MB less free.
      { app: 'radarr', diskSpace: [disk('/movies', 20 * TB, 5 * TB - 300 * 1024 ** 2)], rootFolders: [root('/movies')] },
    ]);
    expect(drives).toHaveLength(1);
    expect(drives[0]).toMatchObject({ rootFolders: ['/tv', '/movies'], apps: ['sonarr', 'radarr'], name: '/tv, /movies' });
  });

  it('keeps two same-size drives apart when their free space differs', () => {
    const drives = buildArrDrives([
      { app: 'sonarr', diskSpace: [disk('/tv', 8 * TB, TB)], rootFolders: [root('/tv')] },
      { app: 'radarr', diskSpace: [disk('/movies', 8 * TB, 4 * TB)], rootFolders: [root('/movies')] },
    ]);
    expect(drives).toHaveLength(2);
  });

  it('uses the volume label when there is one', () => {
    const drives = buildArrDrives([{ app: 'radarr', diskSpace: [disk('D:\\', 4 * TB, TB, 'Media')], rootFolders: [root('D:\\Movies')] }]);
    expect(drives[0]!.name).toBe('Media');
  });

  it('skips inaccessible root folders and ones with no matching mount', () => {
    const drives = buildArrDrives([
      { app: 'sonarr', diskSpace: [disk('/tv', 8 * TB, TB)], rootFolders: [root('/tv', false), root('/elsewhere')] },
    ]);
    expect(drives).toEqual([]);
  });
});
