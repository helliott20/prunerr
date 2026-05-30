import { statfs } from 'fs/promises';
import logger from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface FsUsage {
  /** The path that was probed */
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  /** Coarse filesystem identity used to dedupe multiple paths on one mount */
  key: string;
}

export type TargetMode = 'percent' | 'absolute';

// ============================================================================
// Reading free space
// ============================================================================

/**
 * Read filesystem usage for a single path via statfs. Returns null (never
 * throws) when the path can't be read — a bad path or an OS where statfs
 * misbehaves must not take down the disk-pressure monitor.
 *
 * Uses `bavail` (blocks available to unprivileged users), not `bfree`, so the
 * number matches what the app can actually write.
 */
export async function getFsUsage(path: string): Promise<FsUsage | null> {
  try {
    const stats = await statfs(path);
    const blockSize = stats.bsize;
    const totalBytes = blockSize * stats.blocks;
    const freeBytes = blockSize * stats.bavail;
    const usedBytes = Math.max(0, totalBytes - blockSize * stats.bfree);

    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      logger.warn(`statfs returned non-positive total for ${path}`);
      return null;
    }

    return {
      path,
      totalBytes,
      freeBytes,
      usedBytes,
      key: `${stats.blocks}:${stats.bsize}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to read disk usage for ${path}: ${message}`);
    return null;
  }
}

/**
 * Read usage for several paths, dropping unreadable ones and de-duplicating
 * paths that resolve to the same filesystem (the common single-mount case).
 * The first path wins for a given filesystem.
 */
export async function getUsageForPaths(paths: string[]): Promise<FsUsage[]> {
  const results = await Promise.all(paths.map((p) => getFsUsage(p)));
  const seen = new Set<string>();
  const deduped: FsUsage[] = [];
  for (const usage of results) {
    if (!usage) continue;
    if (seen.has(usage.key)) continue;
    seen.add(usage.key);
    deduped.push(usage);
  }
  return deduped;
}

// ============================================================================
// Targets
// ============================================================================

/**
 * Resolve a configured target to an absolute byte threshold for a given
 * filesystem. Percent is interpreted as "keep this % of total free".
 */
export function resolveTargetBytes(fs: FsUsage, mode: TargetMode, value: number): number {
  if (mode === 'percent') {
    const pct = Math.max(0, Math.min(100, value));
    return Math.round((pct / 100) * fs.totalBytes);
  }
  // absolute: value is in GB
  return Math.round(value * 1024 * 1024 * 1024);
}

export const GiB = 1024 * 1024 * 1024;
