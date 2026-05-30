import { Gauge } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import type { DashboardStats } from '@/types';

interface DiskPressureWidgetProps {
  stats: DashboardStats | undefined;
}

/**
 * Compact free-space gauge for the disk-pressure feature. Mirrors StorageWidget's
 * visual language but is driven by the real free-space fields from /api/stats
 * (statfs) rather than Unraid. Renders only when those fields are present.
 */
export function DiskPressureWidget({ stats }: DiskPressureWidgetProps) {
  const total = stats?.diskTotalBytes ?? null;
  const used = stats?.diskUsedBytes ?? null;
  const free = stats?.diskFreeBytes ?? null;
  const target = stats?.diskTargetBytes ?? null;

  if (total === null || used === null || free === null || total <= 0) {
    return null;
  }

  const severity = stats?.diskPressureSeverity ?? 'ok';
  const pct = (used / total) * 100;

  const ringClass =
    severity === 'critical' ? 'text-ruby-500' : severity === 'soft' ? 'text-amber-500' : 'text-accent-500';
  const textClass =
    severity === 'critical' ? 'text-ruby-400' : severity === 'soft' ? 'text-amber-400' : 'text-accent-text';

  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  // Target marker: the used% at which free space would hit the target line.
  const targetUsedPct = target !== null && total > 0 ? Math.max(0, Math.min(100, ((total - target) / total) * 100)) : null;

  return (
    <div
      className={cn(
        'w-full p-3.5 rounded-2xl text-left',
        'bg-gradient-to-b from-surface-800/55 to-surface-800/30',
        'border border-surface-700/45',
        'shadow-[0_1px_0_rgb(255_255_255/0.02)_inset,0_8px_24px_-16px_rgb(0_0_0/0.4)]',
      )}
    >
      <div className="relative flex items-center gap-3.5">
        <div className="relative w-[60px] h-[60px] flex-shrink-0">
          <svg className="relative w-[60px] h-[60px] -rotate-90 overflow-visible" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className="text-surface-700/70" stroke="currentColor" />
            {targetUsedPct !== null && (
              <circle
                cx="28" cy="28" r={r}
                fill="none"
                strokeWidth="5"
                strokeLinecap="round"
                className="text-surface-300/80"
                stroke="currentColor"
                strokeDasharray={`1.5 ${circ}`}
                strokeDashoffset={-circ * (targetUsedPct / 100)}
              />
            )}
            <circle
              cx="28" cy="28" r={r}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              className={ringClass}
              stroke="currentColor"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{
                transition: 'stroke-dashoffset 900ms cubic-bezier(0.4, 0, 0.2, 1)',
                filter: 'drop-shadow(0 0 3px currentColor)',
              }}
            />
          </svg>
          <div className={cn('absolute inset-0 flex items-center justify-center font-display font-bold text-sm tabular-nums', textClass)}>
            {Math.round(pct)}
            <span className="text-[9px] ml-px opacity-75">%</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-surface-500 flex items-center gap-1">
            <Gauge className="w-3 h-3" /> Free Space
          </p>
          <p className="font-display font-bold text-[22px] leading-none text-surface-50 tabular-nums -tracking-[0.02em] mt-0.5">
            {formatBytes(free)}
          </p>
          <p className="text-[11px] text-surface-500 mt-0.5 tabular-nums">free of {formatBytes(total)}</p>
          {target !== null && (
            <p className={cn('text-[10.5px] font-semibold mt-1.5 tabular-nums', textClass)}>
              {severity === 'ok' ? 'Above target' : severity === 'soft' ? 'Below target' : 'Critically low'} · keep {formatBytes(target)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
