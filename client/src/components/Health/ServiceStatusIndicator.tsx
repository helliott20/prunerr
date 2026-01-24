import { cn } from '@/lib/utils';

interface ServiceStatusIndicatorProps {
  name: string;
  configured: boolean;
  connected: boolean;
  error?: string;
  loading?: boolean;
  responseTimeMs?: number;
}

export function ServiceStatusIndicator({
  name,
  configured,
  connected,
  error,
  loading,
  responseTimeMs,
}: ServiceStatusIndicatorProps) {
  const status = !configured ? 'unconfigured' : connected ? 'connected' : 'disconnected';

  const statusConfig = {
    unconfigured: {
      dotColor: 'bg-surface-500',
      textColor: 'text-surface-400',
      label: 'Not configured',
    },
    connected: {
      dotColor: 'bg-emerald-500',
      textColor: 'text-emerald-400',
      label: responseTimeMs ? `${responseTimeMs}ms` : 'Connected',
    },
    disconnected: {
      dotColor: 'bg-ruby-500',
      textColor: 'text-ruby-400',
      label: error || 'Disconnected',
    },
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className={cn(
          'w-2 h-2 rounded-full flex-shrink-0 transition-colors',
          loading ? 'bg-amber-500 animate-pulse' : config.dotColor
        )}
      />
      <span className="text-sm text-surface-200 capitalize">{name}</span>
      <span className={cn('text-xs truncate', loading ? 'text-amber-400' : config.textColor)}>
        {loading ? 'Checking...' : config.label}
      </span>
    </div>
  );
}
