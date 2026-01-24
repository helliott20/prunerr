import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import mediaItemsRepo from '../db/repositories/mediaItems';
import rulesRepo from '../db/repositories/rules';
import logger from '../utils/logger';

const router = Router();

// GET /api/stats - Get dashboard statistics
router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    // Get media stats
    const mediaStats = mediaItemsRepo.getStats();

    // Get deletion stats
    const deletionStats = rulesRepo.deletionHistory.getStats();

    // Get pending deletion items
    const pendingDeletion = mediaItemsRepo.getPendingDeletion();

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

    res.json({
      success: true,
      data: {
        // Storage stats
        totalStorage: mediaStats.totalSize,
        usedStorage: mediaStats.totalSize,
        reclaimableSpace: pendingDeletionSize,

        // Media counts
        movieCount: mediaStats.byType['movie'] ?? 0,
        tvShowCount: mediaStats.byType['show'] ?? 0,
        tvEpisodeCount: 0, // Episodes not tracked separately

        // Unwatched counts
        unwatchedMovies,
        unwatchedShows,

        // Queue stats
        itemsMarkedForDeletion: pendingDeletion.length,

        // Scan stats
        scannedToday,
        scanTrend: 0, // Trend calculation not implemented

        // Reclaimed stats
        reclaimedThisWeek,
        reclaimedTrend: 0, // Trend calculation not implemented

        // Rules
        activeRules: enabledRules.length,
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
