import { Clock, Calendar, PlayCircle, AlertTriangle } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import type { SchedulerStatus } from '@/types';

interface ScheduleInfoCardProps {
  scheduler: SchedulerStatus;
  loading?: boolean;
}

export function ScheduleInfoCard({ scheduler, loading }: ScheduleInfoCardProps) {
  // Format the cron schedule for display
  const formatSchedule = (cron: string): string => {
    // Common patterns
    if (cron === '0 3 * * *') return 'Daily at 3:00 AM';
    if (cron === '0 4 * * *') return 'Daily at 4:00 AM';
    if (cron === '0 * * * *') return 'Every hour';
    if (cron.startsWith('*/')) {
      const minutes = cron.split(' ')[0]?.replace('*/', '');
      return `Every ${minutes} minutes`;
    }
    // Default: show raw cron
    return cron;
  };

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-accent-500/10">
          <Clock className="w-4 h-4 text-accent-400" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-white">Schedule</h3>
          <p className="text-xs text-surface-500">{formatSchedule(scheduler.scanSchedule)}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton-shimmer h-10 rounded" />
          <div className="skeleton-shimmer h-10 rounded" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Last Scan */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-800/50">
            <PlayCircle className="w-4 h-4 text-surface-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-surface-500">Last Scan</p>
              {scheduler.lastScan ? (
                <p className="text-sm text-surface-200 truncate">
                  {formatRelativeTime(scheduler.lastScan)}
                </p>
              ) : (
                <p className="text-sm text-surface-500 italic">Never run</p>
              )}
            </div>
          </div>

          {/* Next Run */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-800/50">
            <Calendar className="w-4 h-4 text-surface-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-surface-500">Next Scheduled</p>
              {scheduler.isRunning && scheduler.nextRun ? (
                <p className="text-sm text-surface-200 truncate">
                  {formatRelativeTime(scheduler.nextRun)}
                </p>
              ) : !scheduler.isRunning ? (
                <div className="flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="w-3 h-3" />
                  <span className="text-sm">Scheduler stopped</span>
                </div>
              ) : (
                <p className="text-sm text-surface-500 italic">Not scheduled</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
