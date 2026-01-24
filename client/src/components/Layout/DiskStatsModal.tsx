import { Modal } from '@/components/common/Modal';
import { useUnraidStats } from '@/hooks/useApi';
import { formatBytes, cn } from '@/lib/utils';
import {
  HardDrive,
  Server,
  Thermometer,
  AlertCircle,
  CheckCircle,
  Loader2,
  ServerOff,
  Shield,
  Database,
} from 'lucide-react';
import type { UnraidDisk } from '@/types';

interface DiskStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function DiskRow({ disk }: { disk: UnraidDisk }) {
  const statusColors = {
    active: 'text-emerald-400',
    standby: 'text-amber-400',
    error: 'text-ruby-400',
    unknown: 'text-surface-400',
  };

  const statusIcons = {
    active: CheckCircle,
    standby: HardDrive,
    error: AlertCircle,
    unknown: HardDrive,
  };

  const StatusIcon = statusIcons[disk.status];

  return (
    <div className="flex items-center gap-4 p-3 rounded-xl bg-surface-800/40 border border-surface-700/30">
      <div className="p-2 rounded-lg bg-surface-700/50">
        <HardDrive className="w-4 h-4 text-surface-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{disk.name}</span>
          <StatusIcon className={cn('w-3.5 h-3.5', statusColors[disk.status])} />
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-surface-500">{disk.device}</span>
          {disk.filesystem && (
            <span className="text-xs text-surface-500">{disk.filesystem}</span>
          )}
        </div>
        <div className="mt-2">
          <div className="progress-bar h-1.5">
            <div
              className={cn(
                'progress-fill',
                disk.usedPercent > 90
                  ? 'bg-ruby-500'
                  : disk.usedPercent > 75
                    ? 'bg-amber-500'
                    : 'bg-accent-500'
              )}
              style={{ width: `${Math.round(disk.usedPercent)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-2xs text-surface-500">
              {formatBytes(disk.used)} / {formatBytes(disk.size)}
            </span>
            <span className="text-2xs text-surface-400">
              {formatBytes(disk.free)} free
            </span>
          </div>
        </div>
      </div>
      {disk.temp !== undefined && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-700/50">
          <Thermometer
            className={cn(
              'w-3.5 h-3.5',
              disk.temp > 50
                ? 'text-ruby-400'
                : disk.temp > 40
                  ? 'text-amber-400'
                  : 'text-emerald-400'
            )}
          />
          <span
            className={cn(
              'text-xs font-medium',
              disk.temp > 50
                ? 'text-ruby-400'
                : disk.temp > 40
                  ? 'text-amber-400'
                  : 'text-emerald-400'
            )}
          >
            {disk.temp}C
          </span>
        </div>
      )}
    </div>
  );
}

function DiskSection({
  title,
  icon: Icon,
  disks,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  disks: UnraidDisk[];
}) {
  if (disks.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-accent-400" />
        <h3 className="text-sm font-medium text-surface-300">{title}</h3>
        <span className="text-xs text-surface-500">({disks.length})</span>
      </div>
      <div className="space-y-2">
        {disks.map((disk) => (
          <DiskRow key={disk.device} disk={disk} />
        ))}
      </div>
    </div>
  );
}

export function DiskStatsModal({ isOpen, onClose }: DiskStatsModalProps) {
  const { data: stats, isLoading, error } = useUnraidStats();

  const dataDisks = stats?.disks.filter((d) => d.type === 'data') || [];
  const cacheDisks = stats?.disks.filter((d) => d.type === 'cache') || [];
  const parityDisks = stats?.disks.filter((d) => d.type === 'parity') || [];

  const arrayStateColors = {
    Started: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    Stopped: 'text-ruby-400 bg-ruby-500/10 border-ruby-500/30',
    Syncing: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    Unknown: 'text-surface-400 bg-surface-500/10 border-surface-500/30',
  };

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
          {/* Array State and Total Capacity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-accent-500/10">
                  <Server className="w-4 h-4 text-accent-400" />
                </div>
                <span className="text-sm font-medium text-surface-300">
                  Array State
                </span>
              </div>
              <span
                className={cn(
                  'inline-flex px-3 py-1 rounded-lg text-sm font-medium border',
                  arrayStateColors[stats.arrayState]
                )}
              >
                {stats.arrayState}
              </span>
            </div>
            <div className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-accent-500/10">
                  <Database className="w-4 h-4 text-accent-400" />
                </div>
                <span className="text-sm font-medium text-surface-300">
                  Total Capacity
                </span>
              </div>
              <p className="text-lg font-display font-bold text-white">
                {formatBytes(stats.totalCapacity)}
              </p>
            </div>
          </div>

          {/* Overall Usage */}
          <div className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-surface-300">
                Overall Usage
              </span>
              <span
                className={cn(
                  'text-sm font-medium',
                  stats.usedPercent > 90
                    ? 'text-ruby-400'
                    : stats.usedPercent > 75
                      ? 'text-amber-400'
                      : 'text-accent-400'
                )}
              >
                {Math.round(stats.usedPercent)}%
              </span>
            </div>
            <div className="progress-bar h-3">
              <div
                className={cn(
                  'progress-fill',
                  stats.usedPercent > 90
                    ? 'bg-ruby-500'
                    : stats.usedPercent > 75
                      ? 'bg-amber-500'
                      : 'bg-accent-500'
                )}
                style={{ width: `${Math.round(stats.usedPercent)}%` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-surface-500">
                {formatBytes(stats.usedCapacity)} used
              </span>
              <span className="text-xs text-accent-400 font-medium">
                {formatBytes(stats.freeCapacity)} free
              </span>
            </div>
          </div>

          {/* Parity Disks */}
          <DiskSection title="Parity Disks" icon={Shield} disks={parityDisks} />

          {/* Data Disks */}
          <DiskSection title="Data Disks" icon={HardDrive} disks={dataDisks} />

          {/* Cache Disks */}
          <DiskSection title="Cache Disks" icon={Database} disks={cacheDisks} />

          {/* Last Updated */}
          {stats.lastUpdated && (
            <p className="text-2xs text-surface-500 text-center pt-2">
              Last updated: {new Date(stats.lastUpdated).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
