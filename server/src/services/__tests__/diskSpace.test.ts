import { describe, it, expect, vi, beforeEach } from 'vitest';

const statfsMock = vi.fn();

vi.mock('fs/promises', () => ({
  statfs: (...args: unknown[]) => statfsMock(...args),
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getFsUsage, getUsageForPaths, resolveTargetBytes, GiB } from '../diskSpace';

// bsize 4096, blocks 1,000,000 => 4.096 GB total; bavail 250,000 => ~1.024 GB free
const sample = { bsize: 4096, blocks: 1_000_000, bfree: 300_000, bavail: 250_000 };

describe('getFsUsage', () => {
  beforeEach(() => statfsMock.mockReset());

  it('computes total/free/used from statfs using bavail for free', async () => {
    statfsMock.mockResolvedValue(sample);
    const usage = await getFsUsage('/data');
    expect(usage).not.toBeNull();
    expect(usage!.totalBytes).toBe(4096 * 1_000_000);
    expect(usage!.freeBytes).toBe(4096 * 250_000); // bavail, not bfree
    expect(usage!.usedBytes).toBe(4096 * 1_000_000 - 4096 * 300_000);
    expect(usage!.key).toBe('1000000:4096');
  });

  it('returns null (never throws) when statfs rejects', async () => {
    statfsMock.mockImplementationOnce(async () => {
      throw new Error('ENOENT');
    });
    expect(await getFsUsage('/missing')).toBeNull();
  });

  it('returns null when total is non-positive', async () => {
    statfsMock.mockResolvedValue({ bsize: 4096, blocks: 0, bfree: 0, bavail: 0 });
    expect(await getFsUsage('/empty')).toBeNull();
  });
});

describe('getUsageForPaths', () => {
  beforeEach(() => statfsMock.mockReset());

  it('dedupes paths on the same filesystem and drops unreadable ones', async () => {
    statfsMock
      .mockResolvedValueOnce(sample) // /data/movies
      .mockResolvedValueOnce(sample) // /data/tv  -> same key, deduped
      .mockImplementationOnce(async () => {
        throw new Error('nope');
      }); // /other -> dropped
    const usages = await getUsageForPaths(['/data/movies', '/data/tv', '/other']);
    expect(usages).toHaveLength(1);
    expect(usages[0]!.path).toBe('/data/movies');
  });
});

describe('resolveTargetBytes', () => {
  const fs = { path: '/data', totalBytes: 100 * GiB, freeBytes: 10 * GiB, usedBytes: 90 * GiB, key: 'k' };

  it('percent mode = that % of total', () => {
    expect(resolveTargetBytes(fs, 'percent', 10)).toBe(10 * GiB);
  });

  it('percent mode clamps to 0..100', () => {
    expect(resolveTargetBytes(fs, 'percent', 250)).toBe(100 * GiB);
    expect(resolveTargetBytes(fs, 'percent', -5)).toBe(0);
  });

  it('absolute mode = value in GB', () => {
    expect(resolveTargetBytes(fs, 'absolute', 1)).toBe(GiB);
  });
});
