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
  XCircle,
  Server,
  Thermometer,
  Database,
  Activity,
  Shield,
} from 'lucide-react';
import { useStats, useRecentActivity, useUpcomingDeletions, useRecommendations, useMarkForDeletion, useUnraidStats, useHealthStatus, useStorageHistory } from '@/hooks/useApi';
import { SystemHealthCard } from '@/components/Health/SystemHealthCard';
import { ScheduleInfoCard } from '@/components/Health/ScheduleInfoCard';
import { WelcomeCard } from './WelcomeCard';
import type { Recommendation, UnraidDisk, StorageSnapshot } from '@/types';
import { formatBytes, formatRelativeTime, cn } from '@/lib/utils';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, isError: statsError, error: statsErrorData, refetch: refetchStats } = useStats();
  const { data: recentActivity, isLoading: activityLoading, isError: activityError, error: activityErrorData, refetch: refetchActivity } = useRecentActivity();
  const { data: upcomingDeletions, isLoading: deletionsLoading, isError: deletionsError, error: deletionsErrorData, refetch: refetchDeletions } = useUpcomingDeletions();
  const { data: recommendations, isLoading: recommendationsLoading, isError: recommendationsError, error: recommendationsErrorData, refetch: refetchRecommendations } = useRecommendations(6, 90);
  const { data: unraidStats, isLoading: unraidLoading, isError: unraidError, error: unraidErrorData, refetch: refetchUnraid } = useUnraidStats();
  const { data: storageHistory, isLoading: storageHistoryLoading } = useStorageHistory(30);
  const { data: healthStatus, isLoading: healthLoading, isFetching: healthFetching } = useHealthStatus();
  const markForDeletion = useMarkForDeletion();

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

    const serviceMap: Record<string, { required: boolean | 'arr'; description: string }> = {
      plex: { required: true, description: 'Media server for library data' },
      tautulli: { required: true, description: 'Watch history and statistics' },
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
  // - Plex and Tautulli are always required
  // - At least one of Sonarr or Radarr is required
  const checkRequiredServices = () => {
    if (!serviceStatus) return true; // Assume configured while loading

    const plex = serviceStatus.find(s => s.name.toLowerCase() === 'plex');
    const tautulli = serviceStatus.find(s => s.name.toLowerCase() === 'tautulli');
    const sonarr = serviceStatus.find(s => s.name.toLowerCase() === 'sonarr');
    const radarr = serviceStatus.find(s => s.name.toLowerCase() === 'radarr');

    const plexConfigured = plex?.configured ?? false;
    const tautulliConfigured = tautulli?.configured ?? false;
    const hasArrService = (sonarr?.configured ?? false) || (radarr?.configured ?? false);

    return plexConfigured && tautulliConfigured && hasArrService;
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
              <p className="text-sm font-medium text-accent-400 mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Overview
              </p>
              <h1 className="text-2xl sm:text-4xl font-display font-bold text-white tracking-tight">
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
          <ScheduleInfoCard
            scheduler={healthStatus?.scheduler || {
              isRunning: false,
              lastScan: null,
              nextRun: null,
              scanSchedule: '0 3 * * *',
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
                  <Clock className="w-5 h-5 text-accent-400" />
                </div>
                <div>
                  <h2 className="text-lg font-display font-semibold text-white">Recent Activity</h2>
                  <p className="text-sm text-surface-500">Latest actions and events</p>
                </div>
              </div>
              <button className="btn-ghost text-sm">
                View all
                <ArrowRight className="w-4 h-4" />
              </button>
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
                {recentActivity.map((activity, index) => (
                  <ActivityItem key={activity.id} activity={activity} index={index} />
                ))}
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
                <h2 className="text-lg font-display font-semibold text-white">Upcoming Deletions</h2>
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
                {upcomingDeletions.slice(0, 5).map((item, index) => (
                  <DeletionItem key={item.id} item={item} index={index} />
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
              <h2 className="text-lg font-display font-semibold text-white">Recommended for Cleanup</h2>
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
            {recommendations.items.map((item, index) => (
              <RecommendationCard
                key={item.id}
                item={item}
                index={index}
                onMarkForDeletion={() => markForDeletion.mutate({ id: item.id })}
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
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
      </div>
      )}

      {/* Storage Trends Chart */}
      {!hasCriticalError && storageHistory && storageHistory.length > 1 && (
        <StorageTrendsChart data={storageHistory} loading={storageHistoryLoading} />
      )}

      {/* Storage Overview - Only show if Unraid is configured */}
      {!hasCriticalError && (unraidLoading || unraidStats?.configured) && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent-500/10">
                <Server className="w-5 h-5 text-accent-400" />
              </div>
              <div>
                <h2 className="text-lg font-display font-semibold text-white">Storage Overview</h2>
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
                      {unraidStats.disks.filter(d => d.type === 'parity').map((disk, index) => (
                        <DiskCard key={disk.device} disk={disk} index={index} />
                      ))}
                    </div>
                  </div>
                )}
                {unraidStats.disks.filter(d => d.type === 'data').length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-surface-400 mb-3 flex items-center gap-2">
                      <HardDrive className="w-3.5 h-3.5 text-accent-400" />
                      Array
                      <span className="text-surface-600">({unraidStats.disks.filter(d => d.type === 'data').length})</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {unraidStats.disks.filter(d => d.type === 'data').map((disk, index) => (
                        <DiskCard key={disk.device} disk={disk} index={index} />
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
                      {unraidStats.disks.filter(d => d.type === 'cache').map((disk, index) => (
                        <DiskCard key={disk.device} disk={disk} index={index} />
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
      text: 'text-accent-400',
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
          <p className="text-3xl font-display font-bold text-white mt-1 tracking-tight">{value}</p>
        )}

        <p className="text-sm text-surface-500 mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

interface Activity {
  id: string;
  type: 'scan' | 'delete' | 'rule' | 'restore';
  message: string;
  timestamp: string;
}

function ActivityItem({ activity, index }: { activity: Activity; index: number }) {
  const config = {
    scan: { icon: PlayCircle, color: 'text-accent-400', bg: 'bg-accent-500/10' },
    delete: { icon: XCircle, color: 'text-ruby-400', bg: 'bg-ruby-500/10' },
    rule: { icon: Zap, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    restore: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  };

  const { icon: Icon, color, bg } = config[activity.type] || config.scan;

  return (
    <div
      className="flex items-center gap-4 p-3 rounded-xl hover:bg-surface-800/40 transition-colors animate-fade-up opacity-0"
      style={{
        animationDelay: `${index * 50}ms`,
        animationFillMode: 'forwards'
      }}
    >
      <div className={cn('p-2 rounded-lg', bg)}>
        <Icon className={cn('w-4 h-4', color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-surface-200 line-clamp-1">{activity.message}</p>
        <p className="text-xs text-surface-500 mt-0.5">{formatRelativeTime(activity.timestamp)}</p>
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

function DeletionItem({ item, index }: { item: DeletionItemData; index: number }) {
  const TypeIcon = item.type === 'movie' ? Film : Tv;
  const typeColor = item.type === 'movie' ? 'violet' : 'emerald';

  return (
    <div
      className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30 hover:border-surface-600/50 transition-all animate-fade-up opacity-0"
      style={{
        animationDelay: `${index * 50}ms`,
        animationFillMode: 'forwards'
      }}
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
    accent: { bg: 'bg-accent-500/10', text: 'text-accent-400' },
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
          <p className="text-2xl font-display font-bold text-white">{value}</p>
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
  index: number;
  onMarkForDeletion: () => void;
  isLoading: boolean;
}

function RecommendationCard({ item, index, onMarkForDeletion, isLoading }: RecommendationCardProps) {
  const TypeIcon = item.type === 'movie' ? Film : Tv;
  const typeColor = item.type === 'movie' ? 'violet' : 'emerald';

  return (
    <div
      className="group p-4 rounded-xl bg-surface-800/40 border border-surface-700/30 hover:border-surface-600/50 transition-all animate-fade-up opacity-0"
      style={{
        animationDelay: `${index * 50}ms`,
        animationFillMode: 'forwards'
      }}
    >
      <div className="flex gap-3">
        {/* Poster */}
        <div className="relative w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-surface-800">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={item.title}
              className="w-full h-full object-cover"
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
    accent: { bg: 'bg-accent-500/10', text: 'text-accent-400', ring: 'text-accent-500' },
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
                <p className="text-xl font-display font-bold text-white">{value}</p>
              </div>
            ) : (
              <>
                <p className="text-xl font-display font-bold text-white">{value}</p>
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

function StorageTrendsChart({ data, loading }: StorageTrendsChartProps) {
  if (loading || data.length < 2) return null;

  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const values = data.map((s) => s.totalSize);
  const minVal = Math.min(...values) * 0.95;
  const maxVal = Math.max(...values) * 1.05;
  const range = maxVal - minVal || 1;

  const points = data.map((s, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartW;
    const y = padding.top + chartH - ((s.totalSize - minVal) / range) * chartH;
    return { x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaD = pathD + ` L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`;

  // Y-axis labels
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
    const val = minVal + range * pct;
    return {
      y: padding.top + chartH - pct * chartH,
      label: formatBytes(val),
    };
  });

  // X-axis labels (show first, middle, last)
  const xLabels = [0, Math.floor(data.length / 2), data.length - 1]
    .filter((idx, _, arr) => arr.indexOf(idx) === arr.lastIndexOf(idx) || idx === arr[arr.indexOf(idx)])
    .map((idx) => ({
      x: padding.left + (idx / (data.length - 1)) * chartW,
      label: new Date(data[idx].capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    }));

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-accent-500/10">
          <TrendingUp className="w-5 h-5 text-accent-400" />
        </div>
        <div>
          <h2 className="text-lg font-display font-semibold text-white">Storage Trends</h2>
          <p className="text-sm text-surface-500">Total library size over the last 30 days</p>
        </div>
      </div>

      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Grid lines */}
          {yLabels.map((yl, i) => (
            <g key={i}>
              <line x1={padding.left} y1={yl.y} x2={padding.left + chartW} y2={yl.y} stroke="currentColor" strokeOpacity={0.08} />
              <text x={padding.left - 8} y={yl.y + 4} textAnchor="end" className="fill-surface-500" fontSize="10">{yl.label}</text>
            </g>
          ))}

          {/* X-axis labels */}
          {xLabels.map((xl, i) => (
            <text key={i} x={xl.x} y={height - 6} textAnchor="middle" className="fill-surface-500" fontSize="10">{xl.label}</text>
          ))}

          {/* Area fill */}
          <path d={areaD} fill="url(#storageGradient)" />

          {/* Line */}
          <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round" />

          {/* Gradient definition */}
          <defs>
            <linearGradient id="storageGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Data points */}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill="#38bdf8" stroke="#0f172a" strokeWidth="1.5" />
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 mt-4 text-xs text-surface-400">
        <div className="flex items-center gap-2">
          <Film className="w-3.5 h-3.5 text-violet-400" />
          <span>Movies: {formatBytes(data[data.length - 1].movieSize)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Tv className="w-3.5 h-3.5 text-emerald-400" />
          <span>TV Shows: {formatBytes(data[data.length - 1].showSize)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-accent-400" />
          <span>Total: {formatBytes(data[data.length - 1].totalSize)}</span>
        </div>
      </div>
    </div>
  );
}

interface DiskCardProps {
  disk: UnraidDisk;
  index: number;
}

function DiskCard({ disk, index }: DiskCardProps) {
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
      className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30 hover:border-surface-600/50 transition-all animate-fade-up opacity-0"
      style={{
        animationDelay: `${index * 50}ms`,
        animationFillMode: 'forwards'
      }}
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
