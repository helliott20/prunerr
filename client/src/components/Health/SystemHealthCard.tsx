import { Activity, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ServiceStatusIndicator } from './ServiceStatusIndicator';
import type { ServiceHealthStatus } from '@/types';

interface SystemHealthCardProps {
  services: ServiceHealthStatus[];
  overall: 'healthy' | 'degraded' | 'unhealthy';
  loading?: boolean;
  isFetching?: boolean;
}

export function SystemHealthCard({ services, overall, loading, isFetching }: SystemHealthCardProps) {
  const overallConfig = {
    healthy: {
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      label: 'All Systems Operational',
    },
    degraded: {
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      label: 'Partial Outage',
    },
    unhealthy: {
      color: 'text-ruby-400',
      bgColor: 'bg-ruby-500/10',
      label: 'Systems Unavailable',
    },
  };

  const config = overallConfig[overall];

  // Sort services: configured first, then alphabetically
  const sortedServices = [...services].sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return a.service.localeCompare(b.service);
  });

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn('p-1.5 rounded-lg', config.bgColor)}>
            {overall === 'unhealthy' ? (
              <AlertCircle className={cn('w-4 h-4', config.color)} />
            ) : (
              <Activity className={cn('w-4 h-4', config.color)} />
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Service Status</h3>
            <p className={cn('text-xs', config.color)}>{config.label}</p>
          </div>
        </div>
        {isFetching && !loading && (
          <span className="text-xs text-surface-500 animate-pulse">Refreshing...</span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton-shimmer h-6 rounded" />
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {sortedServices.map((service) => (
            <ServiceStatusIndicator
              key={service.service}
              name={service.service}
              configured={service.configured}
              connected={service.connected}
              error={service.error}
              responseTimeMs={service.responseTimeMs}
              loading={isFetching}
            />
          ))}
        </div>
      )}
    </div>
  );
}
