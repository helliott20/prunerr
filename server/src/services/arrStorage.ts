import logger from '../utils/logger';
import { getRadarrService, getSonarrService } from './init';
import type { ArrDiskSpace, ArrRootFolder } from './types';

/**
 * Storage as Sonarr and Radarr see it, for installs without Unraid.
 *
 * `GET /api/v3/diskspace` lists the mount behind each media root folder plus
 * every other fixed drive the app can see (the container's own `/`, `/config`
 * and so on), with free and total bytes. `GET /api/v3/rootfolder` lists the
 * media folders, with free space but no total. So each root folder is matched
 * to the diskspace mount it lives on — the longest path that contains it, the
 * same "path root" the apps use themselves — and only those drives count.
 *
 * The same drive usually shows up in both apps, often under different paths
 * (`/tv` in Sonarr, `/movies` in Radarr, both on one pool). Drives with the
 * same total size and near-identical free space are treated as one.
 */

export type ArrApp = 'sonarr' | 'radarr';

export interface StorageDrive {
  /** Stable for the life of the drive: its size and first mount path. */
  id: string;
  /** The volume label when there is one, else the media folders on it. */
  name: string;
  /** Mount path, as the first app to report it sees it. */
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  /** Media root folders on this drive, as each app names them. */
  rootFolders: string[];
  apps: ArrApp[];
}

export interface ArrAppStorage {
  app: ArrApp;
  diskSpace: ArrDiskSpace[];
  rootFolders: ArrRootFolder[];
}

/** Same drive seen twice: same size, free space within 1 GiB or 0.1%. */
const FREE_TOLERANCE_BYTES = 1024 ** 3;

function normalise(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  // Windows drive letters and paths compare case-insensitively.
  return /^[a-z]:/i.test(p) ? p.toLowerCase() : p;
}

function contains(mount: string, path: string): boolean {
  if (mount === '/') return path.startsWith('/');
  return path === mount || path.startsWith(`${mount}/`);
}

/** The diskspace entry a folder lives on: the longest mount path containing it. */
export function mountFor(folder: string, mounts: ArrDiskSpace[]): ArrDiskSpace | null {
  const target = normalise(folder);
  let best: ArrDiskSpace | null = null;
  let bestLength = -1;
  for (const mount of mounts) {
    if (!mount.path || !(mount.totalSpace > 0)) continue;
    const mp = normalise(mount.path);
    if (contains(mp, target) && mp.length > bestLength) {
      best = mount;
      bestLength = mp.length;
    }
  }
  return best;
}

function sameDrive(a: { totalBytes: number; freeBytes: number }, b: { totalBytes: number; freeBytes: number }): boolean {
  if (a.totalBytes !== b.totalBytes) return false;
  const tolerance = Math.max(FREE_TOLERANCE_BYTES, a.totalBytes * 0.001);
  return Math.abs(a.freeBytes - b.freeBytes) <= tolerance;
}

/** The drives the apps' media root folders are on, each counted once. */
export function buildArrDrives(apps: ArrAppStorage[]): StorageDrive[] {
  const drives: StorageDrive[] = [];
  for (const { app, diskSpace, rootFolders } of apps) {
    for (const folder of rootFolders) {
      if (!folder.path || folder.accessible === false) continue;
      const mount = mountFor(folder.path, diskSpace);
      if (!mount || !mount.path) continue;

      const totalBytes = mount.totalSpace;
      const freeBytes = Math.max(0, Math.min(mount.freeSpace, totalBytes));
      const existing = drives.find((d) => sameDrive(d, { totalBytes, freeBytes }));
      if (existing) {
        if (!existing.rootFolders.includes(folder.path)) existing.rootFolders.push(folder.path);
        if (!existing.apps.includes(app)) existing.apps.push(app);
        continue;
      }
      const usedBytes = totalBytes - freeBytes;
      drives.push({
        id: `${totalBytes}:${normalise(mount.path)}`,
        name: mount.label?.trim() || '',
        path: mount.path,
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
        rootFolders: [folder.path],
        apps: [app],
      });
    }
  }
  for (const drive of drives) {
    if (!drive.name) drive.name = drive.rootFolders.join(', ');
  }
  return drives;
}

export interface ArrStorageResult {
  /** Sonarr or Radarr is configured. */
  configured: boolean;
  drives: StorageDrive[];
  /** Apps that couldn't be read this time. */
  failed: ArrApp[];
}

const CACHE_MS = 60_000;
let cache: { at: number; result: ArrStorageResult } | null = null;

/** Forget the cached reading (settings changed, or a test). */
export function clearArrStorageCache(): void {
  cache = null;
}

/** Read both apps (cached for a minute; it's polled by the UI). */
export async function getArrStorage(options: { fresh?: boolean } = {}): Promise<ArrStorageResult> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.result;

  const services: Array<{ app: ArrApp; service: { getDiskSpace(): Promise<ArrDiskSpace[]>; getRootFolders(): Promise<ArrRootFolder[]> } }> = [];
  const sonarr = getSonarrService();
  const radarr = getRadarrService();
  if (sonarr) services.push({ app: 'sonarr', service: sonarr });
  if (radarr) services.push({ app: 'radarr', service: radarr });

  const reads = await Promise.allSettled(
    services.map(async ({ app, service }) => {
      const [diskSpace, rootFolders] = await Promise.all([service.getDiskSpace(), service.getRootFolders()]);
      return { app, diskSpace, rootFolders } satisfies ArrAppStorage;
    })
  );

  const ok: ArrAppStorage[] = [];
  const failed: ArrApp[] = [];
  reads.forEach((read, i) => {
    if (read.status === 'fulfilled') ok.push(read.value);
    else {
      failed.push(services[i]!.app);
      logger.warn(`Could not read storage from ${services[i]!.app}`, { message: (read.reason as Error)?.message });
    }
  });

  const result: ArrStorageResult = { configured: services.length > 0, drives: buildArrDrives(ok), failed };
  cache = { at: Date.now(), result };
  return result;
}
