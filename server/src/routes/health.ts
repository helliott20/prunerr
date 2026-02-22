import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDatabase } from '../db';
import config, { isServiceConfigured } from '../config';
import logger from '../utils/logger';
import { getScheduler } from '../scheduler';
import * as scanHistoryRepo from '../db/repositories/scanHistoryRepo';
import { getPlexService, getRadarrService, getSonarrService, getTautulliService, getOverseerrService } from '../services/init';

// Read version from environment variable (set at Docker build time) or fallback to package.json
let appVersion = process.env['APP_VERSION'] || '1.0.0';
if (appVersion === '1.0.0') {
  try {
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    appVersion = packageJson.version || '1.0.0';
  } catch {
    logger.warn('Could not read version from package.json');
  }
}

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  database: {
    status: 'connected' | 'disconnected';
    path: string;
  };
  services: {
    plex: { configured: boolean };
    tautulli: { configured: boolean };
    sonarr: { configured: boolean };
    radarr: { configured: boolean };
    overseerr: { configured: boolean };
    discord: { configured: boolean };
  };
}

router.get('/', (_req: Request, res: Response) => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';

  try {
    const db = getDatabase();
    // Test database connection
    db.prepare('SELECT 1').get();
    dbStatus = 'connected';
  } catch (error) {
    logger.error('Database health check failed:', error);
    dbStatus = 'disconnected';
  }

  const health: HealthStatus = {
    status: dbStatus === 'connected' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: appVersion,
    uptime: process.uptime(),
    database: {
      status: dbStatus,
      path: config.dbPath,
    },
    services: {
      plex: { configured: isServiceConfigured('plex') },
      tautulli: { configured: isServiceConfigured('tautulli') },
      sonarr: { configured: isServiceConfigured('sonarr') },
      radarr: { configured: isServiceConfigured('radarr') },
      overseerr: { configured: isServiceConfigured('overseerr') },
      discord: { configured: isServiceConfigured('discord') },
    },
  };

  // Determine overall status
  const anyServiceConfigured = Object.values(health.services).some((s) => s.configured);
  if (dbStatus === 'connected' && anyServiceConfigured) {
    health.status = 'healthy';
  } else if (dbStatus === 'connected') {
    health.status = 'degraded';
  } else {
    health.status = 'unhealthy';
  }

  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(health);
});

// Simple ping endpoint for basic connectivity checks
router.get('/ping', (_req: Request, res: Response) => {
  res.json({ pong: true, timestamp: Date.now() });
});

// Version endpoint
router.get('/version', (_req: Request, res: Response) => {
  res.json({ version: appVersion });
});

// Detailed readiness check
router.get('/ready', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    db.prepare('SELECT 1').get();
    res.json({ ready: true });
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({ ready: false, error: 'Database not ready' });
  }
});

// Liveness check
router.get('/live', (_req: Request, res: Response) => {
  res.json({ live: true, timestamp: Date.now() });
});

// ============================================================================
// Aggregated Health Status for Dashboard
// ============================================================================

interface ServiceHealthStatus {
  service: string;
  configured: boolean;
  connected: boolean;
  responseTimeMs?: number;
  error?: string;
  lastChecked: string;
}

interface SchedulerStatus {
  isRunning: boolean;
  lastScan: string | null;
  nextRun: string | null;
  scanSchedule: string;
}

interface SystemHealthResponse {
  services: ServiceHealthStatus[];
  scheduler: SchedulerStatus;
  overall: 'healthy' | 'degraded' | 'unhealthy';
}

async function checkService(
  name: string,
  service: { testConnection: () => Promise<boolean> } | null
): Promise<ServiceHealthStatus> {
  const lastChecked = new Date().toISOString();

  if (!service) {
    return { service: name, configured: false, connected: false, lastChecked };
  }

  const startTime = Date.now();
  try {
    // Race the connection test against a 5-second timeout
    const connected = await Promise.race([
      service.testConnection(),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      ),
    ]);

    return {
      service: name,
      configured: true,
      connected,
      responseTimeMs: Date.now() - startTime,
      lastChecked,
    };
  } catch (error) {
    return {
      service: name,
      configured: true,
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      responseTimeMs: Date.now() - startTime,
      lastChecked,
    };
  }
}

function determineOverallHealth(services: ServiceHealthStatus[]): 'healthy' | 'degraded' | 'unhealthy' {
  const configuredServices = services.filter((s) => s.configured);
  if (configuredServices.length === 0) return 'unhealthy';

  const connectedCount = configuredServices.filter((s) => s.connected).length;
  if (connectedCount === configuredServices.length) return 'healthy';
  if (connectedCount > 0) return 'degraded';
  return 'unhealthy';
}

// Aggregated health status for dashboard
router.get('/status', async (_req: Request, res: Response) => {
  try {
    // Run all service checks in parallel
    const serviceChecks = await Promise.allSettled([
      checkService('plex', getPlexService()),
      checkService('radarr', getRadarrService()),
      checkService('sonarr', getSonarrService()),
      checkService('tautulli', getTautulliService()),
      checkService('overseerr', getOverseerrService()),
    ]);

    const serviceNames = ['plex', 'radarr', 'sonarr', 'tautulli', 'overseerr'];
    const services: ServiceHealthStatus[] = serviceChecks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        service: serviceNames[index] || 'unknown',
        configured: false,
        connected: false,
        error: result.reason instanceof Error ? result.reason.message : 'Check failed',
        lastChecked: new Date().toISOString(),
      };
    });

    // Get scheduler info
    const scheduler = getScheduler();
    const scanJobStatus = scheduler.getJobStatus('scanLibraries');
    const schedulerConfig = scheduler.getConfig();

    // Get last scan from history
    const latestScan = scanHistoryRepo.getLatest();

    const response: SystemHealthResponse = {
      services,
      scheduler: {
        isRunning: scheduler.isSchedulerRunning(),
        lastScan: latestScan?.completed_at || latestScan?.started_at || null,
        nextRun: scanJobStatus?.nextRun?.toISOString() || null,
        scanSchedule: schedulerConfig.schedules.scanLibraries,
      },
      overall: determineOverallHealth(services),
    };

    res.json({ success: true, data: response });
  } catch (error) {
    logger.error('Health status check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check system health',
    });
  }
});

export default router;
