import { HardDrive, TrendingUp, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, formatBytes } from '@/lib/utils';
import type { UnraidStats } from '@/types';

interface StorageWidgetProps {
  stats: UnraidStats | undefined;
  onClick: () => void;
}

export function StorageWidget({ stats, onClick }: StorageWidgetProps) {
  const { t } = useTranslation('layout');
  const hasData =
    !!stats?.configured &&
    typeof stats.totalCapacity === 'number' &&
    stats.totalCapacity > 0 &&
    typeof stats.usedCapacity === 'number' &&
    typeof stats.freeCapacity === 'number';

  if (!hasData) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'w-full p-4 rounded-xl text-left',
          'bg-surface-800/40 border border-surface-700/30',
          'transition-all duration-200 cursor-pointer',
          'hover:bg-surface-800/60 hover:border-surface-600/50',
          'focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:ring-offset-2 focus:ring-offset-surface-900',
        )}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-surface-700/50">
            <HardDrive className="w-4 h-4 text-surface-400" />
          </div>
          <div>
            <p className="text-xs font-medium text-surface-300">{t('storage.label', 'Storage')}</p>
            <p className="text-2xs text-surface-500">{t('storage.connectPrompt', 'Connect Unraid to monitor')}</p>
          </div>
        </div>
      </button>
    );
  }

  const total = stats.totalCapacity;
  const used = stats.usedCapacity;
  const free = stats.freeCapacity;
  const pct = stats.usedPercent ?? 0;

  const disks = stats.disks ?? [];
  const cacheSize = disks
    .filter((d) => d.type === 'cache')
    .reduce((a, d) => a + d.size, 0);
  const cacheUsed = disks
    .filter((d) => d.type === 'cache')
    .reduce((a, d) => a + d.used, 0);
  // Combined denominator so array+cache+free sum visually to 100%.
  const combinedTotal = total + cacheSize;
  const arrayUsed = Math.max(0, used - cacheUsed);

  const arrayPct = combinedTotal > 0 ? (arrayUsed / combinedTotal) * 100 : 0;
  const cachePct = combinedTotal > 0 ? (cacheUsed / combinedTotal) * 100 : 0;

  const growthPerMonth =
    typeof stats.growthPerMonth === 'number' ? stats.growthPerMonth : null;

  const ringClass =
    pct > 90 ? 'text-ruby-500' : pct > 75 ? 'text-amber-500' : 'text-accent-500';
  const textClass =
    pct > 90 ? 'text-ruby-400' : pct > 75 ? 'text-amber-400' : 'text-accent-text';

  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative w-full p-3.5 rounded-2xl text-left',
        'bg-gradient-to-b from-surface-800/55 to-surface-800/30',
        'border border-surface-700/45',
        'transition-all duration-200 cursor-pointer',
        'hover:from-surface-800/70 hover:to-surface-800/40 hover:border-surface-600/60',
        'focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:ring-offset-2 focus:ring-offset-surface-900',
        'shadow-[0_1px_0_rgb(255_255_255/0.02)_inset,0_8px_24px_-16px_rgb(0_0_0/0.4)]',
      )}
    >
      {growthPerMonth !== null && Math.abs(growthPerMonth) >= 0.05 && (
        <div
          className={cn(
            'absolute top-2.5 right-2.5 flex items-center gap-1',
            'px-1.5 py-0.5 rounded-full',
            'bg-surface-700/55 border border-surface-600/40',
            'text-[9.5px] font-semibold tabular-nums text-surface-300',
          )}
          title={
            growthPerMonth > 0
              ? t('storage.growingTooltip', 'Growing {{amount}} TB / month', { amount: Math.abs(growthPerMonth).toFixed(1) })
              : t('storage.shrinkingTooltip', 'Shrinking {{amount}} TB / month', { amount: Math.abs(growthPerMonth).toFixed(1) })
          }
        >
          {growthPerMonth > 0 ? (
            <TrendingUp className="w-2.5 h-2.5" />
          ) : (
            <TrendingDown className="w-2.5 h-2.5" />
          )}
          {growthPerMonth > 0 ? '+' : '−'}
          {Math.abs(growthPerMonth).toFixed(1)} TB/mo
        </div>
      )}

      <div className="relative flex items-center gap-3.5">
        <div className="relative w-[60px] h-[60px] flex-shrink-0">
          <svg
            className="relative w-[60px] h-[60px] -rotate-90 overflow-visible"
            viewBox="0 0 56 56"
          >
            <circle
              cx="28" cy="28" r={r}
              fill="none"
              strokeWidth="5"
              className="text-surface-700/70"
              stroke="currentColor"
            />
            <circle
              cx="28" cy="28" r={r}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              className="text-surface-600/90"
              stroke="currentColor"
              strokeDasharray={`1.5 ${circ}`}
              strokeDashoffset={-circ * 0.75}
            />
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
          <div className={cn(
            'absolute inset-0 flex items-center justify-center font-display font-bold text-sm tabular-nums',
            textClass,
          )}>
            {Math.round(pct)}
            <span className="text-[9px] ml-px opacity-75">%</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-surface-500">
            {t('storage.label', 'Storage')}
          </p>
          <p className="font-display font-bold text-[22px] leading-none text-surface-50 tabular-nums -tracking-[0.02em] mt-0.5">
            {formatBytes(used)}
          </p>
          <p className="text-[11px] text-surface-500 mt-0.5 tabular-nums">
            {t('storage.ofTotal', 'of {{total}}', { total: formatBytes(total) })}
          </p>

          <div className="mt-2 h-1 w-full rounded-full bg-surface-700/60 overflow-hidden flex">
            <div
              className={cn('h-full bg-gradient-to-r transition-[width] duration-700 ease-out',
                pct > 90 ? 'from-ruby-500 to-ruby-400'
                : pct > 75 ? 'from-amber-500 to-amber-400'
                : 'from-accent-500 to-accent-400')}
              style={{ width: `${arrayPct}%` }}
            />
            {cachePct > 0.5 && (
              <div
                className="h-full bg-violet-500 ml-px"
                style={{ width: `${cachePct}%` }}
              />
            )}
          </div>
          <p className={cn('text-[10.5px] font-semibold mt-1.5 tabular-nums', textClass)}>
            {t('storage.freeSuffix', '{{size}} free', { size: formatBytes(free) })}
          </p>
        </div>
      </div>
    </button>
  );
}
