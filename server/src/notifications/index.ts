import logger from '../utils/logger';
import { isServiceConfigured } from '../config';
import settingsRepo from '../db/repositories/settings';
import {
  type NotificationData,
  type NotificationEvent,
  type DiscordMessage,
  getPlainTextMessage,
  getDiscordMessage,
} from './templates';

// ============================================================================
// Types
// ============================================================================

export interface NotificationConfig {
  discord: {
    enabled: boolean;
  };
}

export interface NotificationResult {
  channel: 'discord';
  success: boolean;
  error?: string;
}

// ============================================================================
// Notification Service Class
// ============================================================================

/**
 * Service for sending notifications via Discord
 */
export class NotificationService {
  private config: NotificationConfig;

  constructor(notificationConfig?: Partial<NotificationConfig>) {
    this.config = {
      discord: {
        enabled: isServiceConfigured('discord'),
        ...notificationConfig?.discord,
      },
    };
  }

  // ============================================================================
  // Main Notification Method
  // ============================================================================

  /**
   * Send notifications to all configured channels
   */
  async notify(event: NotificationEvent | string, data: NotificationData): Promise<NotificationResult[]> {
    logger.info(`Sending notification for event: ${event}`);

    const results: NotificationResult[] = [];
    const notificationEvent = event as NotificationEvent;

    // Send Discord notification - read settings at notification time
    const discordEnabled = settingsRepo.getBoolean('notifications_discordEnabled', false);
    const discordWebhook = settingsRepo.getValue('notifications_discordWebhook');

    if (discordEnabled && discordWebhook) {
      try {
        const message = getDiscordMessage(notificationEvent, data);
        const result = await this.sendDiscord(discordWebhook, message);
        results.push({
          channel: 'discord',
          success: result,
          error: result ? undefined : 'Failed to send Discord message',
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Discord notification error:', error);
        results.push({
          channel: 'discord',
          success: false,
          error: errorMessage,
        });
      }
    }

    // Log summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    logger.info(`Notification results: ${successful} successful, ${failed} failed`);

    return results;
  }

  // ============================================================================
  // Discord Methods
  // ============================================================================

  /**
   * Send a Discord webhook message
   */
  async sendDiscord(webhookUrl: string, message: DiscordMessage): Promise<boolean> {
    if (!webhookUrl) {
      logger.warn('Discord webhook URL not configured');
      return false;
    }

    try {
      logger.debug('Sending Discord notification');

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Discord API error: ${response.status} - ${errorText}`);
      }

      logger.info('Discord notification sent successfully');
      return true;
    } catch (error) {
      logger.error('Failed to send Discord notification:', error);
      return false;
    }
  }

  /**
   * Send a simple Discord text message
   */
  async sendDiscordText(webhookUrl: string, content: string): Promise<boolean> {
    return this.sendDiscord(webhookUrl, {
      content,
      username: 'Prunerr',
    });
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Update notification configuration
   */
  updateConfig(config: Partial<NotificationConfig>): void {
    if (config.discord) {
      this.config.discord = { ...this.config.discord, ...config.discord };
    }

    logger.info('Notification configuration updated');
  }

  /**
   * Get current notification configuration
   */
  getConfig(): NotificationConfig {
    return { ...this.config };
  }

  /**
   * Enable or disable a notification channel
   */
  setChannelEnabled(channel: 'discord', enabled: boolean): void {
    this.config.discord.enabled = enabled;
    logger.info(`${channel} notifications ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Test notification to all configured channels
   */
  async testNotifications(): Promise<NotificationResult[]> {
    const testData: NotificationData = {
      itemsScanned: 100,
      itemsFlagged: 5,
      itemsProtected: 10,
      durationMs: 1234,
    };

    return this.notify('SCAN_COMPLETE', testData);
  }
}

// Re-export types from templates for convenience
export { type NotificationEvent, type NotificationData } from './templates';

// ============================================================================
// Singleton Instance
// ============================================================================

let notificationServiceInstance: NotificationService | null = null;

/**
 * Get the singleton notification service instance
 */
export function getNotificationService(): NotificationService {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService();
  }
  return notificationServiceInstance;
}

/**
 * Create a new notification service instance with custom configuration
 */
export function createNotificationService(
  config?: Partial<NotificationConfig>
): NotificationService {
  return new NotificationService(config);
}

export default NotificationService;
