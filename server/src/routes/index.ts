import { Router } from 'express';
import healthRouter from './health';
import settingsRouter from './settings';
import mediaRouter from './media';
import rulesRouter from './rules';
import scanRouter from './scan';
import statsRouter from './stats';
import activityRouter from './activity';
import queueRouter from './queue';
import libraryRouter from './library';
import historyRouter from './history';
import unraidRouter from './unraid';

const router = Router();

// Mount all route handlers
router.use('/health', healthRouter);
router.use('/settings', settingsRouter);
router.use('/media', mediaRouter);
router.use('/rules', rulesRouter);
router.use('/scan', scanRouter);
router.use('/stats', statsRouter);
router.use('/activity', activityRouter);
router.use('/queue', queueRouter);
router.use('/library', libraryRouter);
router.use('/history', historyRouter);
router.use('/unraid', unraidRouter);

export default router;
