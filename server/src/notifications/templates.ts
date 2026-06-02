// ============================================================================
// Notification Templates for Prunerr
// ============================================================================

import type { TFunction } from 'i18next';
import { getFixedT } from '../i18n';

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
  gracePeriodDays?: number;
  deleteAfter?: string;
  ruleId?: number;
  ruleName?: string;
  count?: number;
  // Grouped shape for scan-batch notifications (one Discord message covering
  // multiple rules that matched during the same scan)
  groups?: Array<{
    ruleId: number | null;
    ruleName: string;
    gracePeriodDays: number;
    deleteAfter: string;
    items: Array<{ id: number; title: string; type: string }>;
  }>;
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
    ruleName?: string;
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

export interface DiskPressureData {
  severity: 'soft' | 'critical';
  /** The breached filesystem path that triggered this event */
  path: string;
  freeBytes: number;
  totalBytes: number;
  targetBytes: number;
  /** How far below the target we are (targetBytes - freeBytes), >= 0 */
  deficitBytes: number;
  /** When true, nothing was queued; the items below are what *would* be reclaimed */
  observeOnly: boolean;
  itemsQueued: number;
  projectedReclaimBytes: number;
  deletionAction: string;
  items: Array<{
    id: number;
    title: string;
    type: string;
    sizeBytes: number;
  }>;
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

const AVATAR_URL = 'https://raw.githubusercontent.com/helliott20/prunerr/main/assets/icon.png';

/**
 * Format a duration in milliseconds to a human-readable string (e.g. "2m 15s").
 * Locale-neutral (numbers + fixed unit letters), so it is not translated.
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Format a Date or ISO string as a Discord relative timestamp: <t:UNIX:R>
 */
function discordTimestamp(date: string | Date, style: 'R' | 'f' | 'F' | 'D' | 't' | 'T' | 'd' = 'R'): string {
  const unix = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${unix}:${style}>`;
}

/**
 * Format a byte count to a human-readable string (e.g. "1.2 TB", "640 GB").
 * Locale-neutral, so it is not translated.
 */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

// ============================================================================
// Plain Text Templates
// ============================================================================

/**
 * Generate plain text message for items marked for deletion
 */
export function getItemsMarkedText(data: ItemsMarkedData, t: TFunction): string {
  if (data.groups && data.groups.length > 0) {
    const totalCount = data.count ?? data.groups.reduce((sum, g) => sum + g.items.length, 0);
    let msg = `${t('itemsMarked.groupedHeader', { count: totalCount })}\n\n`;
    for (const group of data.groups) {
      msg += `${t('itemsMarked.groupRule', { name: group.ruleName, days: group.gracePeriodDays })}\n`;
      msg += `${t('itemsMarked.willDeleteAfter', { date: new Date(group.deleteAfter).toLocaleString() })}\n`;
      const shown = group.items.slice(0, 10);
      for (const item of shown) {
        msg += `${t('itemsMarked.itemLine', { title: item.title, type: item.type })}\n`;
      }
      if (group.items.length > 10) {
        msg += `  ... ${t('common.andMore', { count: group.items.length - 10 })}\n`;
      }
      msg += '\n';
    }
    return msg.trimEnd();
  }

  if (data.item) {
    return (
      `${t('itemsMarked.singleHeader')}\n\n` +
      `${t('itemsMarked.fieldTitle', { title: data.item.title })}\n` +
      `${t('itemsMarked.fieldType', { type: data.item.type })}\n` +
      `${t('itemsMarked.fieldGracePeriod', { days: data.gracePeriodDays ?? 7 })}\n` +
      (data.deleteAfter ? `${t('itemsMarked.willDeleteAfter', { date: new Date(data.deleteAfter).toLocaleString() })}\n` : '') +
      (data.ruleName ? `${t('itemsMarked.fieldMatchedRule', { name: data.ruleName })}\n` : '')
    );
  }

  if (data.items && data.items.length > 0) {
    const itemList = data.items
      .slice(0, 10)
      .map((item) => t('itemsMarked.itemLine', { title: item.title, type: item.type }))
      .join('\n');

    return (
      `${t('itemsMarked.multiHeader', { count: data.count || data.items.length })}\n\n` +
      `${t('itemsMarked.itemsHeading')}\n${itemList}\n` +
      (data.items.length > 10 ? `  ... ${t('common.andMore', { count: data.items.length - 10 })}\n` : '') +
      `\n${t('itemsMarked.fieldGracePeriod', { days: data.gracePeriodDays ?? 7 })}\n` +
      (data.deleteAfter ? `${t('itemsMarked.willDeleteAfter', { date: new Date(data.deleteAfter).toLocaleString() })}\n` : '') +
      (data.ruleName ? `${t('itemsMarked.fieldMatchedRule', { name: data.ruleName })}\n` : '')
    );
  }

  return t('itemsMarked.fallback', { days: data.gracePeriodDays ?? 7 });
}

/**
 * Generate plain text message for imminent deletions
 */
export function getDeletionImminentText(data: DeletionImminentData, t: TFunction): string {
  const urgencyPrefix = data.urgency === 'high' ? t('deletionImminent.urgentPrefix') : '';
  const timeframe = data.urgency === 'high'
    ? t('deletionImminent.timeframeHigh')
    : t('deletionImminent.timeframeNormal');

  const itemList = data.items
    .slice(0, 10)
    .map((item) => t('deletionImminent.itemLine', { title: item.title, count: item.daysRemaining }))
    .join('\n');

  return (
    `${urgencyPrefix}${t('deletionImminent.header', { count: data.count })}\n\n` +
    `${t('deletionImminent.intro', { timeframe })}\n\n` +
    `${itemList}\n` +
    (data.items.length > 10 ? `  ... ${t('common.andMore', { count: data.items.length - 10 })}\n` : '') +
    `\n${t('deletionImminent.footer')}`
  );
}

/**
 * Generate plain text message for completed deletions
 */
export function getDeletionCompleteText(data: DeletionCompleteData, t: TFunction): string {
  let message =
    `${t('deletionComplete.header')}\n\n` +
    `${t('deletionComplete.itemsDeleted', { count: data.itemsDeleted })}\n` +
    `${t('deletionComplete.spaceFreed', { gb: data.spaceFreedGB })}\n`;

  if (data.errors > 0) {
    message += `${t('deletionComplete.errors', { count: data.errors })}\n`;
  }

  if (data.items && data.items.length > 0) {
    const itemList = data.items
      .slice(0, 10)
      .map((item) =>
        item.ruleName
          ? t('deletionComplete.itemLineWithRule', { title: item.title, rule: item.ruleName })
          : t('deletionComplete.itemLine', { title: item.title })
      )
      .join('\n');
    message += `\n${t('deletionComplete.deletedItemsHeading')}\n${itemList}\n`;
    if (data.items.length > 10) {
      message += `  ... ${t('common.andMore', { count: data.items.length - 10 })}\n`;
    }
  }

  return message;
}

/**
 * Generate plain text message for scan completion
 */
export function getScanCompleteText(data: ScanCompleteData, t: TFunction): string {
  return (
    `${t('scanComplete.header')}\n\n` +
    `${t('scanComplete.itemsScanned', { count: data.itemsScanned })}\n` +
    `${t('scanComplete.itemsFlagged', { count: data.itemsFlagged })}\n` +
    `${t('scanComplete.itemsProtected', { count: data.itemsProtected })}\n` +
    `${t('scanComplete.duration', { duration: formatDuration(data.durationMs) })}`
  );
}

/**
 * Generate plain text message for scan error
 */
export function getScanErrorText(data: ScanErrorData, t: TFunction): string {
  return (
    `${t('scanError.header')}\n\n` +
    `${t('scanError.errorLine', { phase: data.phase, error: data.error })}\n` +
    (data.itemsScannedBeforeError
      ? `${t('scanError.itemsBefore', { count: data.itemsScannedBeforeError })}\n`
      : '') +
    `${t('scanError.time', { date: new Date(data.timestamp).toLocaleString() })}`
  );
}

/**
 * Generate plain text message for deletion error
 */
export function getDeletionErrorText(data: DeletionErrorData, t: TFunction): string {
  return (
    `${t('deletionError.header')}\n\n` +
    `${t('deletionError.errorLine', { error: data.error })}\n` +
    (data.failedItemTitle ? `${t('deletionError.failedItem', { title: data.failedItemTitle })}\n` : '') +
    `${t('deletionError.itemsProcessed', { count: data.itemsProcessedBeforeError })}\n` +
    `${t('deletionError.time', { date: new Date(data.timestamp).toLocaleString() })}`
  );
}

/**
 * Generate plain text message for a disk-pressure event
 */
export function getDiskPressureText(data: DiskPressureData, t: TFunction): string {
  const action = data.observeOnly
    ? t('diskPressure.actionWouldQueue')
    : data.itemsQueued > 0
      ? t('diskPressure.actionQueued')
      : t('diskPressure.actionFlagged');
  const header = data.severity === 'critical' ? t('diskPressure.criticalPrefix') : '';
  const itemList = data.items
    .slice(0, 10)
    .map((item) => t('diskPressure.itemLine', { title: item.title, type: item.type, size: formatBytes(item.sizeBytes) }))
    .join('\n');

  let msg =
    `${header}${t('diskPressure.header', { path: data.path })}\n\n` +
    `${t('diskPressure.freeLine', {
      free: formatBytes(data.freeBytes),
      total: formatBytes(data.totalBytes),
      target: formatBytes(data.targetBytes),
      deficit: formatBytes(data.deficitBytes),
    })}\n`;

  if (data.items.length > 0) {
    const count = data.observeOnly ? data.items.length : data.itemsQueued;
    msg +=
      `\n${t('diskPressure.itemsActionLine', { count, action, reclaim: formatBytes(data.projectedReclaimBytes) })}\n` +
      `${itemList}\n` +
      (data.items.length > 10 ? `  ... ${t('common.andMore', { count: data.items.length - 10 })}\n` : '');
  } else {
    msg += `\n${t('diskPressure.noEligible')}\n`;
  }

  if (data.observeOnly) {
    msg += `\n${t('diskPressure.observeNote')}`;
  }
  return msg.trimEnd();
}

// ============================================================================
// Discord Templates
// ============================================================================

/**
 * Generate Discord message for items marked for deletion
 */
export function getItemsMarkedDiscord(data: ItemsMarkedData, t: TFunction): DiscordMessage {
  const embed: DiscordEmbed = {
    color: COLORS.WARNING,
    timestamp: new Date().toISOString(),
    footer: {
      text: t('common.brand'),
    },
  };

  if (data.groups && data.groups.length > 0) {
    const totalCount = data.count ?? data.groups.reduce((sum, g) => sum + g.items.length, 0);
    embed.title = t('itemsMarked.discord.queuedTitle', { count: totalCount });
    embed.description =
      data.groups.length === 1
        ? t('itemsMarked.discord.descOneRule', { count: totalCount, rule: data.groups[0]!.ruleName })
        : t('itemsMarked.discord.descManyRules', { count: totalCount, rules: data.groups.length });

    // Discord hard caps: 25 fields, 1024 chars per field value. Keep it readable.
    embed.fields = [];
    const MAX_GROUPS_SHOWN = 10;
    const shownGroups = data.groups.slice(0, MAX_GROUPS_SHOWN);
    for (const group of shownGroups) {
      const itemsShown = group.items.slice(0, 5);
      // Build footer first so we can reserve space for it and never truncate it mid-line
      const footer = t('itemsMarked.discord.groupFooter', {
        when: discordTimestamp(group.deleteAfter, 'R'),
        days: group.gracePeriodDays,
      });
      const overflowLine =
        group.items.length > itemsShown.length
          ? t('itemsMarked.discord.andMoreInline', { count: group.items.length - itemsShown.length })
          : '';
      const budget = 1024 - footer.length - overflowLine.length;
      let itemsBlock = itemsShown
        .map((i) => t('itemsMarked.discord.itemBullet', { title: i.title, type: i.type }))
        .join('\n');
      if (itemsBlock.length > budget) {
        itemsBlock = `${itemsBlock.slice(0, Math.max(0, budget - 1))}…`;
      }
      embed.fields.push({
        name: t('itemsMarked.discord.groupFieldName', { name: group.ruleName, count: group.items.length }),
        value: itemsBlock + overflowLine + footer,
        inline: false,
      });
    }
    if (data.groups.length > MAX_GROUPS_SHOWN) {
      embed.fields.push({
        name: t('itemsMarked.discord.moreRulesName'),
        value: t('itemsMarked.discord.moreRulesValue', { count: data.groups.length - MAX_GROUPS_SHOWN }),
        inline: false,
      });
    }
  } else if (data.item) {
    embed.title = t('itemsMarked.discord.singleTitle');
    embed.description = t('itemsMarked.discord.singleDesc', { title: data.item.title });
    embed.fields = [
      { name: t('itemsMarked.discord.fieldType'), value: data.item.type, inline: true },
      {
        name: t('itemsMarked.discord.fieldGracePeriod'),
        value: t('itemsMarked.discord.fieldGracePeriodValue', { days: data.gracePeriodDays ?? 7 }),
        inline: true,
      },
    ];
    if (data.deleteAfter) {
      embed.fields.push({ name: t('itemsMarked.discord.fieldDeleteAfter'), value: discordTimestamp(data.deleteAfter, 'R'), inline: false });
    }
    if (data.ruleName) {
      embed.fields.push({ name: t('itemsMarked.discord.fieldMatchedRule'), value: data.ruleName, inline: true });
    }
  } else if (data.items && data.items.length > 0) {
    const count = data.count || data.items.length;
    embed.title = t('itemsMarked.discord.multiTitle', { count });
    embed.description = t('itemsMarked.discord.multiDesc', { count });

    const itemList = data.items
      .slice(0, 5)
      .map((item) => t('itemsMarked.discord.itemBullet', { title: item.title, type: item.type }))
      .join('\n');

    embed.fields = [
      {
        name: t('itemsMarked.discord.fieldItems'),
        value: itemList + (data.items.length > 5 ? t('itemsMarked.discord.andMoreInline', { count: data.items.length - 5 }) : ''),
        inline: false,
      },
      {
        name: t('itemsMarked.discord.fieldGracePeriod'),
        value: t('itemsMarked.discord.fieldGracePeriodValue', { days: data.gracePeriodDays ?? 7 }),
        inline: true,
      },
    ];
    if (data.deleteAfter) {
      embed.fields.push({ name: t('itemsMarked.discord.fieldDeleteAfter'), value: discordTimestamp(data.deleteAfter, 'R'), inline: true });
    }
    if (data.ruleName) {
      embed.fields.push({ name: t('itemsMarked.discord.fieldMatchedRule'), value: data.ruleName, inline: true });
    }
  } else {
    embed.title = t('itemsMarked.discord.emptyTitle');
  }

  return {
    embeds: [embed],
    username: t('common.brand'),
    avatar_url: AVATAR_URL,
  };
}

/**
 * Generate Discord message for imminent deletions
 */
export function getDeletionImminentDiscord(data: DeletionImminentData, t: TFunction): DiscordMessage {
  const isUrgent = data.urgency === 'high';
  const timeframe = isUrgent
    ? t('deletionImminent.timeframeHigh')
    : t('deletionImminent.timeframeNormal');
  const embed: DiscordEmbed = {
    title: isUrgent
      ? t('deletionImminent.discord.titleUrgent', { count: data.count })
      : t('deletionImminent.discord.titleNormal', { count: data.count }),
    color: isUrgent ? COLORS.ERROR : COLORS.WARNING,
    description: t('deletionImminent.discord.desc', { count: data.count, timeframe }),
    timestamp: new Date().toISOString(),
    footer: {
      text: t('common.brand'),
    },
  };

  const itemList = data.items
    .slice(0, 10)
    .map((item) => t('deletionImminent.discord.itemBullet', { title: item.title, count: item.daysRemaining }))
    .join('\n');

  embed.fields = [
    {
      name: t('deletionImminent.discord.fieldItems'),
      value: itemList + (data.items.length > 10 ? t('deletionImminent.discord.andMoreInline', { count: data.items.length - 10 }) : ''),
      inline: false,
    },
  ];

  return {
    content: isUrgent ? '@here' : undefined,
    embeds: [embed],
    username: t('common.brand'),
    avatar_url: AVATAR_URL,
  };
}

/**
 * Generate Discord message for completed deletions
 */
export function getDeletionCompleteDiscord(data: DeletionCompleteData, t: TFunction): DiscordMessage {
  const embed: DiscordEmbed = {
    title: t('deletionComplete.discord.title', { gb: data.spaceFreedGB }),
    color: COLORS.SUCCESS,
    description: t('deletionComplete.discord.desc', { count: data.itemsDeleted }),
    timestamp: new Date().toISOString(),
    footer: {
      text: t('common.brand'),
    },
    fields: [
      { name: t('deletionComplete.discord.fieldSpaceFreed'), value: t('deletionComplete.discord.fieldSpaceFreedValue', { gb: data.spaceFreedGB }), inline: true },
      { name: t('deletionComplete.discord.fieldItemsDeleted'), value: data.itemsDeleted.toString(), inline: true },
    ],
  };

  if (data.errors > 0) {
    embed.fields!.push({ name: t('deletionComplete.discord.fieldErrors'), value: data.errors.toString(), inline: true });
    embed.color = COLORS.WARNING;
  }

  if (data.items && data.items.length > 0) {
    const MAX_SHOWN = 10;
    const itemList = data.items
      .slice(0, MAX_SHOWN)
      .map((item) =>
        item.ruleName
          ? t('deletionComplete.discord.itemBulletWithRule', { title: item.title, rule: item.ruleName })
          : t('deletionComplete.discord.itemBullet', { title: item.title })
      )
      .join('\n');
    let value = itemList;
    if (data.items.length > MAX_SHOWN) {
      value += t('deletionComplete.discord.andMoreInline', { count: data.items.length - MAX_SHOWN });
    }
    embed.fields!.push({
      name: t('deletionComplete.discord.fieldDeletedItems'),
      value: value.length > 1024 ? `${value.slice(0, 1020)}…` : value,
      inline: false,
    });
  }

  return {
    embeds: [embed],
    username: t('common.brand'),
    avatar_url: AVATAR_URL,
  };
}

/**
 * Generate Discord message for scan completion
 */
export function getScanCompleteDiscord(data: ScanCompleteData, t: TFunction): DiscordMessage {
  const duration = formatDuration(data.durationMs);
  const hasFlagged = data.itemsFlagged > 0;

  const embed: DiscordEmbed = {
    title: hasFlagged
      ? t('scanComplete.discord.titleFlagged', { count: data.itemsFlagged })
      : t('scanComplete.discord.titleClean'),
    color: hasFlagged ? COLORS.INFO : COLORS.SUCCESS,
    description: hasFlagged
      ? t('scanComplete.discord.descFlagged', { scanned: data.itemsScanned, duration, count: data.itemsFlagged })
      : t('scanComplete.discord.descClean', { scanned: data.itemsScanned, duration }),
    timestamp: new Date().toISOString(),
    footer: {
      text: t('common.brand'),
    },
    fields: [
      { name: t('scanComplete.discord.fieldItemsScanned'), value: data.itemsScanned.toString(), inline: true },
      { name: t('scanComplete.discord.fieldItemsFlagged'), value: data.itemsFlagged.toString(), inline: true },
      { name: t('scanComplete.discord.fieldItemsProtected'), value: data.itemsProtected.toString(), inline: true },
    ],
  };

  return {
    embeds: [embed],
    username: t('common.brand'),
    avatar_url: AVATAR_URL,
  };
}

/**
 * Generate Discord message for scan error
 */
export function getScanErrorDiscord(data: ScanErrorData, t: TFunction): DiscordMessage {
  const embed: DiscordEmbed = {
    title: t('scanError.discord.title'),
    color: COLORS.ERROR,
    description: t('scanError.discord.desc', { phase: data.phase }),
    timestamp: data.timestamp,
    footer: { text: t('common.brand') },
    fields: [
      { name: t('scanError.discord.fieldError'), value: data.error.substring(0, 1024), inline: false },
      { name: t('scanError.discord.fieldTime'), value: discordTimestamp(data.timestamp, 'R'), inline: true },
    ],
  };

  if (data.itemsScannedBeforeError) {
    embed.fields!.push({
      name: t('scanError.discord.fieldItemsBefore'),
      value: String(data.itemsScannedBeforeError),
      inline: true,
    });
  }

  return { embeds: [embed], username: t('common.brand'), avatar_url: AVATAR_URL };
}

/**
 * Generate Discord message for deletion error
 */
export function getDeletionErrorDiscord(data: DeletionErrorData, t: TFunction): DiscordMessage {
  const embed: DiscordEmbed = {
    title: t('deletionError.discord.title'),
    color: COLORS.ERROR,
    description: t('deletionError.discord.desc'),
    timestamp: data.timestamp,
    footer: { text: t('common.brand') },
    fields: [
      { name: t('deletionError.discord.fieldError'), value: data.error.substring(0, 1024), inline: false },
      { name: t('deletionError.discord.fieldItemsProcessed'), value: String(data.itemsProcessedBeforeError), inline: true },
      { name: t('deletionError.discord.fieldTime'), value: discordTimestamp(data.timestamp, 'R'), inline: true },
    ],
  };

  if (data.failedItemTitle) {
    embed.fields!.push({
      name: t('deletionError.discord.fieldFailedItem'),
      value: data.failedItemTitle,
      inline: true,
    });
  }

  return { embeds: [embed], username: t('common.brand'), avatar_url: AVATAR_URL };
}

/**
 * Generate Discord message for a disk-pressure event
 */
export function getDiskPressureDiscord(data: DiskPressureData, t: TFunction): DiscordMessage {
  const isCritical = data.severity === 'critical';
  const verb = data.observeOnly
    ? t('diskPressure.discord.verbWouldReclaim')
    : data.itemsQueued > 0
      ? t('diskPressure.discord.verbQueued')
      : t('diskPressure.discord.verbFlagged');
  const threshold = isCritical
    ? t('diskPressure.discord.thresholdCritical')
    : t('diskPressure.discord.thresholdNormal');

  const embed: DiscordEmbed = {
    title: isCritical
      ? t('diskPressure.discord.titleCritical', { free: formatBytes(data.freeBytes) })
      : t('diskPressure.discord.titleNormal', { free: formatBytes(data.freeBytes) }),
    color: isCritical ? COLORS.ERROR : COLORS.WARNING,
    description: t('diskPressure.discord.desc', {
      path: data.path,
      threshold,
      target: formatBytes(data.targetBytes),
      deficit: formatBytes(data.deficitBytes),
    }),
    timestamp: data.timestamp,
    footer: { text: t('common.brand') },
    fields: [
      { name: t('diskPressure.discord.fieldFree'), value: formatBytes(data.freeBytes), inline: true },
      { name: t('diskPressure.discord.fieldTotal'), value: formatBytes(data.totalBytes), inline: true },
      {
        name: data.observeOnly ? t('diskPressure.discord.fieldWouldReclaim') : t('diskPressure.discord.fieldProjectedReclaim'),
        value: t('diskPressure.discord.reclaimValue', { reclaim: formatBytes(data.projectedReclaimBytes) }),
        inline: true,
      },
    ],
  };

  if (data.items.length > 0) {
    const shown = data.items.slice(0, 10);
    let value = shown.map((i) => t('diskPressure.discord.itemBullet', { title: i.title, size: formatBytes(i.sizeBytes) })).join('\n');
    if (data.items.length > shown.length) {
      value += t('diskPressure.discord.andMoreInline', { count: data.items.length - shown.length });
    }
    embed.fields!.push({
      name: t('diskPressure.discord.itemFieldName', { count: data.observeOnly ? data.items.length : data.itemsQueued, verb }),
      value: value.length > 1024 ? `${value.slice(0, 1020)}…` : value,
      inline: false,
    });
  } else {
    embed.fields!.push({ name: t('diskPressure.discord.fieldItems'), value: t('diskPressure.noEligible'), inline: false });
  }

  if (data.observeOnly) {
    embed.fields!.push({
      name: t('diskPressure.discord.observeName'),
      value: t('diskPressure.discord.observeValue'),
      inline: false,
    });
  }

  return {
    content: isCritical && !data.observeOnly ? '@here' : undefined,
    embeds: [embed],
    username: t('common.brand'),
    avatar_url: AVATAR_URL,
  };
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
  | 'DELETION_ERROR'
  | 'DISK_PRESSURE_TRIGGERED';

/**
 * Get plain text message for any notification event.
 * `lng` selects the catalog language; omitted/unknown falls back to English.
 */
export function getPlainTextMessage(event: NotificationEvent, data: NotificationData, lng?: string): string {
  const t = getFixedT(lng);
  switch (event) {
    case 'ITEMS_MARKED':
      return getItemsMarkedText(data as unknown as ItemsMarkedData, t);
    case 'DELETION_IMMINENT':
      return getDeletionImminentText(data as unknown as DeletionImminentData, t);
    case 'DELETION_COMPLETE':
      return getDeletionCompleteText(data as unknown as DeletionCompleteData, t);
    case 'SCAN_COMPLETE':
      return getScanCompleteText(data as unknown as ScanCompleteData, t);
    case 'SCAN_ERROR':
      return getScanErrorText(data as unknown as ScanErrorData, t);
    case 'DELETION_ERROR':
      return getDeletionErrorText(data as unknown as DeletionErrorData, t);
    case 'DISK_PRESSURE_TRIGGERED':
      return getDiskPressureText(data as unknown as DiskPressureData, t);
    default:
      return t('fallback', { event });
  }
}

/**
 * Get Discord message for any notification event.
 * `lng` selects the catalog language; omitted/unknown falls back to English.
 */
export function getDiscordMessage(event: NotificationEvent, data: NotificationData, lng?: string): DiscordMessage {
  const t = getFixedT(lng);
  switch (event) {
    case 'ITEMS_MARKED':
      return getItemsMarkedDiscord(data as unknown as ItemsMarkedData, t);
    case 'DELETION_IMMINENT':
      return getDeletionImminentDiscord(data as unknown as DeletionImminentData, t);
    case 'DELETION_COMPLETE':
      return getDeletionCompleteDiscord(data as unknown as DeletionCompleteData, t);
    case 'SCAN_COMPLETE':
      return getScanCompleteDiscord(data as unknown as ScanCompleteData, t);
    case 'SCAN_ERROR':
      return getScanErrorDiscord(data as unknown as ScanErrorData, t);
    case 'DELETION_ERROR':
      return getDeletionErrorDiscord(data as unknown as DeletionErrorData, t);
    case 'DISK_PRESSURE_TRIGGERED':
      return getDiskPressureDiscord(data as unknown as DiskPressureData, t);
    default:
      return { content: t('fallbackDiscord', { event }), username: t('common.brand'), avatar_url: AVATAR_URL };
  }
}
