import settingsRepo from '../db/repositories/settings';
import unraidSnapshotsRepo, { type CapacitySource } from '../db/repositories/unraidSnapshots';
import logger from '../utils/logger';
import { UnraidService } from './unraid';
import { getArrStorage, type ArrApp } from './arrStorage';
import { getRadarrService, getSonarrService } from './init';
import { getUsageForPaths, type FsUsage } from './diskSpace';

/**
 * Storage, from whichever source the install has: Unraid's array, or the
 * drives Sonarr and Radarr report. Every storage view, the disk-pressure gauge
 * and the disk-pressure cleanup read this one shape, so they work with either.
 */

const KB_TO_BYTES = 1024;
const BYTES_PER_TB = 1024 ** 4;

export type StorageSourcePreference = 'auto' | CapacitySource;

export interface StorageDisk {
  name: string;
  device: string;
  size: number;
  used: number;
  free: number;
  usedPercent: number;
  temp?: number;
  status: 'active' | 'standby' | 'error' | 'unknown';
  /** Unraid's array roles, or `drive` for a Sonarr/Radarr drive. */
  type: 'data' | 'parity' | 'cache' | 'drive';
  filesystem?: string;
  /** Sonarr/Radarr drives: the media root folders on it, and which apps. */
  rootFolders?: string[];
  apps?: ArrApp[];
}

export interface StorageTrend {
  /** Used TB at the end of each recent month, oldest first. */
  trend?: number[];
  growthPerMonth?: number;
  forecastFullMonths?: number;
}

export interface UnraidStorage extends StorageTrend {
  configured: true;
  arrayState: 'Started' | 'Stopped' | 'Syncing' | 'Unknown';
  totalCapacity: number;
  usedCapacity: number;
  freeCapacity: number;
  usedPercent: number;
  disks: StorageDisk[];
  lastUpdated: string;
  health: { parityValid: boolean; spinDownEligible: number };
}

export interface StorageStats extends StorageTrend {
  /** A source returned capacity. False while nothing is connected. */
  configured: boolean;
  /** The source these numbers come from; null when none is available. */
  source: CapacitySource | null;
  /** The saved choice. 'auto' prefers Unraid, then Sonarr/Radarr. */
  preference: StorageSourcePreference;
  /** Which sources are connected, so the UI can offer a switch. */
  available: Record<CapacitySource, boolean>;
  totalCapacity?: number;
  usedCapacity?: number;
  freeCapacity?: number;
  usedPercent?: number;
  disks?: StorageDisk[];
  lastUpdated?: string;
  /** Unraid only. */
  arrayState?: UnraidStorage['arrayState'];
  health?: UnraidStorage['health'];
  /** Sonarr/Radarr only: apps that couldn't be read this time. */
  failedApps?: ArrApp[];
  /** Why the chosen source returned nothing, when it didn't. */
  error?: string;
}

/* ---------------------------------- Unraid --------------------------------- */

export function getUnraidConfig(): { url: string; apiKey: string } | null {
  const url = settingsRepo.getValue('unraid_url');
  const apiKey = settingsRepo.getValue('unraid_apiKey');
  return url && apiKey ? { url, apiKey } : null;
}

function mapDiskStatus(status: string): StorageDisk['status'] {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('active') || statusLower === 'disk_ok') return 'active';
  if (statusLower.includes('standby')) return 'standby';
  if (statusLower.includes('error') || statusLower.includes('fail')) return 'error';
  return 'unknown';
}

function mapArrayState(state: string): UnraidStorage['arrayState'] {
  const stateLower = state.toLowerCase();
  if (stateLower === 'started') return 'Started';
  if (stateLower === 'stopped') return 'Stopped';
  if (stateLower.includes('sync')) return 'Syncing';
  return 'Unknown';
}

/** Unraid's array, in bytes. Throws when Unraid can't be reached. */
export async function readUnraidStorage(config: { url: string; apiKey: string }): Promise<UnraidStorage> {
  const arrayStats = await new UnraidService(config.url, config.apiKey).getArrayStats();

  const totalCapacity = arrayStats.capacity.kilobytes.total * KB_TO_BYTES;
  const usedCapacity = arrayStats.capacity.kilobytes.used * KB_TO_BYTES;
  const freeCapacity = arrayStats.capacity.kilobytes.free * KB_TO_BYTES;
  const usedPercent = totalCapacity > 0 ? (usedCapacity / totalCapacity) * 100 : 0;

  const disks: StorageDisk[] = [
    ...arrayStats.disks.map((disk) => {
      const size = disk.fsSize !== null ? disk.fsSize * KB_TO_BYTES : disk.size;
      const used = disk.fsUsed !== null ? disk.fsUsed * KB_TO_BYTES : 0;
      const free = disk.fsFree !== null ? disk.fsFree * KB_TO_BYTES : 0;
      return {
        name: disk.name,
        device: disk.id || disk.name,
        size,
        used,
        free,
        usedPercent: size > 0 ? (used / size) * 100 : 0,
        temp: disk.temp ?? undefined,
        status: mapDiskStatus(disk.status),
        type: 'data' as const,
        filesystem: undefined,
      };
    }),
    ...arrayStats.parities.map((parity) => ({
      name: parity.name,
      device: parity.id || parity.name,
      size: parity.size,
      used: 0,
      free: 0,
      usedPercent: 0,
      temp: parity.temp ?? undefined,
      status: mapDiskStatus(parity.status),
      type: 'parity' as const,
      filesystem: undefined,
    })),
    ...arrayStats.caches.map((cache) => {
      const size = cache.fsSize !== null ? cache.fsSize * KB_TO_BYTES : cache.size;
      const used = cache.fsUsed !== null ? cache.fsUsed * KB_TO_BYTES : 0;
      const free = cache.fsFree !== null ? cache.fsFree * KB_TO_BYTES : 0;
      return {
        name: cache.name,
        device: cache.id || cache.name,
        size,
        used,
        free,
        usedPercent: size > 0 ? (used / size) * 100 : 0,
        temp: cache.temp ?? undefined,
        status: 'active' as const,
        type: 'cache' as const,
        filesystem: undefined,
      };
    }),
  ];

  recordSnapshot('unraid', { total: totalCapacity, used: usedCapacity, free: freeCapacity });

  // Health: parity is "valid" when we have parity disks and none are in error.
  const parityDisks = disks.filter((d) => d.type === 'parity');
  const parityValid = parityDisks.length > 0 && parityDisks.every((d) => d.status !== 'error');
  const spinDownEligible = disks.filter((d) => d.status === 'standby').length;

  return {
    configured: true,
    arrayState: mapArrayState(arrayStats.state),
    totalCapacity,
    usedCapacity,
    freeCapacity,
    usedPercent,
    disks,
    lastUpdated: new Date().toISOString(),
    ...capacityTrend('unraid', freeCapacity),
    health: { parityValid, spinDownEligible },
  };
}

/* ------------------------------- Sonarr/Radarr ------------------------------ */

/** Sonarr/Radarr's media drives, as one total; null when none are readable. */
export async function readArrStorage(): Promise<
  | (Required<Pick<StorageStats, 'totalCapacity' | 'usedCapacity' | 'freeCapacity' | 'usedPercent' | 'disks' | 'lastUpdated'>> &
      StorageTrend & { failedApps: ArrApp[] })
  | null
> {
  const { drives, failed } = await getArrStorage();
  if (drives.length === 0) return null;

  const totalCapacity = drives.reduce((sum, d) => sum + d.totalBytes, 0);
  const freeCapacity = drives.reduce((sum, d) => sum + d.freeBytes, 0);
  const usedCapacity = totalCapacity - freeCapacity;

  recordSnapshot('arr', { total: totalCapacity, used: usedCapacity, free: freeCapacity });

  return {
    totalCapacity,
    usedCapacity,
    freeCapacity,
    usedPercent: totalCapacity > 0 ? (usedCapacity / totalCapacity) * 100 : 0,
    disks: drives.map((d) => ({
      name: d.name,
      device: d.path,
      size: d.totalBytes,
      used: d.usedBytes,
      free: d.freeBytes,
      usedPercent: d.usedPercent,
      status: 'active' as const,
      type: 'drive' as const,
      // Shown under the drive's name: which apps keep media on it.
      filesystem: d.apps.map((a) => (a === 'sonarr' ? 'Sonarr' : 'Radarr')).join(' · '),
      rootFolders: d.rootFolders,
      apps: d.apps,
    })),
    lastUpdated: new Date().toISOString(),
    ...capacityTrend('arr', freeCapacity),
    failedApps: failed,
  };
}

/* ---------------------------------- Shared ---------------------------------- */

/** Best-effort daily snapshot, so the trend builds up without the scheduled task. */
export function recordSnapshot(source: CapacitySource, reading: { total: number; used: number; free: number }): void {
  try {
    if (!unraidSnapshotsRepo.hasTodaySnapshot(source)) unraidSnapshotsRepo.capture(reading, source);
  } catch (error) {
    logger.warn(`Failed to capture ${source} capacity snapshot`, { error });
  }
}

/** Monthly usage, growth per month and a "full in N months" forecast. */
export function capacityTrend(source: CapacitySource, freeBytes: number): StorageTrend {
  try {
    const monthly = unraidSnapshotsRepo.getMonthlyTrend(12, source);
    const out: StorageTrend = {};
    if (monthly.length > 0) out.trend = monthly.map((s) => s.usedBytes / BYTES_PER_TB);
    if (monthly.length >= 2) {
      // Divide by the real gap so a 4-month hole doesn't read as one month.
      const last = monthly[monthly.length - 1]!;
      const prev = monthly[monthly.length - 2]!;
      const [ly = 0, lm = 0] = last.month.split('-').map(Number);
      const [py = 0, pm = 0] = prev.month.split('-').map(Number);
      const monthsBetween = Math.max(1, (ly - py) * 12 + (lm - pm));
      out.growthPerMonth = (last.usedBytes - prev.usedBytes) / BYTES_PER_TB / monthsBetween;
      if (out.growthPerMonth > 0.01) {
        const months = Math.round(freeBytes / (out.growthPerMonth * BYTES_PER_TB));
        if (months > 0 && months <= 240) out.forecastFullMonths = months;
      }
    }
    return out;
  } catch (error) {
    logger.warn(`Failed to compute ${source} capacity trend`, { error });
    return {};
  }
}

export function getStoragePreference(): StorageSourcePreference {
  const value = settingsRepo.getValue('storage_source');
  return value === 'unraid' || value === 'arr' ? value : 'auto';
}

export function storageAvailability(): Record<CapacitySource, boolean> {
  return {
    unraid: getUnraidConfig() !== null,
    arr: Boolean(getSonarrService() || getRadarrService()),
  };
}

/** The source to read: the saved choice when connected, else whichever is. */
export function resolveStorageSource(
  preference: StorageSourcePreference,
  available: Record<CapacitySource, boolean>
): CapacitySource | null {
  if (preference !== 'auto' && available[preference]) return preference;
  if (available.unraid) return 'unraid';
  if (available.arr) return 'arr';
  return null;
}

/** Storage from the chosen source (or `override`, without saving it). */
export async function getStorageStats(override?: CapacitySource): Promise<StorageStats> {
  const preference = getStoragePreference();
  const available = storageAvailability();
  const source = override && available[override] ? override : resolveStorageSource(preference, available);
  const base = { preference, available, source };

  if (source === 'unraid') {
    const config = getUnraidConfig()!;
    try {
      const unraid = await readUnraidStorage(config);
      return { ...base, ...unraid };
    } catch (error) {
      logger.warn('Failed to read Unraid storage', { message: (error as Error).message });
      return { ...base, configured: false, error: (error as Error).message };
    }
  }

  if (source === 'arr') {
    try {
      const arr = await readArrStorage();
      if (!arr) return { ...base, configured: false, error: 'Sonarr and Radarr reported no media drives' };
      return { ...base, configured: true, ...arr };
    } catch (error) {
      logger.warn('Failed to read Sonarr/Radarr storage', { message: (error as Error).message });
      return { ...base, configured: false, error: (error as Error).message };
    }
  }

  return { ...base, configured: false };
}

/* ------------------------------ Disk pressure ------------------------------- */

/**
 * What disk-pressure cleanup watches: the folder paths the user typed in when
 * there are any (they mean "this exact mount"), otherwise the chosen storage
 * source — Unraid's array as one filesystem, or each Sonarr/Radarr drive.
 */
export async function getPressureUsages(paths: string[]): Promise<{ usages: FsUsage[]; source: FsUsage['source'] | null }> {
  if (paths.length > 0) {
    const usages = (await getUsageForPaths(paths)).map((u) => ({ ...u, source: 'paths' as const }));
    return { usages, source: 'paths' };
  }

  const stats = await getStorageStats();
  if (!stats.configured || !stats.source) return { usages: [], source: null };

  if (stats.source === 'unraid') {
    return {
      source: 'unraid',
      usages: [
        {
          path: '',
          key: 'unraid',
          totalBytes: stats.totalCapacity ?? 0,
          freeBytes: stats.freeCapacity ?? 0,
          usedBytes: stats.usedCapacity ?? 0,
          source: 'unraid',
        },
      ],
    };
  }

  return {
    source: 'arr',
    usages: (stats.disks ?? []).map((d) => ({
      path: d.device,
      key: `arr:${d.device}`,
      totalBytes: d.size,
      freeBytes: d.free,
      usedBytes: d.used,
      pathPrefixes: d.rootFolders,
      apps: d.apps,
      source: 'arr' as const,
    })),
  };
}
