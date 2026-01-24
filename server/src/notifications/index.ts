import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import logger from '../utils/logger';
import config, { isServiceConfigured } from '../config';
import settingsRepo from '../db/repositories/settings';
import {
  type NotificationData,
  type NotificationEvent,
  type DiscordMessage,
  getPlainTextMessage,
  getDiscordMessage,
  getHtmlEmail,
  getEmailSubject,
} from './templates';

// ============================================================================
// Types
// ============================================================================

export interface NotificationConfig {
  email: {
    enabled: boolean;
    recipients: string[];
  };
  discord: {
    enabled: boolean;
  };
  telegram: {
    enabled: boolean;
  };
}

export interface NotificationResult {
  channel: 'email' | 'discord' | 'telegram';
  success: boolean;
  error?: string;
}

// ============================================================================
// Notification Service Class
// ============================================================================

/**
 * Service for sending notifications via multiple channels
 */
export class NotificationService {
  private emailTransporter: Transporter | null = null;
  private config: NotificationConfig;

  constructor(notificationConfig?: Partial<NotificationConfig>) {
    this.config = {
      email: {
        enabled: isServiceConfigured('smtp'),
        recipients: [],
        ...notificationConfig?.email,
      },
      discord: {
        enabled: isServiceConfigured('discord'),
        ...notificationConfig?.discord,
      },
      telegram: {
        enabled: isServiceConfigured('telegram'),
        ...notificationConfig?.telegram,
      },
    };

    this.initializeEmailTransporter();
  }

  /**
   * Initialize the email transporter
   */
  private initializeEmailTransporter(): void {
    if (!this.config.email.enabled) {
      logger.debug('Email notifications disabled - SMTP not configured');
      return;
    }

    try {
      this.emailTransporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.password,
        },
      });

      logger.info('Email transporter initialized');
    } catch (error) {
      logger.error('Failed to initialize email transporter:', error);
      this.config.email.enabled = false;
    }
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

    // Send email notification
    if (this.config.email.enabled && this.config.email.recipients.length > 0) {
      try {
        const subject = getEmailSubject(notificationEvent, data);
        const html = getHtmlEmail(notificationEvent, data);
        const text = getPlainTextMessage(notificationEvent, data);

        for (const recipient of this.config.email.recipients) {
          const result = await this.sendEmail(recipient, subject, text, html);
          results.push({
            channel: 'email',
            success: result,
            error: result ? undefined : 'Failed to send email',
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Email notification error:', error);
        results.push({
          channel: 'email',
          success: false,
          error: errorMessage,
        });
      }
    }

    // Send Discord notification - read settings at notification time
    const discordEnabled = settingsRepo.getBoolean('notifications_discordEnabled', false);
    const discordWebhook = settingsRepo.getValue('notifications_discordWebhook') || config.discord.webhookUrl;

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

    // Send Telegram notification
    if (this.config.telegram.enabled) {
      try {
        const message = getPlainTextMessage(notificationEvent, data);
        const result = await this.sendTelegram(
          config.telegram.botToken,
          config.telegram.chatId,
          message
        );
        results.push({
          channel: 'telegram',
          success: result,
          error: result ? undefined : 'Failed to send Telegram message',
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Telegram notification error:', error);
        results.push({
          channel: 'telegram',
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
  // Email Methods
  // ============================================================================

  /**
   * Send an email notification
   */
  async sendEmail(
    to: string,
    subject: string,
    text: string,
    html?: string
  ): Promise<boolean> {
    if (!this.emailTransporter) {
      logger.warn('Email transporter not configured, skipping email');
      return false;
    }

    try {
      logger.debug(`Sending email to ${to}: ${subject}`);

      const info = await this.emailTransporter.sendMail({
        from: config.smtp.from,
        to,
        subject,
        text,
        html,
      });

      logger.info(`Email sent successfully: ${info.messageId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to send email to ${to}:`, error);
      return false;
    }
  }

  /**
   * Verify email configuration
   */
  async verifyEmailConfig(): Promise<boolean> {
    if (!this.emailTransporter) {
      return false;
    }

    try {
      await this.emailTransporter.verify();
      logger.info('Email configuration verified successfully');
      return true;
    } catch (error) {
      logger.error('Email configuration verification failed:', error);
      return false;
    }
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
  // Telegram Methods
  // ============================================================================

  /**
   * Send a Telegram message
   */
  async sendTelegram(
    botToken: string,
    chatId: string,
    message: string
  ): Promise<boolean> {
    if (!botToken || !chatId) {
      logger.warn('Telegram configuration incomplete');
      return false;
    }

    try {
      logger.debug(`Sending Telegram message to chat ${chatId}`);

      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Telegram API error: ${JSON.stringify(errorData)}`);
      }

      logger.info('Telegram notification sent successfully');
      return true;
    } catch (error) {
      logger.error('Failed to send Telegram notification:', error);
      return false;
    }
  }

  /**
   * Send a Telegram message with Markdown formatting
   */
  async sendTelegramMarkdown(
    botToken: string,
    chatId: string,
    message: string
  ): Promise<boolean> {
    if (!botToken || !chatId) {
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
      });

      return response.ok;
    } catch (error) {
      logger.error('Failed to send Telegram message:', error);
      return false;
    }
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Update notification configuration
   */
  updateConfig(config: Partial<NotificationConfig>): void {
    if (config.email) {
      this.config.email = { ...this.config.email, ...config.email };
    }
    if (config.discord) {
      this.config.discord = { ...this.config.discord, ...config.discord };
    }
    if (config.telegram) {
      this.config.telegram = { ...this.config.telegram, ...config.telegram };
    }

    // Reinitialize email if needed
    if (config.email?.enabled !== undefined) {
      this.initializeEmailTransporter();
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
   * Add an email recipient
   */
  addEmailRecipient(email: string): void {
    if (!this.config.email.recipients.includes(email)) {
      this.config.email.recipients.push(email);
      logger.info(`Added email recipient: ${email}`);
    }
  }

  /**
   * Remove an email recipient
   */
  removeEmailRecipient(email: string): void {
    const index = this.config.email.recipients.indexOf(email);
    if (index > -1) {
      this.config.email.recipients.splice(index, 1);
      logger.info(`Removed email recipient: ${email}`);
    }
  }

  /**
   * Enable or disable a notification channel
   */
  setChannelEnabled(
    channel: 'email' | 'discord' | 'telegram',
    enabled: boolean
  ): void {
    switch (channel) {
      case 'email':
        this.config.email.enabled = enabled;
        if (enabled) {
          this.initializeEmailTransporter();
        }
        break;
      case 'discord':
        this.config.discord.enabled = enabled;
        break;
      case 'telegram':
        this.config.telegram.enabled = enabled;
        break;
    }
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
