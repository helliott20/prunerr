// ============================================================================
// Notification Templates for Prunerr
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface NotificationData {
  [key: string]: unknown;
}

export interface ItemsMarkedData {
  item?: {
    id: number;
    title: string;
    type: string;
  };
  items?: Array<{
    id: number;
    title: string;
    type: string;
  }>;
  gracePeriodDays: number;
  deleteAfter: string;
  ruleId?: number;
  ruleName?: string;
  count?: number;
}

export interface DeletionImminentData {
  items: Array<{
    id: number;
    title: string;
    daysRemaining: number;
  }>;
  count: number;
  urgency: 'high' | 'medium' | 'low';
}

export interface DeletionCompleteData {
  itemsDeleted: number;
  spaceFreedBytes: number;
  spaceFreedGB: string;
  errors: number;
  items?: Array<{
    title: string;
    type: string;
  }>;
}

export interface ScanCompleteData {
  itemsScanned: number;
  itemsFlagged: number;
  itemsProtected: number;
  durationMs: number;
}

export interface ScanErrorData {
  error: string;
  phase: 'scanning' | 'evaluating' | 'persisting';
  itemsScannedBeforeError?: number;
  timestamp: string;
}

export interface DeletionErrorData {
  error: string;
  itemsProcessedBeforeError: number;
  failedItemTitle?: string;
  timestamp: string;
}

// ============================================================================
// Discord Message Types
// ============================================================================

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
    icon_url?: string;
  };
  timestamp?: string;
  thumbnail?: {
    url: string;
  };
}

export interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

// ============================================================================
// Color Constants
// ============================================================================

const COLORS = {
  INFO: 0x3498db, // Blue
  SUCCESS: 0x2ecc71, // Green
  WARNING: 0xf39c12, // Orange
  ERROR: 0xe74c3c, // Red
  DELETION: 0x9b59b6, // Purple
};

// ============================================================================
// Plain Text Templates
// ============================================================================

/**
 * Generate plain text message for items marked for deletion
 */
export function getItemsMarkedText(data: ItemsMarkedData): string {
  if (data.item) {
    return (
      `[Prunerr] Item Marked for Deletion\n\n` +
      `Title: ${data.item.title}\n` +
      `Type: ${data.item.type}\n` +
      `Grace Period: ${data.gracePeriodDays} days\n` +
      `Will be deleted after: ${new Date(data.deleteAfter).toLocaleString()}\n` +
      (data.ruleName ? `Matched Rule: ${data.ruleName}\n` : '')
    );
  }

  if (data.items && data.items.length > 0) {
    const itemList = data.items
      .slice(0, 10)
      .map((item) => `  - ${item.title} (${item.type})`)
      .join('\n');

    return (
      `[Prunerr] ${data.count || data.items.length} Items Marked for Deletion\n\n` +
      `Items:\n${itemList}\n` +
      (data.items.length > 10 ? `  ... and ${data.items.length - 10} more\n` : '') +
      `\nGrace Period: ${data.gracePeriodDays} days\n` +
      `Will be deleted after: ${new Date(data.deleteAfter).toLocaleString()}\n` +
      (data.ruleName ? `Matched Rule: ${data.ruleName}\n` : '')
    );
  }

  return `[Prunerr] Items marked for deletion (${data.gracePeriodDays} day grace period)`;
}

/**
 * Generate plain text message for imminent deletions
 */
export function getDeletionImminentText(data: DeletionImminentData): string {
  const urgencyPrefix = data.urgency === 'high' ? '⚠️ URGENT: ' : '';
  const timeframe = data.urgency === 'high' ? 'within 24 hours' : 'within 3 days';

  const itemList = data.items
    .slice(0, 10)
    .map((item) => `  - ${item.title} (${item.daysRemaining} day${item.daysRemaining !== 1 ? 's' : ''} remaining)`)
    .join('\n');

  return (
    `${urgencyPrefix}[Prunerr] ${data.count} Item${data.count !== 1 ? 's' : ''} Pending Deletion\n\n` +
    `The following items will be deleted ${timeframe}:\n\n` +
    `${itemList}\n` +
    (data.items.length > 10 ? `  ... and ${data.items.length - 10} more\n` : '') +
    `\nReview and unmark items in Prunerr if you wish to keep them.`
  );
}

/**
 * Generate plain text message for completed deletions
 */
export function getDeletionCompleteText(data: DeletionCompleteData): string {
  let message =
    `[Prunerr] Deletion Complete\n\n` +
    `Items Deleted: ${data.itemsDeleted}\n` +
    `Space Freed: ${data.spaceFreedGB} GB\n`;

  if (data.errors > 0) {
    message += `Errors: ${data.errors}\n`;
  }

  if (data.items && data.items.length > 0) {
    const itemList = data.items
      .slice(0, 10)
      .map((item) => `  - ${item.title}`)
      .join('\n');
    message += `\nDeleted Items:\n${itemList}\n`;
    if (data.items.length > 10) {
      message += `  ... and ${data.items.length - 10} more\n`;
    }
  }

  return message;
}

/**
 * Generate plain text message for scan completion
 */
export function getScanCompleteText(data: ScanCompleteData): string {
  const durationSeconds = (data.durationMs / 1000).toFixed(1);

  return (
    `[Prunerr] Library Scan Complete\n\n` +
    `Items Scanned: ${data.itemsScanned}\n` +
    `Items Flagged: ${data.itemsFlagged}\n` +
    `Items Protected: ${data.itemsProtected}\n` +
    `Duration: ${durationSeconds}s`
  );
}

/**
 * Generate plain text message for scan error
 */
export function getScanErrorText(data: ScanErrorData): string {
  return (
    `[Prunerr] Scan Failed\n\n` +
    `Error during ${data.phase}: ${data.error}\n` +
    (data.itemsScannedBeforeError
      ? `Items scanned before error: ${data.itemsScannedBeforeError}\n`
      : '') +
    `Time: ${new Date(data.timestamp).toLocaleString()}`
  );
}

/**
 * Generate plain text message for deletion error
 */
export function getDeletionErrorText(data: DeletionErrorData): string {
  return (
    `[Prunerr] Deletion Error\n\n` +
    `Error: ${data.error}\n` +
    (data.failedItemTitle ? `Failed item: ${data.failedItemTitle}\n` : '') +
    `Items processed before error: ${data.itemsProcessedBeforeError}\n` +
    `Time: ${new Date(data.timestamp).toLocaleString()}`
  );
}

// ============================================================================
// Discord Templates
// ============================================================================

/**
 * Generate Discord message for items marked for deletion
 */
export function getItemsMarkedDiscord(data: ItemsMarkedData): DiscordMessage {
  const embed: DiscordEmbed = {
    title: 'Items Marked for Deletion',
    color: COLORS.WARNING,
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Prunerr Media Library Manager',
    },
  };

  if (data.item) {
    embed.description = `**${data.item.title}** has been marked for deletion.`;
    embed.fields = [
      { name: 'Type', value: data.item.type, inline: true },
      { name: 'Grace Period', value: `${data.gracePeriodDays} days`, inline: true },
      { name: 'Delete After', value: new Date(data.deleteAfter).toLocaleString(), inline: false },
    ];
    if (data.ruleName) {
      embed.fields.push({ name: 'Matched Rule', value: data.ruleName, inline: true });
    }
  } else if (data.items && data.items.length > 0) {
    const count = data.count || data.items.length;
    embed.description = `**${count} item${count !== 1 ? 's' : ''}** have been marked for deletion.`;

    const itemList = data.items
      .slice(0, 5)
      .map((item) => `• ${item.title} (${item.type})`)
      .join('\n');

    embed.fields = [
      {
        name: 'Items',
        value: itemList + (data.items.length > 5 ? `\n... and ${data.items.length - 5} more` : ''),
        inline: false,
      },
      { name: 'Grace Period', value: `${data.gracePeriodDays} days`, inline: true },
      { name: 'Delete After', value: new Date(data.deleteAfter).toLocaleString(), inline: true },
    ];
    if (data.ruleName) {
      embed.fields.push({ name: 'Matched Rule', value: data.ruleName, inline: true });
    }
  }

  return {
    embeds: [embed],
    username: 'Prunerr',
  };
}

/**
 * Generate Discord message for imminent deletions
 */
export function getDeletionImminentDiscord(data: DeletionImminentData): DiscordMessage {
  const isUrgent = data.urgency === 'high';
  const embed: DiscordEmbed = {
    title: isUrgent ? '⚠️ Imminent Deletions' : 'Upcoming Deletions',
    color: isUrgent ? COLORS.ERROR : COLORS.WARNING,
    description: `**${data.count} item${data.count !== 1 ? 's' : ''}** will be deleted ${
      isUrgent ? 'within 24 hours' : 'soon'
    }.`,
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Review in Prunerr to cancel deletions',
    },
  };

  const itemList = data.items
    .slice(0, 10)
    .map((item) => `• ${item.title} — ${item.daysRemaining} day${item.daysRemaining !== 1 ? 's' : ''} left`)
    .join('\n');

  embed.fields = [
    {
      name: 'Items',
      value: itemList + (data.items.length > 10 ? `\n... and ${data.items.length - 10} more` : ''),
      inline: false,
    },
  ];

  return {
    content: isUrgent ? '@here' : undefined,
    embeds: [embed],
    username: 'Prunerr',
  };
}

/**
 * Generate Discord message for completed deletions
 */
export function getDeletionCompleteDiscord(data: DeletionCompleteData): DiscordMessage {
  const embed: DiscordEmbed = {
    title: 'Deletion Complete',
    color: COLORS.SUCCESS,
    description: `Successfully deleted **${data.itemsDeleted}** item${data.itemsDeleted !== 1 ? 's' : ''}.`,
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Prunerr Media Library Manager',
    },
    fields: [
      { name: 'Space Freed', value: `${data.spaceFreedGB} GB`, inline: true },
    ],
  };

  if (data.errors > 0) {
    embed.fields!.push({ name: 'Errors', value: data.errors.toString(), inline: true });
    embed.color = COLORS.WARNING;
  }

  if (data.items && data.items.length > 0) {
    const itemList = data.items
      .slice(0, 5)
      .map((item) => `• ${item.title}`)
      .join('\n');
    embed.fields!.push({
      name: 'Deleted Items',
      value: itemList + (data.items.length > 5 ? `\n... and ${data.items.length - 5} more` : ''),
      inline: false,
    });
  }

  return {
    embeds: [embed],
    username: 'Prunerr',
  };
}

/**
 * Generate Discord message for scan completion
 */
export function getScanCompleteDiscord(data: ScanCompleteData): DiscordMessage {
  const durationSeconds = (data.durationMs / 1000).toFixed(1);

  const embed: DiscordEmbed = {
    title: 'Library Scan Complete',
    color: data.itemsFlagged > 0 ? COLORS.INFO : COLORS.SUCCESS,
    description: `Scanned **${data.itemsScanned}** items in ${durationSeconds}s.`,
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Prunerr Media Library Manager',
    },
    fields: [
      { name: 'Items Scanned', value: data.itemsScanned.toString(), inline: true },
      { name: 'Items Flagged', value: data.itemsFlagged.toString(), inline: true },
      { name: 'Items Protected', value: data.itemsProtected.toString(), inline: true },
    ],
  };

  return {
    embeds: [embed],
    username: 'Prunerr',
  };
}

/**
 * Generate Discord message for scan error
 */
export function getScanErrorDiscord(data: ScanErrorData): DiscordMessage {
  const embed: DiscordEmbed = {
    title: 'Scan Failed',
    color: COLORS.ERROR,
    description: `The library scan encountered an error during **${data.phase}**.`,
    timestamp: data.timestamp,
    footer: { text: 'Prunerr Media Library Manager' },
    fields: [
      { name: 'Error', value: data.error.substring(0, 1024), inline: false },
    ],
  };

  if (data.itemsScannedBeforeError) {
    embed.fields!.push({
      name: 'Items Before Error',
      value: String(data.itemsScannedBeforeError),
      inline: true,
    });
  }

  return { embeds: [embed], username: 'Prunerr' };
}

/**
 * Generate Discord message for deletion error
 */
export function getDeletionErrorDiscord(data: DeletionErrorData): DiscordMessage {
  const embed: DiscordEmbed = {
    title: 'Deletion Error',
    color: COLORS.ERROR,
    description: 'An error occurred while processing the deletion queue.',
    timestamp: data.timestamp,
    footer: { text: 'Prunerr Media Library Manager' },
    fields: [
      { name: 'Error', value: data.error.substring(0, 1024), inline: false },
      { name: 'Items Processed', value: String(data.itemsProcessedBeforeError), inline: true },
    ],
  };

  if (data.failedItemTitle) {
    embed.fields!.push({
      name: 'Failed Item',
      value: data.failedItemTitle,
      inline: true,
    });
  }

  return { embeds: [embed], username: 'Prunerr' };
}

// ============================================================================
// Template Selector Functions
// ============================================================================

export type NotificationEvent =
  | 'ITEMS_MARKED'
  | 'DELETION_IMMINENT'
  | 'DELETION_COMPLETE'
  | 'SCAN_COMPLETE'
  | 'SCAN_ERROR'
  | 'DELETION_ERROR';

/**
 * Get plain text message for any notification event
 */
export function getPlainTextMessage(event: NotificationEvent, data: NotificationData): string {
  switch (event) {
    case 'ITEMS_MARKED':
      return getItemsMarkedText(data as unknown as ItemsMarkedData);
    case 'DELETION_IMMINENT':
      return getDeletionImminentText(data as unknown as DeletionImminentData);
    case 'DELETION_COMPLETE':
      return getDeletionCompleteText(data as unknown as DeletionCompleteData);
    case 'SCAN_COMPLETE':
      return getScanCompleteText(data as unknown as ScanCompleteData);
    case 'SCAN_ERROR':
      return getScanErrorText(data as unknown as ScanErrorData);
    case 'DELETION_ERROR':
      return getDeletionErrorText(data as unknown as DeletionErrorData);
    default:
      return `[Prunerr] Notification: ${event}`;
  }
}

/**
 * Get Discord message for any notification event
 */
export function getDiscordMessage(event: NotificationEvent, data: NotificationData): DiscordMessage {
  switch (event) {
    case 'ITEMS_MARKED':
      return getItemsMarkedDiscord(data as unknown as ItemsMarkedData);
    case 'DELETION_IMMINENT':
      return getDeletionImminentDiscord(data as unknown as DeletionImminentData);
    case 'DELETION_COMPLETE':
      return getDeletionCompleteDiscord(data as unknown as DeletionCompleteData);
    case 'SCAN_COMPLETE':
      return getScanCompleteDiscord(data as unknown as ScanCompleteData);
    case 'SCAN_ERROR':
      return getScanErrorDiscord(data as unknown as ScanErrorData);
    case 'DELETION_ERROR':
      return getDeletionErrorDiscord(data as unknown as DeletionErrorData);
    default:
      return { content: `[Prunerr] ${event}`, username: 'Prunerr' };
  }
}

