import {
  PlayCircle,
  Trash2,
  Zap,
  Shield,
  User,
  AlertCircle,
  Clock,
  Plus,
  Search,
} from 'lucide-react';
import { cn, formatRelativeTime, formatDate } from '@/lib/utils';
import { Badge } from '@/components/common/Badge';
import type { ActivityLogEntry } from '@/types';

// Event type visual configuration
const EVENT_CONFIG: Record<
  string,
  { icon: typeof PlayCircle; colorClass: string; bgClass: string; label: string }
> = {
  scan: {
    icon: PlayCircle,
    colorClass: 'text-accent-400',
    bgClass: 'bg-accent-500/15 border-accent-500/20',
    label: 'Scan',
  },
  deletion: {
    icon: Trash2,
    colorClass: 'text-ruby-400',
    bgClass: 'bg-ruby-500/15 border-ruby-500/20',
    label: 'Deletion',
  },
  rule_match: {
    icon: Zap,
    colorClass: 'text-violet-400',
    bgClass: 'bg-violet-500/15 border-violet-500/20',
    label: 'Rule Match',
  },
  protection: {
    icon: Shield,
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/15 border-emerald-500/20',
    label: 'Protection',
  },
  manual_action: {
    icon: User,
    colorClass: 'text-amber-400',
    bgClass: 'bg-amber-500/15 border-amber-500/20',
    label: 'Manual',
  },
  error: {
    icon: AlertCircle,
    colorClass: 'text-ruby-400',
    bgClass: 'bg-ruby-500/15 border-ruby-500/20',
    label: 'Error',
  },
};

const ACTOR_CONFIG: Record<string, { variant: 'accent' | 'violet' | 'warning'; label: string }> = {
  scheduler: { variant: 'accent', label: 'Scheduler' },
  user: { variant: 'violet', label: 'User' },
  rule: { variant: 'warning', label: 'Rule' },
};

/** Human-readable labels for raw action strings. */
const ACTION_LABELS: Record<string, string> = {
  protected: 'Item protected',
  unprotected: 'Item unprotected',
  collection_protected: 'Collection protected',
  collection_unprotected: 'Collection unprotected',
  item_queued: 'Queued for deletion',
  item_deleted: 'Deleted',
  item_restored: 'Restored',
  rule_matched: 'Matched by rule',
  scanned: 'Library scan',
};

function formatAction(entry: ActivityLogEntry): string {
  const label = ACTION_LABELS[entry.action];
  if (label) {
    // Append collection/target name from metadata or targetTitle for context
    if (entry.action.startsWith('collection_') && entry.targetTitle) {
      return `${label}: ${entry.targetTitle}`;
    }
    return label;
  }
  // Fallback: replace underscores and capitalise
  return entry.action.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

interface ActivityTimelineProps {
  entries: ActivityLogEntry[];
  isLoading?: boolean;
  addedAt?: string;
  firstScannedAt?: string;
}

export function ActivityTimeline({ entries, isLoading, addedAt, firstScannedAt }: ActivityTimelineProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex gap-4 animate-pulse">
            <div className="w-10 h-10 rounded-xl bg-surface-800/80 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-surface-800/80 rounded w-3/4" />
              <div className="h-3 bg-surface-800/50 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Build synthetic entries for item lifecycle events
  const syntheticEntries: ActivityLogEntry[] = [];

  if (firstScannedAt) {
    syntheticEntries.push({
      id: -2,
      eventType: 'scan',
      action: 'First scanned by Prunerr',
      actorType: 'scheduler',
      actorId: null,
      actorName: null,
      targetType: null,
      targetId: null,
      targetTitle: null,
      metadata: null,
      createdAt: firstScannedAt,
    });
  }

  if (addedAt) {
    syntheticEntries.push({
      id: -1,
      eventType: 'scan' as const,
      action: 'Added to Plex',
      actorType: 'scheduler' as const,
      actorId: null,
      actorName: null,
      targetType: null,
      targetId: null,
      targetTitle: null,
      metadata: null,
      createdAt: addedAt,
    });
  }

  const allEntries = [...entries, ...syntheticEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const hasEntries = allEntries.length > 0;

  // Icon overrides for synthetic entries
  const SYNTHETIC_ICONS: Record<string, typeof Plus> = {
    'Added to Plex': Plus,
    'First scanned by Prunerr': Search,
  };

  if (!hasEntries) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="p-4 rounded-2xl bg-surface-800/50 mb-4">
          <Clock className="w-8 h-8 text-surface-500" />
        </div>
        <p className="text-surface-400 text-sm font-medium">No activity recorded for this item yet</p>
        <p className="text-surface-500 text-xs mt-1">Actions like queuing, protecting, and rule matches will appear here.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="absolute left-5 top-5 bottom-5 w-px bg-surface-700/50" />

      <div className="space-y-1">
        {allEntries.map((entry, index) => {
          const config = EVENT_CONFIG[entry.eventType] || {
            icon: AlertCircle,
            colorClass: 'text-surface-400',
            bgClass: 'bg-surface-800/50 border-surface-700/30',
            label: entry.eventType,
          };
          const actorConfig = ACTOR_CONFIG[entry.actorType] || {
            variant: 'default' as const,
            label: entry.actorType,
          };
          const EventIcon = SYNTHETIC_ICONS[entry.action] || config.icon;
          const isFirst = index === 0;
          const isLast = index === allEntries.length - 1;

          return (
            <div
              key={entry.id}
              className={cn(
                'relative flex gap-4 pl-0 py-3 group',
                isFirst && 'pt-0',
                isLast && 'pb-0'
              )}
            >
              {/* Icon node */}
              <div
                className={cn(
                  'relative z-10 flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center transition-all',
                  config.bgClass
                )}
              >
                <EventIcon className={cn('w-4 h-4', config.colorClass)} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-surface-200 leading-snug">
                      {formatAction(entry)}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant={actorConfig.variant} size="sm">
                        {actorConfig.label}
                      </Badge>
                      {entry.actorName && (
                        <span className="text-xs text-surface-500">{entry.actorName}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-surface-400">{formatRelativeTime(entry.createdAt)}</p>
                    <p className="text-2xs text-surface-600 mt-0.5">{formatDate(entry.createdAt)}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
