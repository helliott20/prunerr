import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Activity,
  PlayCircle,
  Trash2,
  ListFilter,
  Shield,
  User,
  AlertCircle,
  Clock,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
import { useActivityLog } from '@/hooks/useApi';
import { formatDate, formatRelativeTime, cn } from '@/lib/utils';
import { formatActivity } from '@/lib/activityFormatter';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import type { ActivityLogEntry, ActivityFilters } from '@/types';

// Event type configuration (icon/color are static styling; labels resolved via i18n)
const EVENT_CONFIG: Record<string, { icon: typeof Activity; colorClass: string; labelKey: string; labelDefault: string }> = {
  scan: { icon: PlayCircle, colorClass: 'text-accent-text', labelKey: 'eventTypes.scan', labelDefault: 'Scan' },
  deletion: { icon: Trash2, colorClass: 'text-ruby-400', labelKey: 'eventTypes.deletion', labelDefault: 'Deletion' },
  rule_match: { icon: ListFilter, colorClass: 'text-amber-400', labelKey: 'eventTypes.ruleMatch', labelDefault: 'Rule Match' },
  protection: { icon: Shield, colorClass: 'text-emerald-400', labelKey: 'eventTypes.protection', labelDefault: 'Protection' },
  manual_action: { icon: User, colorClass: 'text-violet-400', labelKey: 'eventTypes.manual', labelDefault: 'Manual' },
  error: { icon: AlertCircle, colorClass: 'text-ruby-400', labelKey: 'eventTypes.error', labelDefault: 'Error' },
};

// Actor type badge configuration (variant is static styling; labels resolved via i18n)
const ACTOR_CONFIG: Record<string, { variant: 'accent' | 'violet' | 'warning'; labelKey: string; labelDefault: string }> = {
  scheduler: { variant: 'accent', labelKey: 'actorTypes.scheduler', labelDefault: 'Scheduler' },
  user: { variant: 'violet', labelKey: 'actorTypes.user', labelDefault: 'User' },
  rule: { variant: 'warning', labelKey: 'actorTypes.rule', labelDefault: 'Rule' },
};

const EVENT_TYPES = ['scan', 'deletion', 'rule_match', 'protection', 'manual_action', 'error'];
const ACTOR_TYPES = ['scheduler', 'user', 'rule'];

export default function ActivityLog() {
  const { t } = useTranslation('activityLog');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState<ActivityFilters['dateRange']>('7d');
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>(['deletion', 'rule_match', 'protection', 'manual_action', 'error']);
  const [selectedActorTypes, setSelectedActorTypes] = useState<string[]>([]);

  const filters: ActivityFilters = {
    search,
    page,
    limit: 20,
    dateRange,
    eventTypes: selectedEventTypes.length > 0 ? selectedEventTypes : undefined,
    actorTypes: selectedActorTypes.length > 0 ? selectedActorTypes : undefined,
  };

  const { data, isLoading, isError, error, refetch } = useActivityLog(filters);

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  const hasFilters = search || dateRange !== 'all' || selectedEventTypes.length > 0 || selectedActorTypes.length > 0;

  const toggleEventType = (type: string) => {
    setSelectedEventTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
    setPage(1);
  };

  const toggleActorType = (type: string) => {
    setSelectedActorTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
    setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setDateRange('all');
    setSelectedEventTypes([]);
    setSelectedActorTypes([]);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-50">{t('header.title', 'Activity Log')}</h1>
        <p className="text-surface-400 mt-1">{t('header.subtitle', 'System events and actions')}</p>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="space-y-4">
          {/* Scan filter notice */}
          {selectedEventTypes.length > 0 && !selectedEventTypes.includes('scan') && (
            <div className="flex items-center gap-2 text-xs text-surface-400 bg-surface-800/50 rounded-lg px-3 py-2">
              <PlayCircle className="w-3.5 h-3.5 text-surface-500 flex-shrink-0" />
              <span>{t('filters.scanHiddenNotice', 'Scan events are hidden by default.')}</span>
              <button
                onClick={() => setSelectedEventTypes([])}
                className="text-accent-text hover:text-accent-300 font-medium ml-1"
              >
                {t('filters.showAllEvents', 'Show all events')}
              </button>
            </div>
          )}
          {/* Search and Date Range */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder={t('filters.searchPlaceholder', 'Search by target name...')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                icon={<Search className="w-4 h-4" />}
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-surface-400" />
              <select
                value={dateRange}
                onChange={(e) => {
                  setDateRange(e.target.value as ActivityFilters['dateRange']);
                  setPage(1);
                }}
                className="input py-2"
              >
                <option value="24h">{t('filters.dateRange.24h', 'Last 24 hours')}</option>
                <option value="7d">{t('filters.dateRange.7d', 'Last 7 days')}</option>
                <option value="30d">{t('filters.dateRange.30d', 'Last 30 days')}</option>
                <option value="all">{t('filters.dateRange.all', 'All time')}</option>
              </select>
            </div>
          </div>

          {/* Event Type Filters */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-sm text-surface-400 mr-2 flex-shrink-0">{t('filters.eventLabel', 'Event:')}</span>
            {EVENT_TYPES.map((type) => {
              const config = EVENT_CONFIG[type];
              const isSelected = selectedEventTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleEventType(type)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0 whitespace-nowrap',
                    'border flex items-center gap-1.5',
                    isSelected
                      ? 'bg-surface-700 border-surface-600 text-surface-50'
                      : 'bg-surface-800/50 border-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                  )}
                >
                  <config.icon className={cn('w-3 h-3', isSelected && config.colorClass)} />
                  {t(config.labelKey, config.labelDefault)}
                </button>
              );
            })}
          </div>

          {/* Actor Type Filters */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-sm text-surface-400 mr-2 flex-shrink-0">{t('filters.actorLabel', 'Actor:')}</span>
            {ACTOR_TYPES.map((type) => {
              const config = ACTOR_CONFIG[type];
              const isSelected = selectedActorTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleActorType(type)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0 whitespace-nowrap',
                    'border flex items-center gap-1.5',
                    isSelected
                      ? 'bg-surface-700 border-surface-600 text-surface-50'
                      : 'bg-surface-800/50 border-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                  )}
                >
                  {t(config.labelKey, config.labelDefault)}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Activity List */}
      {isLoading ? (
        <Card>
          <div className="divide-y divide-surface-800">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse bg-surface-800/50" />
            ))}
          </div>
        </Card>
      ) : isError ? (
        <ErrorState
          error={error as Error}
          title={t('errors.loadFailed', 'Failed to load activity log')}
          retry={refetch}
        />
      ) : data && data.items.length > 0 ? (
        <Card>
          {/* Mobile card layout */}
          <div className="sm:hidden divide-y divide-surface-800/50">
            {data.items.map((item) => (
              <ActivityCard key={item.id} item={item} />
            ))}
          </div>
          {/* Desktop table layout */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    {t('table.event', 'Event')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    {t('table.actor', 'Actor')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    {t('table.target', 'Target')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    {t('table.time', 'Time')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : hasFilters ? (
        <Card className="p-12">
          <EmptyState
            icon={Search}
            variant="filtered"
            title={t('empty.filteredTitle', 'No matching activity')}
            description={t('empty.filteredDesc', 'No activities match your current filters. Try adjusting your search terms or filter options.')}
            action={{
              label: t('empty.clearFilters', 'Clear Filters'),
              onClick: clearFilters,
            }}
          />
        </Card>
      ) : (
        <Card className="p-12">
          <EmptyState
            icon={Activity}
            title={t('empty.title', 'No activity yet')}
            description={t('empty.desc', 'System activity will appear here as scans run, rules match, and deletions occur.')}
          />
        </Card>
      )}

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:justify-between">
          <p className="text-sm text-surface-400">
            {t('pagination.showing', 'Showing {{from}} to {{to}} of {{total}} activities', {
              from: (page - 1) * 20 + 1,
              to: Math.min(page * 20, data.total),
              total: data.total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-surface-300">
              {t('pagination.pageOf', 'Page {{page}} of {{total}}', { page, total: totalPages })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityCard({ item }: { item: ActivityLogEntry }) {
  const { t } = useTranslation('activityLog');
  const eventConfig = EVENT_CONFIG[item.eventType];
  const actorConfig = ACTOR_CONFIG[item.actorType];

  const actorLabel = actorConfig ? t(actorConfig.labelKey, actorConfig.labelDefault) : item.actorType;
  const actorVariant = actorConfig?.variant ?? 'default';

  const EventIcon = eventConfig?.icon ?? Activity;
  const eventColorClass = eventConfig?.colorClass ?? 'text-surface-400';
  const formatted = formatActivity(item);

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-start gap-3">
        <div className={cn('p-2 rounded-lg bg-surface-800/50 flex-shrink-0')}>
          <EventIcon className={cn('w-4 h-4', eventColorClass)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-surface-50 text-sm">{formatted.title}</p>
          {item.targetTitle && (
            <p className="text-sm text-surface-300 mt-0.5 truncate">
              {item.targetId ? (
                <Link
                  to={item.targetType === 'collection' ? `/collections/${item.targetId}` : `/library/${item.targetId}`}
                  className="hover:text-accent-text-hover transition-colors"
                >
                  {item.targetTitle}
                </Link>
              ) : (
                item.targetTitle
              )}
            </p>
          )}
          {formatted.description && (
            <p className="text-xs text-surface-400 mt-0.5">{formatted.description}</p>
          )}
          {formatted.chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {formatted.chips.map((chip) => (
                <Badge key={`${chip.variant}:${chip.label}`} variant={chip.variant} size="sm">
                  {chip.label}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant={actorVariant} size="sm">
              {actorLabel}
              {item.actorName && item.actorType !== 'user' ? ` · ${item.actorName}` : ''}
            </Badge>
            <span className="text-xs text-surface-500">{formatRelativeTime(item.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityLogEntry }) {
  const { t } = useTranslation('activityLog');
  const eventConfig = EVENT_CONFIG[item.eventType];
  const actorConfig = ACTOR_CONFIG[item.actorType];

  const actorLabel = actorConfig ? t(actorConfig.labelKey, actorConfig.labelDefault) : item.actorType;
  const actorVariant = actorConfig?.variant ?? 'default';

  const EventIcon = eventConfig?.icon ?? Activity;
  const eventColorClass = eventConfig?.colorClass ?? 'text-surface-400';
  const formatted = formatActivity(item);

  return (
    <tr className="border-b border-surface-800 hover:bg-surface-800/30 transition-colors align-top">
      {/* Event */}
      <td className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded-lg bg-surface-800/50 flex-shrink-0')}>
            <EventIcon className={cn('w-4 h-4', eventColorClass)} />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-surface-50 text-sm">{formatted.title}</p>
            {formatted.description && (
              <p className="text-xs text-surface-400 mt-0.5">{formatted.description}</p>
            )}
            {formatted.chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {formatted.chips.map((chip) => (
                  <Badge key={`${chip.variant}:${chip.label}`} variant={chip.variant} size="sm">
                    {chip.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Actor */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge variant={actorVariant} size="sm">
            {actorLabel}
          </Badge>
          {item.actorName && (
            <span className="text-sm text-surface-400 truncate max-w-[160px]" title={item.actorName}>
              {item.actorName}
            </span>
          )}
        </div>
      </td>

      {/* Target */}
      <td className="px-4 py-3 text-sm text-surface-300">
        {item.targetTitle && item.targetId ? (
          <Link
            to={item.targetType === 'collection' ? `/collections/${item.targetId}` : `/library/${item.targetId}`}
            className="hover:text-accent-text-hover transition-colors"
          >
            {item.targetTitle}
          </Link>
        ) : (
          item.targetTitle || '-'
        )}
      </td>

      {/* Time */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-surface-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-surface-300">{formatRelativeTime(item.createdAt)}</p>
            <p className="text-xs text-surface-500">{formatDate(item.createdAt)}</p>
          </div>
        </div>
      </td>
    </tr>
  );
}
