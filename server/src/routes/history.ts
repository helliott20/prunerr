import { Router, Request, Response } from 'express';
import historyRepo from '../db/repositories/history';
import logger from '../utils/logger';

const router = Router();

// GET /api/history - Get deletion history with pagination and filtering
router.get('/', (req: Request, res: Response) => {
  try {
    const search = req.query['search'] as string | undefined;
    const page = parseInt(req.query['page'] as string, 10) || 1;
    const limit = parseInt(req.query['limit'] as string, 10) || 20;
    const dateRange = req.query['dateRange'] as '7d' | '30d' | '90d' | 'all' | undefined;

    // Validate dateRange
    const validDateRanges = ['7d', '30d', '90d', 'all'];
    if (dateRange && !validDateRanges.includes(dateRange)) {
      res.status(400).json({
        success: false,
        error: 'Invalid dateRange. Must be one of: 7d, 30d, 90d, all',
      });
      return;
    }

    const result = historyRepo.getHistory({
      search,
      page,
      limit,
      dateRange,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Failed to get deletion history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve deletion history',
    });
  }
});

// GET /api/history/export - Export history as CSV
router.get('/export', (req: Request, res: Response) => {
  try {
    const search = req.query['search'] as string | undefined;
    const dateRange = req.query['dateRange'] as '7d' | '30d' | '90d' | 'all' | undefined;

    // Validate dateRange
    const validDateRanges = ['7d', '30d', '90d', 'all'];
    if (dateRange && !validDateRanges.includes(dateRange)) {
      res.status(400).json({
        success: false,
        error: 'Invalid dateRange. Must be one of: 7d, 30d, 90d, all',
      });
      return;
    }

    const items = historyRepo.getAllHistoryForExport({
      search,
      dateRange,
    });

    const csv = historyRepo.generateCsv(items);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="deletion-history.csv"');
    res.send(csv);
  } catch (error) {
    logger.error('Failed to export deletion history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export deletion history',
    });
  }
});

export default router;
