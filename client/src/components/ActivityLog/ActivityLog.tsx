import { useState } from 'react';
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
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import type { ActivityLogEntry, ActivityFilters } from '@/types';

// Event type configuration
const EVENT_CONFIG: Record<string, { icon: typeof Activity; colorClass: string; label: string }> = {
  scan: { icon: PlayCircle, colorClass: 'text-accent-400', label: 'Scan' },
  deletion: { icon: Trash2, colorClass: 'text-ruby-400', label: 'Deletion' },
  rule_match: { icon: ListFilter, colorClass: 'text-amber-400', label: 'Rule Match' },
  protection: { icon: Shield, colorClass: 'text-emerald-400', label: 'Protection' },
  manual_action: { icon: User, colorClass: 'text-violet-400', label: 'Manual' },
  error: { icon: AlertCircle, colorClass: 'text-ruby-400', label: 'Error' },
};

// Actor type badge configuration
const ACTOR_CONFIG: Record<string, { variant: 'accent' | 'violet' | 'warning'; label: string }> = {
  scheduler: { variant: 'accent', label: 'Scheduler' },
  user: { variant: 'violet', label: 'User' },
  rule: { variant: 'warning', label: 'Rule' },
};

const EVENT_TYPES = ['scan', 'deletion', 'rule_match', 'protection', 'manual_action', 'error'];
const ACTOR_TYPES = ['scheduler', 'user', 'rule'];

export default function ActivityLog() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState<ActivityFilters['dateRange']>('7d');
  const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
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
        <h1 className="text-2xl font-bold text-white">Activity Log</h1>
        <p className="text-surface-400 mt-1">System events and actions</p>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="space-y-4">
          {/* Search and Date Range */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search by target name..."
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
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </select>
            </div>
          </div>

          {/* Event Type Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-surface-400 mr-2">Event:</span>
            {EVENT_TYPES.map((type) => {
              const config = EVENT_CONFIG[type];
              const isSelected = selectedEventTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleEventType(type)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    'border flex items-center gap-1.5',
                    isSelected
                      ? 'bg-surface-700 border-surface-600 text-white'
                      : 'bg-surface-800/50 border-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                  )}
                >
                  <config.icon className={cn('w-3 h-3', isSelected && config.colorClass)} />
                  {config.label}
                </button>
              );
            })}
          </div>

          {/* Actor Type Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-surface-400 mr-2">Actor:</span>
            {ACTOR_TYPES.map((type) => {
              const config = ACTOR_CONFIG[type];
              const isSelected = selectedActorTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleActorType(type)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    'border flex items-center gap-1.5',
                    isSelected
                      ? 'bg-surface-700 border-surface-600 text-white'
                      : 'bg-surface-800/50 border-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                  )}
                >
                  {config.label}
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
          title="Failed to load activity log"
          retry={refetch}
        />
      ) : data && data.items.length > 0 ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Event
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Actor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Time
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
            title="No matching activity"
            description="No activities match your current filters. Try adjusting your search terms or filter options."
            action={{
              label: 'Clear Filters',
              onClick: clearFilters,
            }}
          />
        </Card>
      ) : (
        <Card className="p-12">
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="System activity will appear here as scans run, rules match, and deletions occur."
          />
        </Card>
      )}

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-400">
            Showing {(page - 1) * 20 + 1} to{' '}
            {Math.min(page * 20, data.total)} of {data.total} activities
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
              Page {page} of {totalPages}
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

function ActivityRow({ item }: { item: ActivityLogEntry }) {
  const eventConfig = EVENT_CONFIG[item.eventType] || {
    icon: Activity,
    colorClass: 'text-surface-400',
    label: item.eventType,
  };
  const actorConfig = ACTOR_CONFIG[item.actorType] || {
    variant: 'default' as const,
    label: item.actorType,
  };

  const EventIcon = eventConfig.icon;

  return (
    <tr className="border-b border-surface-800 hover:bg-surface-800/30 transition-colors">
      {/* Event */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={cn('p-2 rounded-lg bg-surface-800/50')}>
            <EventIcon className={cn('w-4 h-4', eventConfig.colorClass)} />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-white text-sm">
              {item.action}
            </p>
          </div>
        </div>
      </td>

      {/* Actor */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge variant={actorConfig.variant} size="sm">
            {actorConfig.label}
          </Badge>
          {item.actorName && (
            <span className="text-sm text-surface-400">{item.actorName}</span>
          )}
        </div>
      </td>

      {/* Target */}
      <td className="px-4 py-3 text-sm text-surface-300">
        {item.targetTitle || '-'}
      </td>

      {/* Time */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-surface-500" />
          <div>
            <p className="text-sm text-surface-300">{formatRelativeTime(item.createdAt)}</p>
            <p className="text-xs text-surface-500">{formatDate(item.createdAt)}</p>
          </div>
        </div>
      </td>
    </tr>
  );
}
