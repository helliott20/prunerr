import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import mediaItemsRepo from '../db/repositories/mediaItems';
import collectionsRepo from '../db/repositories/collections';
import rulesRepo from '../db/repositories/rules';
import storageSnapshotsRepo from '../db/repositories/storageSnapshots';
import settingsRepo from '../db/repositories/settings';
import { getUsageForPaths, resolveTargetBytes, type FsUsage, type TargetMode } from '../services/diskSpace';
import logger from '../utils/logger';

const router = Router();

interface DiskPressureStats {
  diskPressureEnabled: boolean;
  diskObserveOnly: boolean;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskTargetBytes: number | null;
  diskCriticalBytes: number | null;
  diskPressureSeverity: 'ok' | 'soft' | 'critical' | null;
  disks: Array<FsUsage & { targetBytes: number; criticalBytes: number; severity: 'ok' | 'soft' | 'critical' }>;
}

/**
 * Best-effort disk-pressure stats for the dashboard gauge and HA sensors.
 * Reads real free space via statfs on the configured paths; returns null
 * fields (never throws) when nothing can be read. The reported single-disk
 * fields reflect the most-pressured filesystem.
 */
async function computeDiskPressureStats(): Promise<DiskPressureStats> {
  const enabled = settingsRepo.getBoolean('diskPressure_enabled', false);
  const observeOnly = settingsRepo.getBoolean('diskPressure_observeOnly', true);
  const empty: DiskPressureStats = {
    diskPressureEnabled: enabled,
    diskObserveOnly: observeOnly,
    diskFreeBytes: null,
    diskTotalBytes: null,
    diskUsedBytes: null,
    diskTargetBytes: null,
    diskCriticalBytes: null,
    diskPressureSeverity: null,
    disks: [],
  };

  let paths: string[] = [];
  try {
    const raw = settingsRepo.getValue('diskPressure_paths');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) paths = parsed.filter((p) => typeof p === 'string' && p.trim().length > 0);
    }
  } catch {
    /* ignore malformed paths */
  }
  if (paths.length === 0) return empty;

  const mode = (settingsRepo.getValue('diskPressure_targetMode') as TargetMode) || 'percent';
  const targetValue = settingsRepo.getNumber('diskPressure_targetValue', 10);
  const criticalValue = settingsRepo.getNumber('diskPressure_criticalValue', 5);

  const usages = await getUsageForPaths(paths);
  if (usages.length === 0) return empty;

  const disks = usages.map((fs) => {
    const targetBytes = resolveTargetBytes(fs, mode, targetValue);
    const criticalBytes = resolveTargetBytes(fs, mode, criticalValue);
    const severity: 'ok' | 'soft' | 'critical' =
      fs.freeBytes < criticalBytes ? 'critical' : fs.freeBytes < targetBytes ? 'soft' : 'ok';
    return { ...fs, targetBytes, criticalBytes, severity };
  });

  // Surface the most-pressured filesystem in the flat fields.
  const rank = { critical: 2, soft: 1, ok: 0 } as const;
  const worst = disks.reduce((a, b) => (rank[b.severity] > rank[a.severity] ? b : a));

  return {
    diskPressureEnabled: enabled,
    diskObserveOnly: observeOnly,
    diskFreeBytes: worst.freeBytes,
    diskTotalBytes: worst.totalBytes,
    diskUsedBytes: worst.usedBytes,
    diskTargetBytes: worst.targetBytes,
    diskCriticalBytes: worst.criticalBytes,
    diskPressureSeverity: worst.severity,
    disks,
  };
}

// GET /api/stats - Get dashboard statistics
router.get('/', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    // Get media stats
    const mediaStats = mediaItemsRepo.getStats();

    // Get deletion stats
    const deletionStats = rulesRepo.deletionHistory.getStats();

    // Get pending deletion items. Mirror the Queue route's filter
    // (delete_after && marked_at) so the "Reclaimable" card's count and space
    // match what the Queue page actually shows. Items left in pending_deletion
    // without a delete_after are stuck/legacy rows the queue can't render, and
    // counting them here is what made the card overcount vs. the queue.
    const pendingDeletion = mediaItemsRepo
      .getPendingDeletion()
      .filter((item) => item.delete_after && item.marked_at);

    // Get latest scan
    const latestScan = rulesRepo.scanHistory.getLatest();

    // Get enabled rules count
    const enabledRules = rulesRepo.rules.getEnabled();

    // Calculate space that will be freed
    const pendingDeletionSize = pendingDeletion.reduce(
      (sum, item) => sum + (item.file_size || 0),
      0
    );

    // Get unwatched movie count
    const unwatchedMoviesStmt = db.prepare<[], { count: number }>(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'movie' AND (play_count = 0 OR play_count IS NULL)"
    );
    const unwatchedMovies = unwatchedMoviesStmt.get()?.count ?? 0;

    // Get unwatched show count
    const unwatchedShowsStmt = db.prepare<[], { count: number }>(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'show' AND (play_count = 0 OR play_count IS NULL)"
    );
    const unwatchedShows = unwatchedShowsStmt.get()?.count ?? 0;

    // Get items scanned today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const scannedTodayStmt = db.prepare<[string], { total: number | null }>(
      "SELECT SUM(items_scanned) as total FROM scan_history WHERE started_at >= ? AND status = 'completed'"
    );
    const scannedToday = scannedTodayStmt.get(todayStart.toISOString())?.total ?? 0;

    // Get space reclaimed this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const reclaimedThisWeekStmt = db.prepare<[string], { total: number | null }>(
      'SELECT SUM(file_size) as total FROM deletion_history WHERE deleted_at >= ?'
    );
    const reclaimedThisWeek = reclaimedThisWeekStmt.get(weekStart.toISOString())?.total ?? 0;

    // Calculate scan trend (this week vs last week)
    const thisWeekStart = new Date();
    thisWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekStart = new Date();
    lastWeekStart.setDate(lastWeekStart.getDate() - 14);

    const scanTrendStmt = db.prepare<[string, string], { total: number | null }>(
      "SELECT SUM(items_scanned) as total FROM scan_history WHERE started_at >= ? AND started_at < ? AND status = 'completed'"
    );
    const thisWeekScanned = scanTrendStmt.get(thisWeekStart.toISOString(), new Date().toISOString())?.total ?? 0;
    const lastWeekScanned = scanTrendStmt.get(lastWeekStart.toISOString(), thisWeekStart.toISOString())?.total ?? 0;
    const scanTrend = lastWeekScanned > 0
      ? Math.round(((thisWeekScanned - lastWeekScanned) / lastWeekScanned) * 100)
      : 0;

    // Calculate reclaimed trend (this week vs last week)
    const reclaimedTrendStmt = db.prepare<[string, string], { total: number | null }>(
      'SELECT SUM(file_size) as total FROM deletion_history WHERE deleted_at >= ? AND deleted_at < ?'
    );
    const thisWeekReclaimed = reclaimedTrendStmt.get(thisWeekStart.toISOString(), new Date().toISOString())?.total ?? 0;
    const lastWeekReclaimed = reclaimedTrendStmt.get(lastWeekStart.toISOString(), thisWeekStart.toISOString())?.total ?? 0;
    const reclaimedTrend = lastWeekReclaimed > 0
      ? Math.round(((thisWeekReclaimed - lastWeekReclaimed) / lastWeekReclaimed) * 100)
      : 0;

    // Disk-pressure / real free-space stats (best-effort; null when unreadable)
    const diskStats = await computeDiskPressureStats();

    res.json({
      success: true,
      data: {
        // Storage stats
        totalStorage: mediaStats.totalSize,
        usedStorage: mediaStats.totalSize,
        reclaimableSpace: pendingDeletionSize,

        // Disk-pressure / real free space (additive; for the gauge + HA sensors)
        ...diskStats,

        // Media counts
        movieCount: mediaStats.byType['movie'] ?? 0,
        tvShowCount: mediaStats.byType['show'] ?? 0,
        tvEpisodeCount: mediaStats.totalEpisodes ?? 0,

        // Unwatched counts
        unwatchedMovies,
        unwatchedShows,

        // Queue stats
        itemsMarkedForDeletion: pendingDeletion.length,

        // Scan stats
        scannedToday,
        scanTrend,

        // Reclaimed stats
        reclaimedThisWeek,
        reclaimedTrend,

        // Rules
        activeRules: enabledRules.length,

        // Collections
        collectionCount: collectionsRepo.findAll().length,
        protectedCollections: collectionsRepo.findAll().filter((c) => c.is_protected).length,
      },
    });
  } catch (error) {
    logger.error('Failed to get dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard statistics',
    });
  }
});

// GET /api/stats/storage-history - Get storage snapshots over time
router.get('/storage-history', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query['days'] as string, 10) || 30;
    const snapshots = storageSnapshotsRepo.getHistory(days);

    res.json({
      success: true,
      data: snapshots.map((s) => ({
        totalSize: s.total_size,
        movieSize: s.movie_size,
        showSize: s.show_size,
        itemCount: s.item_count,
        movieCount: s.movie_count,
        showCount: s.show_count,
        spaceReclaimed: s.space_reclaimed,
        capturedAt: s.captured_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to get storage history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve storage history',
    });
  }
});

// GET /api/stats/recommendations - Get recommended items for deletion
router.get('/recommendations', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query['limit'] as string, 10) || 10;
    const unwatchedDays = parseInt(req.query['unwatchedDays'] as string, 10) || 90;

    // Get items that haven't been watched in a long time
    const unwatchedItems = mediaItemsRepo.getUnwatched(unwatchedDays);

    // Filter out protected and already pending deletion items
    const candidates = unwatchedItems
      .filter((item) => !item.is_protected && item.status !== 'pending_deletion')
      .sort((a, b) => {
        // Sort by last watched date (oldest first), then by file size (largest first)
        const aDate = a.last_watched_at ? new Date(a.last_watched_at).getTime() : 0;
        const bDate = b.last_watched_at ? new Date(b.last_watched_at).getTime() : 0;
        if (aDate !== bDate) return aDate - bDate;
        return (b.file_size || 0) - (a.file_size || 0);
      })
      .slice(0, limit);

    // Calculate total reclaimable space
    const totalReclaimableSpace = candidates.reduce((sum, item) => sum + (item.file_size || 0), 0);

    // Transform items for client
    const recommendations = candidates.map((item) => {
      const lastWatchedDate = item.last_watched_at ? new Date(item.last_watched_at) : null;
      const daysSinceWatched = lastWatchedDate
        ? Math.floor((Date.now() - lastWatchedDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: String(item.id),
        title: item.title,
        type: item.type === 'show' ? 'tv' : item.type,
        size: item.file_size || 0,
        posterUrl: item.poster_url,
        lastWatched: item.last_watched_at,
        daysSinceWatched,
        neverWatched: !item.last_watched_at && item.play_count === 0,
        addedAt: item.added_at || item.created_at,
        playCount: item.play_count,
        reason: !item.last_watched_at || daysSinceWatched === null
          ? 'Never watched'
          : `Not watched in ${daysSinceWatched} days`,
      };
    });

    res.json({
      success: true,
      data: {
        items: recommendations,
        total: unwatchedItems.filter((item) => !item.is_protected && item.status !== 'pending_deletion').length,
        totalReclaimableSpace,
        criteria: {
          unwatchedDays,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to get deletion recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recommendations',
    });
  }
});

export default router;
