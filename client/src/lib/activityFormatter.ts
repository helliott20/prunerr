import type { ActivityLogEntry, DeletionAction } from '@/types';
import { formatBytes, formatDuration } from '@/lib/utils';
import { DELETION_ACTIONS, deletionActionLabel } from '@/lib/deletionActions';
import i18n from '@/i18n';

export type ActivityChipVariant = 'default' | 'accent' | 'violet' | 'warning' | 'success' | 'danger';

export interface ActivityChip {
  label: string;
  variant: ActivityChipVariant;
}

export interface FormattedActivity {
  /** Short headline for the event, e.g. "Queued for deletion". */
  title: string;
  /** Secondary line with context, e.g. "Matched rule: Stale shows". */
  description?: string;
  /** Inline chips for at-a-glance metadata (size, grace period, etc.). */
  chips: ActivityChip[];
}

const humanize = (slug: string): string =>
  slug
    .split('_')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');

const readNumber = (meta: Record<string, unknown> | null | undefined, key: string): number | undefined => {
  const v = meta?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

const readString = (meta: Record<string, unknown> | null | undefined, key: string): string | undefined => {
  const v = meta?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

const readBool = (meta: Record<string, unknown> | null | undefined, key: string): boolean | undefined => {
  const v = meta?.[key];
  return typeof v === 'boolean' ? v : undefined;
};

const ruleDescription = (entry: ActivityLogEntry): string | undefined => {
  if (entry.actorType === 'rule' && entry.actorName) {
    return i18n.t('activityLog:formatter.matchedRule', 'Matched rule: {{rule}}', { rule: entry.actorName });
  }
  return undefined;
};

const graceChip = (meta: Record<string, unknown> | null): ActivityChip | undefined => {
  const days = readNumber(meta, 'gracePeriodDays');
  if (days === undefined) return undefined;
  return { label: i18n.t('activityLog:chips.grace', '{{days}}d grace', { days }), variant: 'warning' };
};

const deletionActionChip = (meta: Record<string, unknown> | null): ActivityChip | undefined => {
  const a = readString(meta, 'deletionAction') as DeletionAction | undefined;
  if (!a || !DELETION_ACTIONS.includes(a)) return undefined;
  return { label: deletionActionLabel(a), variant: 'default' };
};

const sizeChip = (meta: Record<string, unknown> | null): ActivityChip | undefined => {
  const bytes = readNumber(meta, 'fileSize');
  if (bytes === undefined || bytes <= 0) return undefined;
  return { label: formatBytes(bytes), variant: 'default' };
};

export function formatActivity(entry: ActivityLogEntry): FormattedActivity {
  const meta = entry.metadata ?? null;

  switch (entry.eventType) {
    case 'scan': {
      if (entry.action === 'started') {
        return { title: i18n.t('activityLog:formatter.scanStarted', 'Library scan started'), chips: [] };
      }
      if (entry.action === 'completed') {
        const scanned = readNumber(meta, 'itemsScanned');
        const flagged = readNumber(meta, 'itemsFlagged');
        const duration = readNumber(meta, 'duration');
        const chips: ActivityChip[] = [];
        if (scanned !== undefined) chips.push({ label: i18n.t('activityLog:chips.scanned', '{{count}} scanned', { count: scanned }), variant: 'accent' });
        if (flagged !== undefined && flagged > 0) chips.push({ label: i18n.t('activityLog:chips.flagged', '{{count}} flagged', { count: flagged }), variant: 'warning' });
        if (duration !== undefined && duration > 0) chips.push({ label: formatDuration(duration), variant: 'default' });
        return { title: i18n.t('activityLog:formatter.scanCompleted', 'Library scan completed'), chips };
      }
      if (entry.action === 'failed') {
        const err = readString(meta, 'error');
        return {
          title: i18n.t('activityLog:formatter.scanFailed', 'Library scan failed'),
          description: err,
          chips: [],
        };
      }
      return { title: humanize(entry.action), chips: [] };
    }

    case 'rule_match': {
      if (entry.action === 'item_queued') {
        const chips: ActivityChip[] = [];
        const grace = graceChip(meta);
        if (grace) chips.push(grace);
        const action = deletionActionChip(meta);
        if (action) chips.push(action);
        if (readBool(meta, 'resetOverseerr')) {
          chips.push({ label: i18n.t('activityLog:chips.resetOverseerr', 'Reset Overseerr'), variant: 'violet' });
        }
        return {
          title: i18n.t('activityLog:formatter.queuedForDeletion', 'Queued for deletion'),
          description: ruleDescription(entry),
          chips,
        };
      }
      if (entry.action === 'item_flagged') {
        return {
          title: i18n.t('activityLog:formatter.flaggedForReview', 'Flagged for review'),
          description: ruleDescription(entry),
          chips: [],
        };
      }
      return {
        title: humanize(entry.action),
        description: ruleDescription(entry),
        chips: [],
      };
    }

    case 'deletion': {
      if (entry.action === 'deleted') {
        const chips: ActivityChip[] = [];
        const size = sizeChip(meta);
        if (size) chips.push({ ...size, variant: 'danger' });
        const action = deletionActionChip(meta);
        if (action) chips.push(action);
        return {
          title: i18n.t('activityLog:formatter.deleted', 'Deleted'),
          description: ruleDescription(entry),
          chips,
        };
      }
      if (entry.action === 'unmonitored') {
        const chips: ActivityChip[] = [];
        const size = sizeChip(meta);
        if (size) chips.push(size);
        return {
          title: i18n.t('activityLog:formatter.unmonitored', 'Unmonitored'),
          description: ruleDescription(entry),
          chips,
        };
      }
      return {
        title: humanize(entry.action),
        description: ruleDescription(entry),
        chips: [],
      };
    }

    case 'protection': {
      if (entry.action === 'protected' || entry.action === 'collection_protected') {
        const reason = readString(meta, 'protectionReason') ?? readString(meta, 'reason');
        return {
          title: entry.action === 'collection_protected'
            ? i18n.t('activityLog:formatter.collectionProtected', 'Collection protected')
            : i18n.t('activityLog:formatter.protected', 'Protected'),
          description: reason ? i18n.t('activityLog:formatter.reason', 'Reason: {{reason}}', { reason }) : undefined,
          chips: [],
        };
      }
      if (entry.action === 'unprotected' || entry.action === 'collection_unprotected') {
        return {
          title: entry.action === 'collection_unprotected'
            ? i18n.t('activityLog:formatter.collectionUnprotected', 'Collection unprotected')
            : i18n.t('activityLog:formatter.protectionRemoved', 'Protection removed'),
          chips: [],
        };
      }
      return { title: humanize(entry.action), chips: [] };
    }

    case 'manual_action': {
      let title: string;
      if (entry.action === 'item_queued') {
        title = i18n.t('activityLog:formatter.queuedForDeletion', 'Queued for deletion');
      } else if (entry.action === 'queue_removed') {
        title = i18n.t('activityLog:formatter.removedFromQueue', 'Removed from queue');
      } else {
        title = humanize(entry.action);
      }
      return {
        title,
        description: entry.actorName ? i18n.t('activityLog:formatter.byActor', 'By {{actor}}', { actor: entry.actorName }) : undefined,
        chips: [],
      };
    }

    case 'error': {
      const err = readString(meta, 'error') ?? readString(meta, 'message');
      return {
        title: humanize(entry.action) || i18n.t('activityLog:formatter.error', 'Error'),
        description: err,
        chips: [],
      };
    }

    default:
      return { title: humanize(entry.action), chips: [] };
  }
}

/**
 * Normalize raw API activity entries (metadata may arrive as a JSON string
 * from older server versions) into the client-typed shape with parsed metadata.
 */
export function normalizeActivityEntry(raw: ActivityLogEntry | (Omit<ActivityLogEntry, 'metadata'> & { metadata: string | Record<string, unknown> | null })): ActivityLogEntry {
  let metadata: Record<string, unknown> | null = null;
  const rawMeta = raw.metadata;
  if (rawMeta && typeof rawMeta === 'string') {
    try {
      metadata = JSON.parse(rawMeta) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  } else if (rawMeta && typeof rawMeta === 'object') {
    metadata = rawMeta as Record<string, unknown>;
  }
  return { ...(raw as ActivityLogEntry), metadata };
}
