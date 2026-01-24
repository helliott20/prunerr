import { Router, Request, Response } from 'express';
import { UnraidService } from '../services/unraid';
import settingsRepo from '../db/repositories/settings';
import logger from '../utils/logger';

const router = Router();

// Helper to convert kilobytes to bytes
const KB_TO_BYTES = 1024;

// Helper to get Unraid config from saved settings
function getUnraidConfig(): { url: string; apiKey: string } | null {
  const url = settingsRepo.getValue('unraid_url');
  const apiKey = settingsRepo.getValue('unraid_apiKey');

  if (!url || !apiKey) {
    return null;
  }

  return { url, apiKey };
}

// GET /api/unraid/test - Test connection to Unraid
router.get('/test', async (_req: Request, res: Response) => {
  try {
    const unraidConfig = getUnraidConfig();
    if (!unraidConfig) {
      res.status(400).json({
        success: false,
        error: 'Unraid is not configured. Please configure it in Settings.',
      });
      return;
    }

    const unraidService = new UnraidService(unraidConfig.url, unraidConfig.apiKey);
    const isConnected = await unraidService.testConnection();

    if (isConnected) {
      res.json({
        success: true,
        message: 'Successfully connected to Unraid',
      });
    } else {
      res.status(503).json({
        success: false,
        error: 'Failed to connect to Unraid. Please check your configuration.',
      });
    }
  } catch (error) {
    logger.error('Failed to test Unraid connection:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test Unraid connection',
    });
  }
});

// Helper to map status string to expected values
function mapDiskStatus(status: string): 'active' | 'standby' | 'error' | 'unknown' {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('active') || statusLower === 'disk_ok') return 'active';
  if (statusLower.includes('standby')) return 'standby';
  if (statusLower.includes('error') || statusLower.includes('fail')) return 'error';
  return 'unknown';
}

// Helper to map array state
function mapArrayState(state: string): 'Started' | 'Stopped' | 'Syncing' | 'Unknown' {
  const stateLower = state.toLowerCase();
  if (stateLower === 'started') return 'Started';
  if (stateLower === 'stopped') return 'Stopped';
  if (stateLower.includes('sync')) return 'Syncing';
  return 'Unknown';
}

// GET /api/unraid/stats - Get array stats from Unraid
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const unraidConfig = getUnraidConfig();
    if (!unraidConfig) {
      // Return a response indicating not configured, but don't error
      res.json({
        success: true,
        data: {
          configured: false,
        },
      });
      return;
    }

    const unraidService = new UnraidService(unraidConfig.url, unraidConfig.apiKey);
    const arrayStats = await unraidService.getArrayStats();

    // Calculate capacity values in bytes
    const totalCapacity = arrayStats.capacity.kilobytes.total * KB_TO_BYTES;
    const usedCapacity = arrayStats.capacity.kilobytes.used * KB_TO_BYTES;
    const freeCapacity = arrayStats.capacity.kilobytes.free * KB_TO_BYTES;
    const usedPercent = totalCapacity > 0 ? (usedCapacity / totalCapacity) * 100 : 0;

    // Combine all disks into a single array with type annotations
    const allDisks = [
      // Data disks
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
      // Parity disks
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
      // Cache disks
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

    res.json({
      success: true,
      data: {
        configured: true,
        arrayState: mapArrayState(arrayStats.state),
        totalCapacity,
        usedCapacity,
        freeCapacity,
        usedPercent,
        disks: allDisks,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get Unraid stats:', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
    res.status(500).json({
      success: false,
      error: `Failed to retrieve Unraid array statistics: ${errorMessage}`,
    });
  }
});

export default router;
