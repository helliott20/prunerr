import { Modal } from '@/components/common/Modal';
import { useUnraidStats } from '@/hooks/useApi';
import { formatBytes, cn } from '@/lib/utils';
import {
  HardDrive,
  Thermometer,
  Loader2,
  ServerOff,
  Shield,
  Zap,
} from 'lucide-react';
import type { UnraidDisk } from '@/types';

interface DiskStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function DiskRow({ disk, index }: { disk: UnraidDisk; index: number }) {
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
      className="p-3.5 rounded-xl bg-surface-800/40 border border-surface-700/30 animate-fade-up opacity-0"
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'forwards' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', getStatusColor(disk.status))} />
          <span className="text-sm font-medium text-white">{disk.name}</span>
          {disk.filesystem && (
            <span className="text-2xs text-surface-600 font-mono">{disk.filesystem}</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {disk.temp !== undefined && (
            <div className="flex items-center gap-1">
              <Thermometer className={cn('w-3 h-3', getTempColor(disk.temp))} />
              <span className={cn('text-xs font-medium tabular-nums', getTempColor(disk.temp))}>
                {disk.temp}°C
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-surface-700/60 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', getBarColor(disk.usedPercent))}
          style={{ width: `${Math.round(disk.usedPercent)}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-2xs text-surface-400 tabular-nums">
          {formatBytes(disk.used)} <span className="text-surface-600">/ {formatBytes(disk.size)}</span>
        </span>
        <span className="text-2xs text-surface-500 tabular-nums">
          {formatBytes(disk.free)} free
        </span>
      </div>
    </div>
  );
}

function DiskSection({
  title,
  icon: Icon,
  iconColor,
  disks,
  startIndex,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  disks: UnraidDisk[];
  startIndex: number;
}) {
  if (disks.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon className={cn('w-3.5 h-3.5', iconColor)} />
        <h3 className="text-sm font-medium text-surface-300">{title}</h3>
        <span className="text-2xs text-surface-600">({disks.length})</span>
      </div>
      <div className="space-y-2">
        {disks.map((disk, i) => (
          <DiskRow key={disk.device} disk={disk} index={startIndex + i} />
        ))}
      </div>
    </div>
  );
}

export function DiskStatsModal({ isOpen, onClose }: DiskStatsModalProps) {
  const { data: stats, isLoading, error } = useUnraidStats();

  const dataDisks = stats?.disks?.filter((d) => d.type === 'data') || [];
  const cacheDisks = stats?.disks?.filter((d) => d.type === 'cache') || [];
  const parityDisks = stats?.disks?.filter((d) => d.type === 'parity') || [];

  const arrayStateColors: Record<string, { text: string; dot: string }> = {
    Started: { text: 'text-emerald-400', dot: 'bg-emerald-500' },
    Stopped: { text: 'text-ruby-400', dot: 'bg-ruby-500' },
    Syncing: { text: 'text-amber-400', dot: 'bg-amber-500 animate-pulse' },
    Unknown: { text: 'text-surface-400', dot: 'bg-surface-500' },
  };

  const ringRadius = 52;
  const circumference = 2 * Math.PI * ringRadius;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Disk Statistics"
      description="Detailed storage information from Unraid"
      size="2xl"
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-accent-400 animate-spin mb-3" />
          <p className="text-sm text-surface-400">Loading disk statistics...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12">
          <ServerOff className="w-12 h-12 text-surface-500 mb-4" />
          <p className="text-sm font-medium text-surface-300 mb-2">
            Unable to load disk statistics
          </p>
          <p className="text-xs text-surface-500 text-center max-w-sm">
            {error instanceof Error ? error.message : 'An error occurred'}
          </p>
        </div>
      ) : !stats?.configured ? (
        <div className="flex flex-col items-center justify-center py-12">
          <ServerOff className="w-12 h-12 text-surface-500 mb-4" />
          <p className="text-sm font-medium text-surface-300 mb-2">
            Unraid not configured
          </p>
          <p className="text-xs text-surface-500 text-center max-w-sm">
            Configure your Unraid connection in Settings to view detailed disk
            statistics.
          </p>
        </div>
      ) : (
        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
          {/* Hero: Ring Chart + Stats */}
          <div className="flex items-center gap-6 p-5 rounded-2xl bg-surface-800/30 border border-surface-700/20">
            {/* Ring Chart */}
            <div className="relative w-[130px] h-[130px] flex-shrink-0">
              <svg className="w-[130px] h-[130px] -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60" cy="60" r={ringRadius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-surface-700/40"
                />
                <circle
                  cx="60" cy="60" r={ringRadius}
                  fill="none"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className={cn(
                    stats.usedPercent > 90 ? 'text-ruby-500' : stats.usedPercent > 75 ? 'text-amber-500' : 'text-accent-500'
                  )}
                  stroke="currentColor"
                  strokeDasharray={`${circumference}`}
                  strokeDashoffset={`${circumference * (1 - stats.usedPercent / 100)}`}
                  style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={cn(
                  'text-2xl font-display font-bold',
                  stats.usedPercent > 90 ? 'text-ruby-400' : stats.usedPercent > 75 ? 'text-amber-400' : 'text-accent-400'
                )}>
                  {Math.round(stats.usedPercent)}%
                </span>
                <span className="text-2xs text-surface-500">used</span>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xs text-surface-500 uppercase tracking-wider mb-1">Array</p>
                <div className="flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full', arrayStateColors[stats.arrayState]?.dot || 'bg-surface-500')} />
                  <span className={cn('text-sm font-semibold', arrayStateColors[stats.arrayState]?.text || 'text-surface-400')}>
                    {stats.arrayState}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-2xs text-surface-500 uppercase tracking-wider mb-1">Disks</p>
                <p className="text-sm font-semibold text-white">{stats.disks.length}</p>
              </div>
              <div>
                <p className="text-2xs text-surface-500 uppercase tracking-wider mb-1">Used</p>
                <p className="text-sm font-semibold text-white">{formatBytes(stats.usedCapacity)}</p>
              </div>
              <div>
                <p className="text-2xs text-surface-500 uppercase tracking-wider mb-1">Free</p>
                <p className={cn(
                  'text-sm font-semibold',
                  stats.usedPercent > 90 ? 'text-ruby-400' : stats.usedPercent > 75 ? 'text-amber-400' : 'text-accent-400'
                )}>
                  {formatBytes(stats.freeCapacity)}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-2xs text-surface-500 uppercase tracking-wider mb-1">Total Capacity</p>
                <p className="text-sm font-semibold text-white">{formatBytes(stats.totalCapacity)}</p>
              </div>
            </div>
          </div>

          {/* Disk Sections */}
          <DiskSection title="Parity" icon={Shield} iconColor="text-amber-400" disks={parityDisks} startIndex={0} />
          <DiskSection title="Array" icon={HardDrive} iconColor="text-accent-400" disks={dataDisks} startIndex={parityDisks.length} />
          <DiskSection title="Cache" icon={Zap} iconColor="text-violet-400" disks={cacheDisks} startIndex={parityDisks.length + dataDisks.length} />

          {/* Last Updated */}
          {stats.lastUpdated && (
            <p className="text-2xs text-surface-600 text-center pt-2">
              Updated {new Date(stats.lastUpdated).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
