import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HardDrive,
  Film,
  Tv,
  Trash2,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Zap,
  Calendar,
  ArrowRight,
  PlayCircle,
  ListFilter,
  User,
  AlertCircle,
  Server,
  Thermometer,
  Database,
  Activity,
  Shield,
  Layers,
} from 'lucide-react';
import { useStats, useRecentActivity, useUpcomingDeletions, useRecommendations, useMarkForDeletion, useUnraidStats, useHealthStatus, useStorageHistory } from '@/hooks/useApi';
import { SystemHealthCard } from '@/components/Health/SystemHealthCard';
import { ScheduleCadenceCard } from '@/components/Health/ScheduleCadenceCard';
import { WelcomeCard } from './WelcomeCard';
import type { ActivityLogEntry, Recommendation, UnraidDisk, StorageSnapshot } from '@/types';
import { formatBytes, formatRelativeTime, cn } from '@/lib/utils';
import { formatActivity } from '@/lib/activityFormatter';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/common/Toast';
import '@/styles/storage-trends.css';

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, isError: statsError, error: statsErrorData, refetch: refetchStats } = useStats();
  const { data: recentActivity, isLoading: activityLoading, isError: activityError, error: activityErrorData, refetch: refetchActivity } = useRecentActivity();
  const { data: upcomingDeletions, isLoading: deletionsLoading, isError: deletionsError, error: deletionsErrorData, refetch: refetchDeletions } = useUpcomingDeletions();
  const { data: recommendations, isLoading: recommendationsLoading, isError: recommendationsError, error: recommendationsErrorData, refetch: refetchRecommendations } = useRecommendations(6, 90);
  const { data: unraidStats, isLoading: unraidLoading, isError: unraidError, error: unraidErrorData, refetch: refetchUnraid } = useUnraidStats();
  const { data: storageHistory, isLoading: storageHistoryLoading } = useStorageHistory(30);
  const { data: healthStatus, isLoading: healthLoading, isFetching: healthFetching } = useHealthStatus();
  const markForDeletion = useMarkForDeletion();
  const { addToast } = useToast();

  const hasArrService = Boolean(
    healthStatus?.services?.some((s) => (s.service === 'sonarr' || s.service === 'radarr') && s.configured)
  );

  // Combined refetch for critical errors
  const refetchAll = () => {
    refetchStats();
    refetchActivity();
    refetchDeletions();
    refetchRecommendations();
    refetchUnraid();
  };

  // Check for critical errors (stats is essential for the dashboard)
  const hasCriticalError = statsError;

  // Check if required services are configured
  const getServiceStatus = () => {
    if (!healthStatus?.services) return null;

    const serviceMap: Record<string, { required: boolean | 'arr' | 'watchHistory'; description: string }> = {
      plex: { required: true, description: 'Media server for library data' },
      tautulli: { required: 'watchHistory', description: 'Watch history and statistics' },
      tracearr: { required: 'watchHistory', description: 'Watch history and statistics' },
      sonarr: { required: 'arr', description: 'TV show management and deletion' },
      radarr: { required: 'arr', description: 'Movie management and deletion' },
      overseerr: { required: false, description: 'Request management' },
    };

    const services = healthStatus.services.map(s => ({
      name: s.service.charAt(0).toUpperCase() + s.service.slice(1),
      configured: s.configured,
      required: serviceMap[s.service]?.required ?? false,
      description: serviceMap[s.service]?.description ?? '',
    }));

    // Add Unraid separately (it's not in health status, uses separate API)
    services.push({
      name: 'Unraid',
      configured: unraidStats?.configured ?? false,
      required: false,
      description: 'Server storage monitoring',
    });

    return services;
  };

  const serviceStatus = getServiceStatus();

  // Check if required services are configured:
  // - Plex is always required
  // - At least one watch history provider (Tautulli OR Tracearr) is required
  // - At least one of Sonarr or Radarr is required
  const checkRequiredServices = () => {
    if (!serviceStatus) return true; // Assume configured while loading

    const plex = serviceStatus.find(s => s.name.toLowerCase() === 'plex');
    const tautulli = serviceStatus.find(s => s.name.toLowerCase() === 'tautulli');
    const tracearr = serviceStatus.find(s => s.name.toLowerCase() === 'tracearr');
    const sonarr = serviceStatus.find(s => s.name.toLowerCase() === 'sonarr');
    const radarr = serviceStatus.find(s => s.name.toLowerCase() === 'radarr');

    const plexConfigured = plex?.configured ?? false;
    const hasWatchHistoryProvider = (tautulli?.configured ?? false) || (tracearr?.configured ?? false);
    const hasArrService = (sonarr?.configured ?? false) || (radarr?.configured ?? false);

    return plexConfigured && hasWatchHistoryProvider && hasArrService;
  };

  const requiredServicesConfigured = checkRequiredServices();
  const showWelcome = !healthLoading && serviceStatus && !requiredServicesConfigured;

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <header className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-500/5 via-transparent to-violet-500/5 rounded-3xl" />
        <div className="relative px-4 py-6 sm:px-8 sm:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-accent-text mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Overview
              </p>
              <h1 className="text-2xl sm:text-4xl font-display font-bold text-surface-50 tracking-tight">
                Dashboard
              </h1>
              <p className="text-surface-400 mt-2 max-w-lg">
                Monitor your media library health and cleanup progress
              </p>
            </div>
            <div className="hidden lg:flex items-center gap-3 text-sm text-surface-400">
              <Calendar className="w-4 h-4" />
              Last scan:{' '}
              <span className="text-surface-200 font-medium">
                {healthLoading ? '...' : healthStatus?.scheduler.lastScan
                  ? formatRelativeTime(healthStatus.scheduler.lastScan)
                  : 'Never'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Welcome Card - Show when services aren't configured */}
      {showWelcome && serviceStatus && (
        <WelcomeCard services={serviceStatus} />
      )}

      {/* Critical Error State */}
      {hasCriticalError && (
        <ErrorState
          error={statsErrorData as Error}
          title="Failed to load dashboard"
          retry={refetchAll}
        />
      )}

      {/* Health Status Row */}
      {!hasCriticalError && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SystemHealthCard
            services={healthStatus?.services || []}
            overall={healthStatus?.overall || 'unhealthy'}
            loading={healthLoading}
            isFetching={healthFetching}
          />
          <ScheduleCadenceCard
            scheduler={healthStatus?.scheduler || {
              isRunning: false,
              lastScan: null,
              nextRun: null,
              scanSchedule: '0 3 * * *',
              lastSync: null,
              lastSyncAt: null,
              lastSyncSuccess: null,
              nextSync: null,
              syncSchedule: '0 2 * * *',
            }}
            loading={healthLoading}
          />
        </div>
      )}

      {/* Stats Grid */}
      {!hasCriticalError && (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
        <StatCard
          title="Total Storage"
          value={statsLoading || unraidLoading ? '...' : formatBytes(
            unraidStats?.configured ? unraidStats.totalCapacity : (stats?.totalStorage || 0)
          )}
          subtitle={`${statsLoading || unraidLoading ? '...' : formatBytes(
            unraidStats?.configured ? unraidStats.usedCapacity : (stats?.usedStorage || 0)
          )} used`}
          icon={HardDrive}
          color="accent"
          loading={statsLoading || unraidLoading}
        />
        <StatCard
          title="Movies"
          value={statsLoading ? '...' : String(stats?.movieCount || 0)}
          subtitle={`${stats?.unwatchedMovies || 0} unwatched`}
          icon={Film}
          color="violet"
          loading={statsLoading}
        />
        <StatCard
          title="TV Shows"
          value={statsLoading ? '...' : String(stats?.tvShowCount || 0)}
          subtitle={`${stats?.tvEpisodeCount || 0} episodes`}
          icon={Tv}
          color="emerald"
          loading={statsLoading}
        />
        <StatCard
          title="Reclaimable"
          value={statsLoading ? '...' : formatBytes(stats?.reclaimableSpace || 0)}
          subtitle={`${stats?.itemsMarkedForDeletion || 0} items queued`}
          icon={Trash2}
          color="ruby"
          loading={statsLoading}
        />
      </div>
      )}

      {/* Main Content */}
      {!hasCriticalError && (
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Recent Activity */}
        <div className="xl:col-span-3">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-accent-500/10">
                  <Clock className="w-5 h-5 text-accent-text" />
                </div>
                <div>
                  <h2 className="text-lg font-display font-semibold text-surface-50">Recent Activity</h2>
                  <p className="text-sm text-surface-500">Latest actions and events</p>
                </div>
              </div>
              <Link to="/activity" className="btn-ghost text-sm">
                View all
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {activityLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="skeleton-shimmer h-16 rounded-xl" />
                ))}
              </div>
            ) : activityError ? (
              <ErrorState
                error={activityErrorData as Error}
                title="Failed to load activity"
                retry={refetchActivity}
              />
            ) : recentActivity && recentActivity.length > 0 ? (
              <div className="space-y-2">
                {recentActivity.slice(0, 8).map((activity) => (
                  <ActivityItem key={activity.id} activity={activity} />
                ))}
                {recentActivity.length > 8 && (
                  <Link to="/activity" className="block text-center py-2 text-sm text-surface-400 hover:text-accent-text-hover transition-colors">
                    +{recentActivity.length - 8} more — View activity log
                  </Link>
                )}
              </div>
            ) : (
              <EmptyState
                icon={Clock}
                title="No recent activity"
                description="Activity will appear here as you scan your library and manage media. Run a library sync to get started."
              />
            )}
          </div>
        </div>

        {/* Upcoming Deletions */}
        <div className="xl:col-span-2">
          <div className="card p-6 h-full">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-ruby-500/10">
                <AlertTriangle className="w-5 h-5 text-ruby-400" />
              </div>
              <div>
                <h2 className="text-lg font-display font-semibold text-surface-50">Upcoming Deletions</h2>
                <p className="text-sm text-surface-500">Items scheduled for removal</p>
              </div>
            </div>

            {deletionsLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="skeleton-shimmer h-20 rounded-xl" />
                ))}
              </div>
            ) : deletionsError ? (
              <ErrorState
                error={deletionsErrorData as Error}
                title="Failed to load deletions"
                retry={refetchDeletions}
              />
            ) : upcomingDeletions && upcomingDeletions.length > 0 ? (
              <div className="space-y-3">
                {upcomingDeletions.slice(0, 5).map((item) => (
                  <DeletionItem key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={CheckCircle}
                title="Queue is clear"
                description="No items are scheduled for deletion. Media flagged by rules or manually queued will appear here."
                variant="success"
              />
            )}
          </div>
        </div>
      </div>
      )}

      {/* Recommended Deletions */}
      {!hasCriticalError && (
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10">
              <TrendingDown className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-lg font-display font-semibold text-surface-50">Recommended for Cleanup</h2>
              <p className="text-sm text-surface-500">
                {recommendations?.total ?? 0} items haven't been watched in 90+ days
                {recommendations?.totalReclaimableSpace ? ` • ${formatBytes(recommendations.totalReclaimableSpace)} reclaimable` : ''}
              </p>
            </div>
          </div>
          <Link to="/recommendations" className="btn-ghost text-sm">
            View all
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {recommendationsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton-shimmer h-32 rounded-xl" />
            ))}
          </div>
        ) : recommendationsError ? (
          <ErrorState
            error={recommendationsErrorData as Error}
            title="Failed to load recommendations"
            retry={refetchRecommendations}
          />
        ) : recommendations?.items && recommendations.items.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recommendations.items.map((item) => (
              <RecommendationCard
                key={item.id}
                item={item}
                onMarkForDeletion={() => {
                  if (!hasArrService) {
                    addToast({ type: 'warning', title: 'Sonarr/Radarr not configured', message: 'Set up Sonarr or Radarr in Settings to enable deletion.' });
                    return;
                  }
                  markForDeletion.mutate(
                    { id: item.id },
                    {
                      onSuccess: () => addToast({ type: 'success', title: 'Queued for deletion', message: `"${item.title}" added to deletion queue` }),
                      onError: (err) => addToast({ type: 'error', title: 'Failed to queue', message: err instanceof Error ? err.message : `Failed to queue "${item.title}"` }),
                    }
                  );
                }}
                isLoading={markForDeletion.isPending}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CheckCircle}
            title="Library is in great shape!"
            description="No stale content found based on your watch history. Items unwatched for 90+ days will appear here."
            variant="success"
          />
        )}
      </div>
      )}

      {/* Quick Stats */}
      {!hasCriticalError && (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
        <QuickStatCard
          label="Items Scanned Today"
          value={String(stats?.scannedToday || 0)}
          icon={PlayCircle}
          color="accent"
          trend={stats?.scanTrend}
        />
        <QuickStatCard
          label="Space Reclaimed This Week"
          value={formatBytes(stats?.reclaimedThisWeek || 0)}
          icon={TrendingUp}
          color="emerald"
          trend={stats?.reclaimedTrend}
        />
        <QuickStatCard
          label="Active Rules"
          value={String(stats?.activeRules || 0)}
          icon={Zap}
          color="violet"
        />
        <QuickStatCard
          label="Collections"
          value={`${stats?.collectionCount || 0}`}
          icon={Layers}
          color="violet"
        />
      </div>
      )}

      {/* Storage Trends Chart */}
      {!hasCriticalError && storageHistory && storageHistory.length > 0 && (
        <StorageTrendsChart data={storageHistory} loading={storageHistoryLoading} />
      )}

      {/* Storage Overview - Only show if Unraid is configured */}
      {!hasCriticalError && (unraidLoading || unraidStats?.configured) && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent-500/10">
                <Server className="w-5 h-5 text-accent-text" />
              </div>
              <div>
                <h2 className="text-lg font-display font-semibold text-surface-50">Storage Overview</h2>
                <p className="text-sm text-surface-500">Unraid server disk statistics</p>
              </div>
            </div>
            {unraidStats?.lastUpdated && (
              <span className="text-xs text-surface-500">
                Updated {formatRelativeTime(unraidStats.lastUpdated)}
              </span>
            )}
          </div>

          {unraidLoading ? (
            <div className="space-y-6">
              {/* Loading skeleton for overview cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="skeleton-shimmer h-24 rounded-xl" />
                ))}
              </div>
              {/* Loading skeleton for disk cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="skeleton-shimmer h-32 rounded-xl" />
                ))}
              </div>
            </div>
          ) : unraidError ? (
            <ErrorState
              error={unraidErrorData as Error}
              title="Failed to load storage info"
              retry={refetchUnraid}
            />
          ) : unraidStats?.configured && unraidStats.disks ? (
            <div className="space-y-6">
              {/* Storage Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StorageSummaryCard
                  title="Array State"
                  value={unraidStats.arrayState}
                  icon={Activity}
                  color={unraidStats.arrayState === 'Started' ? 'emerald' : unraidStats.arrayState === 'Syncing' ? 'amber' : 'ruby'}
                  showStatus
                />
                <StorageSummaryCard
                  title="Total Storage"
                  value={formatBytes(unraidStats.usedCapacity)}
                  subtitle={`of ${formatBytes(unraidStats.totalCapacity)}`}
                  icon={Database}
                  color="accent"
                  percent={unraidStats.usedPercent}
                />
                {unraidStats.disks.filter(d => d.type === 'cache').length > 0 && (
                  <StorageSummaryCard
                    title="Cache Storage"
                    value={formatBytes(unraidStats.disks.filter(d => d.type === 'cache').reduce((acc, d) => acc + d.used, 0))}
                    subtitle={`of ${formatBytes(unraidStats.disks.filter(d => d.type === 'cache').reduce((acc, d) => acc + d.size, 0))}`}
                    icon={Zap}
                    color="violet"
                    percent={Math.round(
                      (unraidStats.disks.filter(d => d.type === 'cache').reduce((acc, d) => acc + d.used, 0) /
                        unraidStats.disks.filter(d => d.type === 'cache').reduce((acc, d) => acc + d.size, 0)) * 100
                    ) || 0}
                  />
                )}
              </div>

              {/* Individual Disks - grouped by type */}
              <div className="space-y-5">
                {unraidStats.disks.filter(d => d.type === 'parity').length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-surface-400 mb-3 flex items-center gap-2">
                      <Shield className="w-3.5 h-3.5 text-amber-400" />
                      Parity
                      <span className="text-surface-600">({unraidStats.disks.filter(d => d.type === 'parity').length})</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {unraidStats.disks.filter(d => d.type === 'parity').map((disk) => (
                        <DiskCard key={disk.device} disk={disk} />
                      ))}
                    </div>
                  </div>
                )}
                {unraidStats.disks.filter(d => d.type === 'data').length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-surface-400 mb-3 flex items-center gap-2">
                      <HardDrive className="w-3.5 h-3.5 text-accent-text" />
                      Array
                      <span className="text-surface-600">({unraidStats.disks.filter(d => d.type === 'data').length})</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {unraidStats.disks.filter(d => d.type === 'data').map((disk) => (
                        <DiskCard key={disk.device} disk={disk} />
                      ))}
                    </div>
                  </div>
                )}
                {unraidStats.disks.filter(d => d.type === 'cache').length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-surface-400 mb-3 flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-violet-400" />
                      Cache
                      <span className="text-surface-600">({unraidStats.disks.filter(d => d.type === 'cache').length})</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {unraidStats.disks.filter(d => d.type === 'cache').map((disk) => (
                        <DiskCard key={disk.device} disk={disk} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  color: 'accent' | 'violet' | 'emerald' | 'ruby';
  trend?: number;
  loading?: boolean;
}

function StatCard({ title, value, subtitle, icon: Icon, color, trend, loading }: StatCardProps) {
  const colorStyles = {
    accent: {
      bg: 'bg-accent-500/10',
      text: 'text-accent-text',
      glow: 'shadow-accent-500/5',
      gradient: 'from-accent-500/10',
    },
    violet: {
      bg: 'bg-violet-500/10',
      text: 'text-violet-400',
      glow: 'shadow-violet-500/5',
      gradient: 'from-violet-500/10',
    },
    emerald: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      glow: 'shadow-emerald-500/5',
      gradient: 'from-emerald-500/10',
    },
    ruby: {
      bg: 'bg-ruby-500/10',
      text: 'text-ruby-400',
      glow: 'shadow-ruby-500/5',
      gradient: 'from-ruby-500/10',
    },
  };

  const styles = colorStyles[color];

  return (
    <div className={cn(
      'card-interactive p-5 relative overflow-hidden',
      `shadow-lg ${styles.glow}`
    )}>
      <div className={cn(
        'absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl to-transparent rounded-full opacity-50 -translate-y-8 translate-x-8',
        styles.gradient
      )} />

      <div className="relative">
        <div className="flex items-start justify-between mb-4">
          <div className={cn('p-2.5 rounded-xl', styles.bg)}>
            <Icon className={cn('w-5 h-5', styles.text)} />
          </div>
          {trend !== undefined && trend !== 0 && (
            <div className={cn(
              'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg',
              trend > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-ruby-500/10 text-ruby-400'
            )}>
              {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(trend)}%
            </div>
          )}
        </div>

        <p className="text-sm text-surface-400 font-medium">{title}</p>

        {loading ? (
          <div className="skeleton-shimmer h-9 w-24 mt-1 rounded-lg" />
        ) : (
          <p className="text-3xl font-display font-bold text-surface-50 mt-1 tracking-tight">{value}</p>
        )}

        <p className="text-sm text-surface-500 mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

const DASHBOARD_EVENT_CONFIG: Record<
  ActivityLogEntry['eventType'],
  { icon: typeof PlayCircle; color: string; bg: string }
> = {
  scan: { icon: PlayCircle, color: 'text-accent-text', bg: 'bg-accent-500/10' },
  deletion: { icon: Trash2, color: 'text-ruby-400', bg: 'bg-ruby-500/10' },
  rule_match: { icon: ListFilter, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  protection: { icon: Shield, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  manual_action: { icon: User, color: 'text-violet-400', bg: 'bg-violet-500/10' },
  error: { icon: AlertCircle, color: 'text-ruby-400', bg: 'bg-ruby-500/10' },
};

function ActivityItem({ activity }: { activity: ActivityLogEntry }) {
  const config = DASHBOARD_EVENT_CONFIG[activity.eventType] ?? {
    icon: Activity,
    color: 'text-surface-400',
    bg: 'bg-surface-700/40',
  };
  const { icon: Icon, color, bg } = config;
  const formatted = formatActivity(activity);

  const targetHref = activity.targetId
    ? activity.targetType === 'collection'
      ? `/collections/${activity.targetId}`
      : `/library/${activity.targetId}`
    : null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl hover:bg-surface-800/40 transition-colors">
      <div className={cn('p-2 rounded-lg flex-shrink-0', bg)}>
        <Icon className={cn('w-4 h-4', color)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-medium text-surface-100">{formatted.title}</p>
          {activity.targetTitle && (
            <span className="text-sm text-surface-300 truncate">
              {targetHref ? (
                <Link to={targetHref} className="hover:text-accent-text-hover transition-colors">
                  {activity.targetTitle}
                </Link>
              ) : (
                activity.targetTitle
              )}
            </span>
          )}
        </div>
        {formatted.description && (
          <p className="text-xs text-surface-400 mt-0.5 truncate">{formatted.description}</p>
        )}
        {formatted.chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {formatted.chips.slice(0, 3).map((chip) => (
              <Badge key={`${chip.variant}:${chip.label}`} variant={chip.variant} size="sm">
                {chip.label}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-xs text-surface-500 mt-1">{formatRelativeTime(activity.createdAt)}</p>
      </div>
    </div>
  );
}

interface DeletionItemData {
  id: string;
  title: string;
  type: 'movie' | 'tv';
  size: number;
  deleteAt: string;
}

function DeletionItem({ item }: { item: DeletionItemData }) {
  const TypeIcon = item.type === 'movie' ? Film : Tv;
  const typeColor = item.type === 'movie' ? 'violet' : 'emerald';

  return (
    <div
      className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30 hover:border-surface-600/50 transition-all"
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'p-2 rounded-lg',
          typeColor === 'violet' ? 'bg-violet-500/10' : 'bg-emerald-500/10'
        )}>
          <TypeIcon className={cn(
            'w-4 h-4',
            typeColor === 'violet' ? 'text-violet-400' : 'text-emerald-400'
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-surface-200 line-clamp-1">{item.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn(
              'badge text-2xs',
              typeColor === 'violet' ? 'badge-violet' : 'badge-emerald'
            )}>
              {item.type}
            </span>
            <span className="text-xs text-surface-500">{formatBytes(item.size)}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-ruby-400">{formatRelativeTime(item.deleteAt)}</p>
        </div>
      </div>
    </div>
  );
}

interface QuickStatCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  color: 'accent' | 'emerald' | 'violet';
  trend?: number;
}

function QuickStatCard({ label, value, icon: Icon, color, trend }: QuickStatCardProps) {
  const colorStyles = {
    accent: { bg: 'bg-accent-500/10', text: 'text-accent-text' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
  };

  const styles = colorStyles[color];

  return (
    <div className="card-interactive p-5 flex items-center gap-4">
      <div className={cn('p-3 rounded-xl', styles.bg)}>
        <Icon className={cn('w-5 h-5', styles.text)} />
      </div>
      <div className="flex-1">
        <p className="text-sm text-surface-400">{label}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-2xl font-display font-bold text-surface-50">{value}</p>
          {trend !== undefined && trend !== 0 && (
            <div className={cn(
              'flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-lg',
              trend > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-ruby-500/10 text-ruby-400'
            )}>
              {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(trend)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface RecommendationCardProps {
  item: Recommendation;
  onMarkForDeletion: () => void;
  isLoading: boolean;
}

function RecommendationCard({ item, onMarkForDeletion, isLoading }: RecommendationCardProps) {
  const TypeIcon = item.type === 'movie' ? Film : Tv;
  const typeColor = item.type === 'movie' ? 'violet' : 'emerald';

  return (
    <div
      className="group p-4 rounded-xl bg-surface-800/40 border border-surface-700/30 hover:border-surface-600/50 transition-all"
    >
      <div className="flex gap-3">
        {/* Poster */}
        <div className="relative w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-surface-800">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={item.title}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <TypeIcon className="w-8 h-8 text-surface-600" />
            </div>
          )}
          <div className={cn(
            'absolute top-1 right-1 p-1 rounded',
            typeColor === 'violet' ? 'bg-violet-500/80' : 'bg-emerald-500/80'
          )}>
            <TypeIcon className="w-3 h-3 text-white" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <p className="text-sm font-medium text-surface-200 line-clamp-2">{item.title}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-surface-500">{formatBytes(item.size)}</span>
            </div>
          </div>

          <div className="mt-2">
            <p className={cn(
              'text-xs font-medium',
              item.neverWatched ? 'text-ruby-400' : 'text-amber-400'
            )}>
              {item.reason}
            </p>
          </div>
        </div>
      </div>

      {/* Action */}
      <button
        onClick={onMarkForDeletion}
        disabled={isLoading}
        className="w-full mt-3 py-2 px-3 text-xs font-medium rounded-lg bg-ruby-500/10 text-ruby-400 hover:bg-ruby-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Queue for Deletion
      </button>
    </div>
  );
}

interface StorageSummaryCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  color: 'accent' | 'emerald' | 'violet' | 'ruby' | 'amber';
  percent?: number;
  showStatus?: boolean;
}

function StorageSummaryCard({ title, value, subtitle, icon: Icon, color, percent, showStatus }: StorageSummaryCardProps) {
  const colorStyles = {
    accent: { bg: 'bg-accent-500/10', text: 'text-accent-text', ring: 'text-accent-500' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'text-emerald-500' },
    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', ring: 'text-violet-500' },
    ruby: { bg: 'bg-ruby-500/10', text: 'text-ruby-400', ring: 'text-ruby-500' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'text-amber-500' },
  };

  const styles = colorStyles[color];
  const ringRadius = 18;
  const circumference = 2 * Math.PI * ringRadius;

  return (
    <div className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn('p-2 rounded-lg', styles.bg)}>
              <Icon className={cn('w-4 h-4', styles.text)} />
            </div>
            <p className="text-sm text-surface-400">{title}</p>
          </div>

          <div className="flex items-baseline gap-2">
            {showStatus ? (
              <div className="flex items-center gap-2">
                <span className={cn(
                  'w-2 h-2 rounded-full',
                  value === 'Started' ? 'bg-emerald-500' : value === 'Syncing' ? 'bg-amber-500 animate-pulse' : 'bg-ruby-500'
                )} />
                <p className="text-xl font-display font-bold text-surface-50">{value}</p>
              </div>
            ) : (
              <>
                <p className="text-xl font-display font-bold text-surface-50">{value}</p>
                {subtitle && <p className="text-sm text-surface-500">{subtitle}</p>}
              </>
            )}
          </div>
        </div>

        {/* Mini ring chart for percentage */}
        {percent !== undefined && (
          <div className="relative w-11 h-11 flex-shrink-0">
            <svg className="w-11 h-11 -rotate-90" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r={ringRadius} fill="none" stroke="currentColor" strokeWidth="3" className="text-surface-700/60" />
              <circle
                cx="22" cy="22" r={ringRadius}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                className={styles.ring}
                stroke="currentColor"
                strokeDasharray={`${circumference}`}
                strokeDashoffset={`${circumference * (1 - (percent || 0) / 100)}`}
                style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xs font-bold text-surface-300">{Math.round(percent)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface StorageTrendsChartProps {
  data: StorageSnapshot[];
  loading: boolean;
}

interface StorageHoverState {
  idx: number;
  leftPx: number;
}

function StorageTrendsChart({ data, loading }: StorageTrendsChartProps) {
  // The chart fills its container: the viewBox width tracks the measured wrap
  // width so 1 viewBox unit = 1 CSS px (crisp text, no aspect stretch) — same
  // approach as the Schedule cadence card.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  const [hover, setHover] = useState<StorageHoverState | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setW(Math.max(320, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (loading || data.length === 0) return null;

  // ---- geometry (viewBox units = CSS px) ----
  const H = 172;
  const padT = 16;
  const padB = 28;
  const padL = 6;
  const padR = 6;
  const baseY = H - padB;
  const plotH = baseY - padT;
  const innerW = W - padL - padR;
  const n = data.length;

  const values = data.map((s) => s.totalSize);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Pad the value range a little (and add headroom when the line is flat) so the
  // trace never hugs the top/bottom edges.
  const pad = hi === lo ? (hi || 1) * 0.04 : (hi - lo) * 0.14;
  const minVal = lo - pad;
  const maxVal = hi + pad;
  const range = maxVal - minVal || 1;

  const x = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const y = (v: number) => baseY - ((v - minVal) / range) * plotH;

  const points = data.map((s, i) => ({ x: x(i), y: y(s.totalSize) }));
  const lineD =
    points.length > 1
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      : '';
  const areaD =
    points.length > 1
      ? `${lineD} L${points[n - 1]!.x.toFixed(1)},${baseY} L${points[0]!.x.toFixed(1)},${baseY} Z`
      : '';

  const first = data[0]!;
  const last = data[n - 1]!;
  const delta = last.totalSize - first.totalSize;
  const down = delta < 0;
  const trendPct = first.totalSize > 0 ? Math.round((delta / first.totalSize) * 100) : 0;

  // X-axis labels: start / middle / end (deduped for short windows).
  const fmtAxis = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const labelIdx = (n === 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1]).filter(
    (idx, pos, arr) => arr.indexOf(idx) === pos
  );

  // Nearest-point selection; the tooltip stays pinned near the top and only
  // tracks horizontally, so it never clips against the card edge.
  const pick = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const localW = el.offsetWidth || rect.width;
    const px = ((clientX - rect.left) / localW) * W;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const TIPW = 188;
    const PAD = 6;
    const center = (x(best) / W) * localW;
    const maxLeft = localW - TIPW - PAD;
    const leftPx =
      maxLeft < PAD ? (localW - TIPW) / 2 : Math.max(PAD, Math.min(maxLeft, center - TIPW / 2));
    setHover({ idx: best, leftPx });
  };

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => pick(e.clientX, e.currentTarget);
  const handleTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (t) pick(t.clientX, e.currentTarget);
  };

  const hoveredSnap = hover ? data[hover.idx] : undefined;
  const hoveredPt = hover ? points[hover.idx] : undefined;

  return (
    <div className="sc-card">
      {/* Header */}
      <div className="sc-head">
        <div className="sc-ico">
          <TrendingUp className="w-[18px] h-[18px]" strokeWidth={2} />
        </div>
        <div className="sc-head-t">
          <div className="sc-title">Storage Trends</div>
          <div className="sc-sub">Library size over {n === 1 ? '1 day' : `${n} days`}</div>
        </div>
        <div className="sc-head-actions">
          {delta !== 0 && (
            <div className={'st-trend' + (down ? ' down' : ' up')}>
              {down ? <TrendingDown /> : <TrendingUp />}
              {formatBytes(Math.abs(delta))}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="sc-body">
        <div className="cad-cap">
          <span className="cad-cap-k">Total library size</span>
          <span className="cad-cap-sub">
            {trendPct !== 0 ? `${down ? '−' : '+'}${Math.abs(trendPct)}% · ${n}d` : `${n}d`}
          </span>
        </div>

        <div
          className="st-wrap"
          ref={wrapRef}
          onMouseLeave={() => setHover(null)}
          onMouseMove={handleMove}
          onTouchStart={handleTouch}
          onTouchMove={handleTouch}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="st-svg">
            <defs>
              <linearGradient id="stFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#38bdf8" stopOpacity="0.22" />
                <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* gridlines */}
            {[0, 0.5, 1].map((g, i) => {
              const gy = baseY - g * plotH;
              return <line key={i} className="st-grid" x1={padL} y1={gy} x2={W - padR} y2={gy} />;
            })}

            {areaD && <path className="st-area" d={areaD} fill="url(#stFill)" />}
            {lineD && <path className="st-line" d={lineD} />}

            {/* hover guide */}
            {hoveredPt && (
              <line
                className="st-guide"
                x1={hoveredPt.x}
                y1={padT - 6}
                x2={hoveredPt.x}
                y2={baseY}
              />
            )}

            {/* current point marker (hidden while scrubbing) */}
            {!hover && (
              <circle className="st-dot-pt" cx={points[n - 1]!.x} cy={points[n - 1]!.y} r={3.2} />
            )}
            {hoveredPt && (
              <circle className="st-dot-hover" cx={hoveredPt.x} cy={hoveredPt.y} r={4.2} />
            )}

            {/* x-axis labels */}
            {labelIdx.map((idx) => (
              <text key={idx} className="st-axis" x={x(idx)} y={baseY + 16} textAnchor="middle">
                {fmtAxis(data[idx]!.capturedAt)}
              </text>
            ))}
          </svg>

          {/* tooltip */}
          {hover && hoveredSnap && (
            <div className="st-tip" style={{ left: hover.leftPx }}>
              <div className="st-tip-date">
                <span className="st-tip-dot" />
                {new Date(hoveredSnap.capturedAt).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
              <div className="st-tip-row total">
                <span className="k">
                  <span className="st-sw acc" />
                  Total
                </span>
                <span className="v">{formatBytes(hoveredSnap.totalSize)}</span>
              </div>
              <div className="st-tip-row">
                <span className="k">
                  <span className="st-sw vio" />
                  Movies
                </span>
                <span className="v">{formatBytes(hoveredSnap.movieSize)}</span>
              </div>
              <div className="st-tip-row">
                <span className="k">
                  <span className="st-sw eme" />
                  TV Shows
                </span>
                <span className="v">{formatBytes(hoveredSnap.showSize)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sc-foot">
        <div className="sc-foot-cell">
          <div className="sc-foot-k">Movies</div>
          <div className="sc-foot-v">
            <span className="st-foot-dot vio" />
            {formatBytes(last.movieSize)}
          </div>
        </div>
        <div className="sc-foot-div" />
        <div className="sc-foot-cell">
          <div className="sc-foot-k">TV Shows</div>
          <div className="sc-foot-v">
            <span className="st-foot-dot eme" />
            {formatBytes(last.showSize)}
          </div>
        </div>
        <div className="sc-foot-div" />
        <div className="sc-foot-cell">
          <div className="sc-foot-k">Total</div>
          <div className="sc-foot-v">
            <span className="st-foot-dot acc" />
            {formatBytes(last.totalSize)}
          </div>
        </div>
      </div>
    </div>
  );
}

interface DiskCardProps {
  disk: UnraidDisk;
}

function DiskCard({ disk }: DiskCardProps) {
  const getTempColor = (temp?: number) => {
    if (temp === undefined) return 'text-surface-500';
    if (temp < 40) return 'text-emerald-400';
    if (temp <= 50) return 'text-amber-400';
    return 'text-ruby-400';
  };

  const getBarColor = (percent: number) => {
    if (percent > 90) return 'bg-ruby-500';
    if (percent > 75) return 'bg-amber-500';
    return 'bg-accent-500';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500';
      case 'standby': return 'bg-amber-500';
      case 'error': return 'bg-ruby-500';
      default: return 'bg-surface-500';
    }
  };

  return (
    <div
      className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30 hover:border-surface-600/50 transition-all"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', getStatusColor(disk.status))} />
          <p className="text-sm font-medium text-surface-200">{disk.name}</p>
        </div>
        {disk.temp !== undefined && (
          <div className="flex items-center gap-1">
            <Thermometer className={cn('w-3 h-3', getTempColor(disk.temp))} />
            <span className={cn('text-xs font-medium tabular-nums', getTempColor(disk.temp))}>
              {disk.temp}°C
            </span>
          </div>
        )}
      </div>

      {/* Capacity */}
      <div>
        <div className="h-1.5 bg-surface-700/60 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', getBarColor(disk.usedPercent))}
            style={{ width: `${Math.round(disk.usedPercent)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs">
          <span className="text-surface-400 tabular-nums">
            {formatBytes(disk.used)} <span className="text-surface-600">/ {formatBytes(disk.size)}</span>
          </span>
          <span className="text-surface-500 tabular-nums">{formatBytes(disk.free)} free</span>
        </div>
      </div>
    </div>
  );
}
