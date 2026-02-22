import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import settingsRepo from '../db/repositories/settings';
import { SettingInputSchema } from '../types';
import logger from '../utils/logger';
import { PlexService, TautulliService, SonarrService, RadarrService, OverseerrService, UnraidService } from '../services';
import { refreshServices, initializeServices } from '../services/init';
import { getScheduler } from '../scheduler';
import { getNotificationService } from '../notifications';

const router = Router();

// Schema for validating imported settings
const ImportSettingsSchema = z.object({
  version: z.number(),
  exportedAt: z.string(),
  appName: z.string().optional(),
  settings: z.record(z.string(), z.string()),
});

// Known setting key prefixes for validation
const KNOWN_SETTING_PREFIXES = [
  'plex_',
  'tautulli_',
  'sonarr_',
  'radarr_',
  'overseerr_',
  'unraid_',
  'notifications_',
  'schedule_',
  'display_',
  'exclusion_',
];

function isKnownSettingKey(key: string): boolean {
  return KNOWN_SETTING_PREFIXES.some(prefix => key.startsWith(prefix));
}

// Validation middleware
function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.issues,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// GET /api/settings - Get all settings in structured format
router.get('/', (_req: Request, res: Response) => {
  try {
    const rawSettings = settingsRepo.getAll();

    // Convert flat key-value pairs to structured object
    const services: Record<string, Record<string, string>> = {};
    const notifications: Record<string, string | boolean> = {};
    const schedule: Record<string, string | boolean | number> = {};
    const display: Record<string, string> = {};
    let exclusionPatterns: unknown[] = [];

    for (const setting of rawSettings) {
      const { key, value } = setting;

      // Parse exclusion patterns
      if (key === 'exclusion_patterns') {
        try {
          exclusionPatterns = JSON.parse(value);
        } catch { /* empty */ }
        continue;
      }

      // Parse service settings (e.g., plex_url, tautulli_apiKey)
      const serviceMatch = key.match(/^(plex|tautulli|sonarr|radarr|overseerr|unraid)_(.+)$/);
      if (serviceMatch && serviceMatch[1] && serviceMatch[2]) {
        const serviceName = serviceMatch[1];
        const field = serviceMatch[2];
        if (!services[serviceName]) {
          services[serviceName] = {};
        }
        services[serviceName][field] = value;
        continue;
      }

      // Parse notification settings
      if (key.startsWith('notifications_')) {
        const field = key.replace('notifications_', '');
        notifications[field] = value === 'true' ? true : value === 'false' ? false : value;
        continue;
      }

      // Parse schedule settings
      if (key.startsWith('schedule_')) {
        const field = key.replace('schedule_', '');
        if (value === 'true' || value === 'false') {
          schedule[field] = value === 'true';
        } else if (!isNaN(Number(value)) && field !== 'time') {
          schedule[field] = Number(value);
        } else {
          schedule[field] = value;
        }
        continue;
      }

      // Parse display settings
      if (key.startsWith('display_')) {
        const field = key.replace('display_', '');
        display[field] = value;
        continue;
      }
    }

    res.json({
      success: true,
      data: {
        services,
        notifications,
        schedule,
        display,
        exclusionPatterns,
      },
    });
  } catch (error) {
    logger.error('Failed to get settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve settings',
    });
  }
});

// GET /api/settings/export - Export all settings as JSON file
router.get('/export', (_req: Request, res: Response) => {
  try {
    const rawSettings = settingsRepo.getAll();

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appName: 'Prunerr',
      settings: rawSettings.reduce((acc, s) => ({
        ...acc,
        [s.key]: s.value
      }), {} as Record<string, string>),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=prunerr-settings.json');
    res.json(exportData);
  } catch (error) {
    logger.error('Failed to export settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export settings',
    });
  }
});

// POST /api/settings/import - Import settings from JSON
router.post('/import', async (req: Request, res: Response) => {
  try {
    const parsed = ImportSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid settings file format',
        details: parsed.error.issues,
      });
      return;
    }

    const { settings } = parsed.data;

    // Validate setting keys
    const unknownKeys = Object.keys(settings).filter(key => !isKnownSettingKey(key));
    if (unknownKeys.length > 0) {
      logger.warn(`Import contains unknown setting keys: ${unknownKeys.join(', ')}`);
    }

    // Check for expected settings structure (warn if missing common keys)
    const hasServiceSettings = Object.keys(settings).some(k =>
      k.startsWith('plex_') || k.startsWith('tautulli_') || k.startsWith('sonarr_') || k.startsWith('radarr_')
    );
    if (!hasServiceSettings) {
      logger.warn('Imported settings file contains no service configuration');
    }

    // Convert to array format for setMultiple - only import known keys
    const settingsArray = Object.entries(settings)
      .filter(([key]) => isKnownSettingKey(key))
      .map(([key, value]) => ({ key, value }));

    if (settingsArray.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No valid settings found in import file',
        details: unknownKeys.length > 0
          ? `Unknown keys ignored: ${unknownKeys.slice(0, 5).join(', ')}${unknownKeys.length > 5 ? '...' : ''}`
          : 'File appears to be empty or incorrectly formatted',
      });
      return;
    }

    const imported = settingsRepo.setMultiple(settingsArray);

    logger.info(`Imported ${imported.length} settings`);

    // Refresh services with new settings
    refreshServices();
    await initializeServices();

    res.json({
      success: true,
      message: `Successfully imported ${imported.length} settings`,
      data: {
        count: imported.length,
        skipped: unknownKeys.length,
        skippedKeys: unknownKeys.length > 0 ? unknownKeys.slice(0, 5) : undefined,
      },
    });
  } catch (error) {
    logger.error('Failed to import settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import settings',
    });
  }
});

// GET /api/settings/:key - Get a specific setting
router.get('/:key', (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const setting = settingsRepo.getByKey(key as string);

    if (!setting) {
      res.status(404).json({
        success: false,
        error: `Setting not found: ${key}`,
      });
      return;
    }

    res.json({
      success: true,
      data: setting,
    });
  } catch (error) {
    logger.error('Failed to get setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve setting',
    });
  }
});

// POST /api/settings - Create or update a setting
router.post('/', validateBody(SettingInputSchema), (req: Request, res: Response) => {
  try {
    const setting = settingsRepo.set(req.body);
    res.status(201).json({
      success: true,
      data: setting,
      message: 'Setting saved successfully',
    });
  } catch (error) {
    logger.error('Failed to save setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save setting',
    });
  }
});

// PUT /api/settings - Save all settings at once
router.put('/', async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    const savedSettings: Array<{ key: string; value: string }> = [];

    // Save services configuration
    if (settings.services) {
      for (const [service, config] of Object.entries(settings.services)) {
        if (config && typeof config === 'object') {
          const configObj = config as Record<string, string | boolean>;
          for (const [field, value] of Object.entries(configObj)) {
            if (value !== undefined && value !== null && value !== '') {
              const key = `${service}_${field}`;
              settingsRepo.set({ key, value: String(value) });
              savedSettings.push({ key, value: String(value) });
            }
          }
        }
      }
    }

    // Save notifications configuration
    if (settings.notifications) {
      for (const [field, value] of Object.entries(settings.notifications)) {
        if (value !== undefined && value !== null) {
          const key = `notifications_${field}`;
          settingsRepo.set({ key, value: String(value) });
          savedSettings.push({ key, value: String(value) });
        }
      }
    }

    // Save schedule configuration
    if (settings.schedule) {
      for (const [field, value] of Object.entries(settings.schedule)) {
        if (value !== undefined && value !== null) {
          const key = `schedule_${field}`;
          settingsRepo.set({ key, value: String(value) });
          savedSettings.push({ key, value: String(value) });
        }
      }
    }

    // Save display configuration
    if (settings.display) {
      for (const [field, value] of Object.entries(settings.display)) {
        if (value !== undefined && value !== null) {
          const key = `display_${field}`;
          settingsRepo.set({ key, value: String(value) });
          savedSettings.push({ key, value: String(value) });
        }
      }
    }

    // Update scheduler if schedule settings were changed
    const hasScheduleSettings = savedSettings.some(s => s.key.startsWith('schedule_'));
    if (hasScheduleSettings) {
      try {
        const scheduler = getScheduler();

        // Check if scheduling is enabled
        const isEnabled = settings.schedule?.enabled;

        if (isEnabled === false) {
          // Disable the scanLibraries task
          scheduler.disableTask('scanLibraries');
          logger.info('Scheduled scanning disabled');
        } else {
          // Build cron expression from saved schedule settings
          const interval = settings.schedule?.interval || 'daily';
          const time = settings.schedule?.time || '03:00';
          const dayOfWeek = settings.schedule?.dayOfWeek;

          // Parse time (format: "HH:mm")
          const [hour, minute] = time.split(':').map(Number);

          let cronExpression: string;
          switch (interval) {
            case 'hourly':
              cronExpression = `${minute} * * * *`;
              break;
            case 'weekly':
              // dayOfWeek: 0 = Sunday, 1 = Monday, etc.
              cronExpression = `${minute} ${hour} * * ${dayOfWeek ?? 0}`;
              break;
            case 'daily':
            default:
              cronExpression = `${minute} ${hour} * * *`;
              break;
          }

          // Enable the task and update its schedule
          scheduler.enableTask('scanLibraries');
          scheduler.updateSchedule('scanLibraries', cronExpression);
          logger.info(`Scheduler updated with new cron: ${cronExpression}`);
        }

        // Handle auto-process deletion queue setting
        const autoProcess = settings.schedule?.autoProcess;
        if (autoProcess === false) {
          scheduler.disableTask('processDeletionQueue');
          logger.info('Auto-process deletion queue disabled');
        } else if (autoProcess === true) {
          scheduler.enableTask('processDeletionQueue');
          logger.info('Auto-process deletion queue enabled');
        }
      } catch (error) {
        logger.error('Failed to update scheduler:', error);
        // Don't fail the request - settings are saved, scheduler will pick up on next cycle
      }
    }

    logger.info(`Saved ${savedSettings.length} settings`);

    // Refresh service instances if service settings were updated
    const hasServiceSettings = savedSettings.some(s =>
      s.key.match(/^(sonarr|radarr|overseerr)_(url|api_key)$/)
    );
    if (hasServiceSettings) {
      refreshServices();
      // Reinitialize with new settings
      await initializeServices();
    }

    res.json({
      success: true,
      data: savedSettings,
      message: `${savedSettings.length} settings saved successfully`,
    });
  } catch (error) {
    logger.error('Failed to save settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save settings',
    });
  }
});

// PUT /api/settings/:key - Update a specific setting
router.put('/:key', (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (typeof value !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Value must be a string',
      });
      return;
    }

    const setting = settingsRepo.set({ key: key as string, value });
    res.json({
      success: true,
      data: setting,
      message: 'Setting updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update setting',
    });
  }
});

// DELETE /api/settings/:key - Delete a setting
router.delete('/:key', (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const deleted = settingsRepo.delete(key as string);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: `Setting not found: ${key}`,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Setting deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete setting',
    });
  }
});

// POST /api/settings/bulk - Set multiple settings at once
const BulkSettingsSchema = z.array(SettingInputSchema);

router.post('/bulk', validateBody(BulkSettingsSchema), (req: Request, res: Response) => {
  try {
    const settings = settingsRepo.setMultiple(req.body);
    res.status(201).json({
      success: true,
      data: settings,
      message: `${settings.length} setting(s) saved successfully`,
    });
  } catch (error) {
    logger.error('Failed to save bulk settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save settings',
    });
  }
});

// GET /api/settings/prefix/:prefix - Get settings by prefix
router.get('/prefix/:prefix', (req: Request, res: Response) => {
  try {
    const { prefix } = req.params;
    const settings = settingsRepo.getStartingWith(prefix as string);
    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    logger.error('Failed to get settings by prefix:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve settings',
    });
  }
});

// POST /api/settings/test/discord - Test Discord webhook notification
// NOTE: This route must come BEFORE /test/:service to avoid being matched as a service
router.post('/test/discord', async (req: Request, res: Response) => {
  try {
    // Accept webhook URL from request body or fall back to stored setting
    const webhookUrl = req.body.webhookUrl || settingsRepo.getValue('notifications_discordWebhook');

    if (!webhookUrl) {
      res.status(400).json({
        success: false,
        error: 'No Discord webhook URL configured',
        details: 'Enter a webhook URL in the Notifications section and try again.',
      });
      return;
    }

    // Validate Discord webhook URL format
    if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
      res.status(400).json({
        success: false,
        error: 'Invalid Discord webhook URL format',
        details: 'URL must start with https://discord.com/api/webhooks/',
      });
      return;
    }

    // Send test notification using the service
    const notificationService = getNotificationService();
    const result = await notificationService.sendDiscordText(
      webhookUrl,
      '**Test notification from Prunerr!** Your Discord webhook is configured correctly.'
    );

    if (result) {
      res.json({
        success: true,
        message: 'Test notification sent successfully! Check your Discord channel.',
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to send notification',
        details: 'The webhook URL may be invalid or Discord may be unreachable.',
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to send test Discord notification:', error);
    res.status(500).json({
      success: false,
      error: `Failed to send notification: ${errorMessage}`,
    });
  }
});

// POST /api/settings/test/:service - Test connection to a service
router.post('/test/:service', async (req: Request, res: Response) => {
  const service = req.params['service'] as string;
  const validServices = ['plex', 'tautulli', 'sonarr', 'radarr', 'overseerr', 'unraid'];

  if (!validServices.includes(service)) {
    res.status(400).json({
      success: false,
      error: `Invalid service: ${service}. Valid services are: ${validServices.join(', ')}`,
    });
    return;
  }

  try {
    // Get service configuration from settings or request body
    const url = req.body.url || settingsRepo.getValue(`${service}_url`);
    const apiKey = req.body.apiKey || req.body.api_key || settingsRepo.getValue(`${service}_api_key`);
    const token = req.body.token || settingsRepo.getValue(`${service}_token`);

    if (!url) {
      res.status(400).json({
        success: false,
        error: `No URL configured for ${service}`,
      });
      return;
    }

    let testResult = false;
    let version: string | undefined;
    let serverName: string | undefined;

    switch (service) {
      case 'plex': {
        if (!token) {
          res.status(400).json({
            success: false,
            error: 'No token configured for Plex',
            details: 'Please enter your Plex token. You can find it at https://www.plex.tv/claim/ or in your Plex settings.',
          });
          return;
        }
        try {
          const plexService = new PlexService(url, token);
          testResult = await plexService.testConnection();
          if (!testResult) {
            res.status(400).json({
              success: false,
              error: `Cannot connect to Plex at ${url}`,
              details: 'Check that: 1) Plex is running, 2) The URL is correct (e.g., http://192.168.1.x:32400), 3) The token is correct',
            });
            return;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          res.status(400).json({
            success: false,
            error: `Plex connection error: ${errorMsg}`,
            details: `URL: ${url} - Make sure Plex is accessible from this server`,
          });
          return;
        }
        break;
      }
      case 'tautulli': {
        if (!apiKey) {
          res.status(400).json({
            success: false,
            error: 'No API key configured for Tautulli',
            details: 'Please enter your Tautulli API key. You can find it in Tautulli Settings > Web Interface > API Key',
          });
          return;
        }
        try {
          const tautulliService = new TautulliService(url, apiKey);
          testResult = await tautulliService.testConnection();
          if (!testResult) {
            res.status(400).json({
              success: false,
              error: `Cannot connect to Tautulli at ${url}`,
              details: 'Check that: 1) Tautulli is running, 2) The URL is correct (e.g., http://192.168.1.x:8181), 3) The API key is correct',
            });
            return;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          res.status(400).json({
            success: false,
            error: `Tautulli connection error: ${errorMsg}`,
            details: `URL: ${url} - Make sure Tautulli is accessible from this server`,
          });
          return;
        }
        break;
      }
      case 'sonarr': {
        if (!apiKey) {
          res.status(400).json({
            success: false,
            error: 'No API key configured for Sonarr',
          });
          return;
        }
        const sonarrService = new SonarrService(url, apiKey);
        testResult = await sonarrService.testConnection();
        break;
      }
      case 'radarr': {
        if (!apiKey) {
          res.status(400).json({
            success: false,
            error: 'No API key configured for Radarr',
          });
          return;
        }
        const radarrService = new RadarrService(url, apiKey);
        testResult = await radarrService.testConnection();
        break;
      }
      case 'overseerr': {
        if (!apiKey) {
          res.status(400).json({
            success: false,
            error: 'No API key configured for Overseerr',
          });
          return;
        }
        const overseerrService = new OverseerrService(url, apiKey);
        testResult = await overseerrService.testConnection();
        break;
      }
      case 'unraid': {
        if (!apiKey) {
          res.status(400).json({
            success: false,
            error: 'No API key configured for Unraid',
            details: 'Please enter your Unraid API key. You can generate one in Unraid Settings > Management Access > API Keys',
          });
          return;
        }
        try {
          const unraidService = new UnraidService(url, apiKey);
          testResult = await unraidService.testConnection();
          if (!testResult) {
            res.status(400).json({
              success: false,
              error: `Cannot connect to Unraid at ${url}`,
              details: 'Check that: 1) Unraid is running, 2) The URL is correct (e.g., https://tower.local or http://192.168.1.x), 3) The API key is correct',
            });
            return;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          res.status(400).json({
            success: false,
            error: `Unraid connection error: ${errorMsg}`,
            details: `URL: ${url} - Make sure Unraid is accessible from this server and the GraphQL API is enabled`,
          });
          return;
        }
        break;
      }
    }

    if (testResult) {
      res.json({
        success: true,
        message: `Successfully connected to ${service}`,
        data: {
          service,
          connected: true,
          version,
          serverName,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Failed to connect to ${service}`,
        data: {
          service,
          connected: false,
        },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to test ${service} connection:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to test ${service} connection: ${errorMessage}`,
      data: {
        service,
        connected: false,
      },
    });
  }
});

export default router;
