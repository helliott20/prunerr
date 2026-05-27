import { Modal } from '@/components/common/Modal';
import { useUnraidStats } from '@/hooks/useApi';
import { cn, formatBytes } from '@/lib/utils';
import {
  HardDrive, Thermometer, Loader2, ServerOff, Shield, Zap,
  Clock, ShieldCheck, TrendingUp, TrendingDown,
} from 'lucide-react';
import type { UnraidDisk, UnraidStats } from '@/types';

interface DiskStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function pctColor(pct: number) {
  if (pct > 90)
    return { ring: 'text-ruby-500', text: 'text-ruby-400', soft: 'bg-ruby-500/15' };
  if (pct > 75)
    return { ring: 'text-amber-500', text: 'text-amber-400', soft: 'bg-amber-500/15' };
  return { ring: 'text-accent-500', text: 'text-accent-text', soft: 'bg-accent-500/10' };
}
function tempClass(temp?: number) {
  if (temp == null) return 'text-surface-500';
  if (temp >= 50) return 'text-ruby-400';
  if (temp >= 42) return 'text-amber-400';
  if (temp >= 36) return 'text-emerald-400';
  return 'text-cyan-400';
}
function statusDotClass(status: string) {
  switch (status) {
    case 'active':  return 'bg-emerald-500';
    case 'standby': return 'bg-surface-500';
    case 'error':   return 'bg-ruby-500';
    default:        return 'bg-surface-500';
  }
}

function SectionLabel({
  children, right,
}: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-2xs font-bold uppercase tracking-[0.16em] text-surface-500 flex items-center gap-2">
        {children}
      </span>
      <span className="flex-1 h-px bg-gradient-to-r from-surface-700/60 to-transparent" />
      {right && <span className="text-2xs text-surface-500">{right}</span>}
    </div>
  );
}

// `stats.totalCapacity` is the *array* capacity (data + parity, no cache).
// Adding cacheUsed as a separate donut/bar segment requires a combined
// denominator that includes cache, otherwise cache appears to steal from
// the free segment.
function splitCapacity(stats: UnraidStats) {
  const arrayTotal = stats.totalCapacity ?? 0;
  const cacheSize = stats.disks
    .filter((d) => d.type === 'cache')
    .reduce((a, d) => a + d.size, 0);
  const cacheUsed = stats.disks
    .filter((d) => d.type === 'cache')
    .reduce((a, d) => a + d.used, 0);
  const arrayUsed = Math.max(0, (stats.usedCapacity ?? 0) - cacheUsed);
  const combinedTotal = arrayTotal + cacheSize;
  const free = Math.max(0, combinedTotal - arrayUsed - cacheUsed);
  return { arrayTotal, cacheSize, arrayUsed, cacheUsed, combinedTotal, free };
}

function CompositionDonut({ stats }: { stats: UnraidStats }) {
  const r = 60;
  const stroke = 14;
  const circ = 2 * Math.PI * r;
  const { arrayUsed, cacheUsed, combinedTotal, free } = splitCapacity(stats);
  const denom = combinedTotal > 0 ? combinedTotal : 1;

  const arrayP = arrayUsed / denom;
  const cacheP = cacheUsed / denom;
  const freeP  = free / denom;
  const color = pctColor(stats.usedPercent ?? 0);

  const segments = [
    { len: arrayP * circ, className: color.ring, start: 0, glow: true },
    { len: cacheP * circ, className: 'text-violet-500', start: arrayP * circ },
    { len: freeP * circ,  className: 'text-surface-700/85', start: (arrayP + cacheP) * circ },
  ];

  return (
    <div className="relative w-[160px] h-[160px] flex-shrink-0">
      <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90">
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx="80" cy="80" r={r}
            fill="none"
            strokeWidth={stroke}
            className={seg.className}
            stroke="currentColor"
            strokeDasharray={`${seg.len} ${circ - seg.len}`}
            strokeDashoffset={-seg.start}
            style={seg.glow ? { filter: 'drop-shadow(0 0 6px currentColor)' } : undefined}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className={cn('font-display font-bold leading-none tabular-nums -tracking-[0.03em] text-[34px]', color.text)}>
          {Math.round(stats.usedPercent ?? 0)}
          <span className="text-base opacity-75">%</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-surface-500 mt-1">
          used
        </div>
      </div>
    </div>
  );
}

function HeroStats({ stats }: { stats: UnraidStats }) {
  const color = pctColor(stats.usedPercent ?? 0);
  const arrayPalette: Record<string, { dot: string; text: string; pulse?: boolean }> = {
    Started: { dot: 'bg-emerald-500', text: 'text-emerald-400' },
    Stopped: { dot: 'bg-ruby-500', text: 'text-ruby-400' },
    Syncing: { dot: 'bg-amber-500', text: 'text-amber-400', pulse: true },
    Unknown: { dot: 'bg-surface-500', text: 'text-surface-400' },
  };
  const { dot: arrayDot, text: arrayText, pulse: arrayPulse } =
    arrayPalette[stats.arrayState] ?? arrayPalette.Unknown;

  return (
    <div className="flex flex-col gap-3.5 min-w-0">
      <div>
        <div className="text-2xs uppercase tracking-[0.14em] font-semibold text-surface-500">
          Used capacity
        </div>
        <div className="flex items-baseline gap-2 mt-1 flex-wrap">
          <span className="font-display font-bold text-[38px] leading-none -tracking-[0.025em] text-surface-50 tabular-nums">
            {formatBytes(stats.usedCapacity ?? 0)}
          </span>
          <span className="text-sm text-surface-500 tabular-nums">
            of {formatBytes(stats.totalCapacity ?? 0)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <MicroStat
          label="Free"
          value={<span className={color.text}>{formatBytes(stats.freeCapacity ?? 0)}</span>}
        />
        <MicroStat
          label="Array"
          value={
            <span className={cn('inline-flex items-center gap-1.5', arrayText)}>
              <span
                className={cn('w-1.5 h-1.5 rounded-full', arrayDot, arrayPulse && 'animate-pulse')}
                style={{ boxShadow: '0 0 6px currentColor' }}
              />
              {stats.arrayState}
            </span>
          }
        />
        <MicroStat label="Disks" value={<span className="text-surface-50">{stats.disks.length}</span>} />
        <MicroStat
          label="Parity"
          value={
            stats.health?.parityValid === false
              ? <span className="text-ruby-400">Invalid</span>
              : <span className="text-emerald-400">Protected</span>
          }
        />
      </div>
    </div>
  );
}
function MicroStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-[0.14em] font-semibold text-surface-500">{label}</div>
      <div className="font-display font-semibold text-[15px] text-surface-50 mt-0.5 leading-none tabular-nums flex items-center min-h-[20px]">
        {value}
      </div>
    </div>
  );
}

function TrendSparkline({ stats }: { stats: UnraidStats }) {
  const data = stats.trend;
  if (!data || data.length < 2) return null;

  const w = 220, h = 80, pad = 6;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const flat = max - min < 1e-9;
  const range = flat ? 1 : max - min;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2 - 4;
  // Center the line vertically when the series is flat instead of pinning it
  // to the bottom edge.
  const pts = data.map((v, i) => [
    pad + (i / (data.length - 1)) * innerW,
    flat ? pad + innerH / 2 : pad + (1 - (v - min) / range) * innerH,
  ] as [number, number]);
  const linePath = pts.map((p, i) => (i ? `L${p[0]},${p[1]}` : `M${p[0]},${p[1]}`)).join(' ');
  const areaPath = `${linePath} L${pts[pts.length-1][0]},${h - pad} L${pts[0][0]},${h - pad} Z`;
  const last = pts[pts.length - 1];
  const growth = stats.growthPerMonth ?? (data[data.length - 1] - data[data.length - 2]);
  const showGrowth = Math.abs(growth) >= 0.05;

  return (
    <div className="rounded-xl bg-surface-900/55 border border-surface-700/30 px-3 py-2.5 w-full sm:min-w-[240px]">
      <div className="flex justify-between items-baseline">
        <span className="text-2xs uppercase tracking-[0.14em] font-semibold text-surface-500">
          12-month trend
        </span>
        {showGrowth && (
          <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold',
            growth > 0 ? 'text-accent-text' : 'text-emerald-400')}>
            {growth > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {growth > 0 ? '+' : '−'}{Math.abs(growth).toFixed(1)} TB / mo
          </span>
        )}
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block mt-0.5">
        <defs>
          <linearGradient id="diskTrendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="rgb(245 158 11)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(245 158 11)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#diskTrendFill)" />
        <path d={linePath} fill="none" stroke="rgb(251 191 36)" strokeWidth="1.75"
              strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last[0]} cy={last[1]} r="3.5" fill="rgb(251 191 36)"
                style={{ filter: 'drop-shadow(0 0 4px rgb(245 158 11 / 0.7))' }} />
      </svg>
      <div className="flex justify-between text-[9.5px] font-mono text-surface-500">
        <span>{min.toFixed(1)} TB</span>
        <span>{max.toFixed(1)} TB</span>
      </div>
    </div>
  );
}

function CompositionBar({ stats }: { stats: UnraidStats }) {
  const { arrayUsed, cacheUsed, combinedTotal, free } = splitCapacity(stats);
  const denom = combinedTotal > 0 ? combinedTotal : 1;

  const arrayP = (arrayUsed / denom) * 100;
  const cacheP = (cacheUsed / denom) * 100;
  const freeP  = (free / denom) * 100;
  const color = pctColor(stats.usedPercent ?? 0);

  return (
    <div>
      <SectionLabel>Capacity composition</SectionLabel>
      <div className="h-[26px] rounded-[13px] bg-surface-800/60 border border-surface-700/30 p-[3px] flex gap-[3px] overflow-hidden">
        <CompSegment
          pct={arrayP}
          fill={cn('bg-gradient-to-r',
            (stats.usedPercent ?? 0) > 90 ? 'from-ruby-500 to-ruby-400'
            : (stats.usedPercent ?? 0) > 75 ? 'from-amber-500 to-amber-400'
            : 'from-accent-500 to-accent-400')}
          value={formatBytes(arrayUsed)}
          textOnDark
        />
        {cacheP > 0.3 && (
          <CompSegment
            pct={cacheP}
            fill="bg-violet-500"
            value={formatBytes(cacheUsed)}
            textOnDark
          />
        )}
        <CompSegment
          pct={freeP}
          fill="bg-transparent border border-dashed border-surface-600/60"
          value={formatBytes(free)}
        />
      </div>
      <div className="flex gap-4 mt-2 text-[11px] text-surface-400 flex-wrap">
        <LegendDot className={color.ring.replace('text-', 'bg-')} label={`Array · ${formatBytes(arrayUsed)}`} />
        {cacheUsed > 0 && (
          <LegendDot className="bg-violet-500" label={`Cache · ${formatBytes(cacheUsed)}`} />
        )}
        <LegendDot ring label={`Free · ${formatBytes(free)}`} />
      </div>
    </div>
  );
}
function CompSegment({
  pct, fill, value, textOnDark,
}: { pct: number; fill: string; value: string; textOnDark?: boolean }) {
  // Hide inline label on tiny segments where it can't fit cleanly; the legend
  // below the bar still shows the value.
  const showLabel = pct >= 6;
  return (
    <div
      className={cn(
        'rounded-[10px] flex items-center justify-center px-2 overflow-hidden whitespace-nowrap',
        'transition-[width] duration-700 ease-out',
        fill,
      )}
      style={{
        width: `${pct}%`,
        minWidth: pct > 0 ? 12 : 0,
        boxShadow: textOnDark && fill.includes('gradient') ? 'inset 0 0 12px rgb(255 255 255 / 0.15)' : undefined,
      }}
    >
      {showLabel && (
        <span
          className={cn(
            'text-[10px] font-semibold tabular-nums',
            textOnDark ? 'text-black/70' : 'text-surface-400',
          )}
          style={textOnDark ? { textShadow: '0 1px 0 rgb(255 255 255 / 0.15)' } : undefined}
        >
          {value}
        </span>
      )}
    </div>
  );
}
function LegendDot({ className, ring, label }: { className?: string; ring?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-surface-400">
      <span className={cn(
        'w-2 h-2 rounded-full',
        ring ? 'border border-dashed border-surface-600' : className,
      )} />
      {label}
    </span>
  );
}

function DriveTheatre({ stats }: { stats: UnraidStats }) {
  const disks = stats.disks.filter(d => d.type !== 'cache');
  if (!disks.length) return null;
  const sorted = [
    ...disks.filter(d => d.type === 'parity'),
    ...disks.filter(d => d.type === 'data'),
  ];

  return (
    <div>
      <SectionLabel right={`${disks.length} drives · ${formatBytes(stats.totalCapacity ?? 0)} raw`}>
        Array map
      </SectionLabel>
      <div className="overflow-x-auto rounded-2xl bg-surface-800/40 border border-surface-700/35">
        <div
          className="grid gap-2 px-3.5 pt-4 pb-3"
          style={{ gridTemplateColumns: `repeat(${sorted.length}, minmax(36px, 1fr))` }}
        >
          {sorted.map((d) => <DriveColumn key={d.device} disk={d} />)}
        </div>
      </div>
    </div>
  );
}
function DriveColumn({ disk }: { disk: UnraidDisk }) {
  const isParity = disk.type === 'parity';
  const c = pctColor(disk.usedPercent);
  const fillH = `${Math.max(2, disk.usedPercent)}%`;
  const fillClass = isParity ? 'bg-amber-400' : c.ring.replace('text-', 'bg-');
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0">
      <div className={cn('text-[9.5px] font-semibold font-mono inline-flex items-center gap-0.5', tempClass(disk.temp))}>
        <span className="w-1 h-1 rounded-full bg-current" style={{ boxShadow: '0 0 4px currentColor' }} />
        {disk.temp ?? '—'}°
      </div>
      <div className={cn(
        'relative w-full max-w-[28px] h-[110px] rounded-lg overflow-hidden',
        'bg-surface-900/70',
        isParity ? 'border border-accent-500/40' : 'border border-surface-700/50',
      )}
        style={{ boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.04)' }}
      >
        {[25, 50, 75].map((tick) => (
          <div key={tick} className="absolute left-0 right-0 h-px bg-surface-700/45"
               style={{ bottom: `${tick}%` }} />
        ))}
        <div
          className={cn('absolute left-0 right-0 bottom-0 transition-[height] duration-700 ease-out', fillClass)}
          style={{
            height: fillH,
            boxShadow: 'inset 0 1px 0 currentColor, 0 0 10px currentColor',
          }}
        />
        {disk.status === 'standby' && (
          <div className="absolute inset-0 pointer-events-none"
               style={{ background: 'repeating-linear-gradient(135deg, rgb(0 0 0 / 0) 0 4px, rgb(0 0 0 / 0.25) 4px 5px)' }} />
        )}
      </div>
      <div className={cn(
        'text-[9.5px] font-semibold tracking-[0.04em]',
        isParity ? 'text-accent-text' : 'text-surface-300',
      )}>
        {isParity ? 'PAR' : disk.name.replace('disk', '')}
      </div>
      <div className="text-[9px] font-mono text-surface-500 -mt-1">{formatBytes(disk.size)}</div>
    </div>
  );
}

function PoolSection({
  title, icon: Icon, iconColor, disks,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  disks: UnraidDisk[];
}) {
  if (!disks.length) return null;
  return (
    <div>
      <SectionLabel>
        <Icon className={cn('w-3.5 h-3.5', iconColor)} />
        {title}
        <span className="px-1.5 py-px rounded-full bg-surface-800/70 border border-surface-700/40 text-[9.5px] font-semibold normal-case tracking-normal text-surface-500">
          {disks.length}
        </span>
      </SectionLabel>
      <div className="flex flex-col gap-1.5">
        {disks.map((d) => <DiskRow key={d.device} disk={d} />)}
      </div>
    </div>
  );
}
function DiskRow({ disk }: { disk: UnraidDisk }) {
  const c = pctColor(disk.usedPercent);
  const heatGradient =
    disk.usedPercent > 90 ? 'rgb(244 63 94 / 0.15)' :
    disk.usedPercent > 75 ? 'rgb(245 158 11 / 0.15)' :
    'rgb(245 158 11 / 0.10)';
  return (
    <div
      className={cn(
        'grid items-center gap-2 sm:gap-3.5 px-2.5 sm:px-3.5 py-2.5 rounded-xl border border-surface-700/30',
        'bg-surface-800/40 grid-cols-[10px_minmax(70px,90px)_minmax(0,1fr)_50px_44px]',
        'sm:grid-cols-[14px_100px_minmax(0,1fr)_130px_70px]',
      )}
      style={{
        backgroundImage: `linear-gradient(90deg, ${heatGradient} 0%, transparent 30%)`,
      }}
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full',
          statusDotClass(disk.status),
          disk.status === 'active' && 'animate-pulse',
        )}
        style={disk.status === 'active' ? { boxShadow: '0 0 6px currentColor' } : undefined}
      />
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] font-semibold text-surface-50 truncate">{disk.name}</span>
        {(disk.filesystem || disk.status === 'standby') && (
          <span className="text-[9.5px] font-mono uppercase tracking-[0.04em] text-surface-500 truncate">
            {[disk.filesystem, disk.status === 'standby' ? 'idle' : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>
      <div>
        <div className="h-1.5 rounded-full bg-surface-700/60 overflow-hidden relative">
          <div
            className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out',
              c.ring.replace('text-', 'bg-'))}
            style={{
              width: `${disk.usedPercent}%`,
              boxShadow: '0 0 8px currentColor',
            }}
          />
        </div>
        <div className="flex justify-between mt-1 gap-2">
          <span className="text-[10px] text-surface-400 tabular-nums truncate">
            {formatBytes(disk.used)} <span className="text-surface-600">/ {formatBytes(disk.size)}</span>
          </span>
          <span className="hidden sm:inline text-[10px] text-surface-500 tabular-nums">{formatBytes(disk.free)} free</span>
        </div>
      </div>
      <div className="text-right">
        <span className={cn('font-display font-bold text-[14px] sm:text-[16px] tabular-nums -tracking-[0.01em]', c.text)}>
          {Math.round(disk.usedPercent)}
          <span className="text-[9px] sm:text-[10px] opacity-70">%</span>
        </span>
      </div>
      <div className="text-right">
        <span className={cn('inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold font-mono', tempClass(disk.temp))}>
          <Thermometer className="w-2.5 h-2.5 shrink-0" />
          {disk.temp != null ? `${disk.temp}°` : '—'}
        </span>
      </div>
    </div>
  );
}

function ForecastTiles({ stats }: { stats: UnraidStats }) {
  if (stats.forecastFullMonths == null && stats.health?.lastParityCheck == null) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {stats.forecastFullMonths != null && (
        <ForecastTile
          icon={<Clock className="w-4 h-4" />}
          label="Projected full"
          value={`${stats.forecastFullMonths} months`}
          sub={`at +${(stats.growthPerMonth ?? 0).toFixed(1)} TB/mo`}
        />
      )}
      {stats.health?.lastParityCheck && (
        <ForecastTile
          icon={<Shield className="w-4 h-4" />}
          label="Last parity check"
          value={stats.health.lastParityCheck}
          sub="0 errors"
          valueClass="text-emerald-400"
        />
      )}
      <ForecastTile
        icon={<ShieldCheck className="w-4 h-4" />}
        label="SMART"
        value={stats.health?.smartWarnings ? `${stats.health.smartWarnings} warnings` : 'All healthy'}
        sub={
          stats.health?.spinDownEligible && stats.health.spinDownEligible > 0
            ? `${stats.health.spinDownEligible} disks idle`
            : ''
        }
        valueClass={stats.health?.smartWarnings ? 'text-amber-400' : 'text-emerald-400'}
      />
    </div>
  );
}
function ForecastTile({
  icon, label, value, sub, valueClass,
}: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; valueClass?: string }) {
  return (
    <div className="p-3 rounded-xl bg-surface-800/40 border border-surface-700/30 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.14em] font-semibold text-surface-500">
        <span className="text-accent-text">{icon}</span>
        {label}
      </div>
      <div className={cn('font-display font-bold text-lg -tracking-[0.01em] tabular-nums', valueClass ?? 'text-surface-50')}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-surface-500">{sub}</div>}
    </div>
  );
}

export function DiskStatsModal({ isOpen, onClose }: DiskStatsModalProps) {
  const { data: stats, isLoading, error } = useUnraidStats();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Disk Statistics"
           description="Live storage breakdown from your Unraid server" size="3xl">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-accent-text animate-spin mb-3" />
          <p className="text-sm text-surface-400">Loading disk statistics…</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12">
          <ServerOff className="w-12 h-12 text-surface-500 mb-4" />
          <p className="text-sm font-medium text-surface-300 mb-2">Unable to load disk statistics</p>
          <p className="text-xs text-surface-500 text-center max-w-sm">
            {error instanceof Error ? error.message : 'An error occurred'}
          </p>
        </div>
      ) : !stats?.configured ? (
        <div className="flex flex-col items-center justify-center py-12">
          <ServerOff className="w-12 h-12 text-surface-500 mb-4" />
          <p className="text-sm font-medium text-surface-300 mb-2">Unraid not configured</p>
          <p className="text-xs text-surface-500 text-center max-w-sm">
            Configure your Unraid connection in Settings to view detailed disk statistics.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div
            className={cn(
              'flex flex-col sm:flex-row items-center gap-5 sm:gap-6 p-4 sm:p-5 rounded-2xl relative overflow-hidden',
              'bg-gradient-to-br from-surface-800/60 to-surface-800/25 border border-surface-700/40',
            )}
          >
            <div className="absolute inset-x-0 top-0 h-40 pointer-events-none"
                 style={{ background: 'radial-gradient(80% 100% at 50% 0%, rgb(245 158 11 / 0.08), transparent 70%)' }} />
            <CompositionDonut stats={stats} />
            <div className="flex-1 w-full min-w-0">
              <HeroStats stats={stats} />
            </div>
            {stats.trend && stats.trend.length >= 2 && (
              <div className="w-full sm:w-[240px] sm:flex-shrink-0">
                <TrendSparkline stats={stats} />
              </div>
            )}
          </div>

          <CompositionBar stats={stats} />

          <DriveTheatre stats={stats} />

          <PoolSection title="Parity" icon={Shield} iconColor="text-amber-400"
            disks={stats.disks.filter(d => d.type === 'parity')} />
          <PoolSection title="Array"  icon={HardDrive} iconColor="text-accent-text"
            disks={stats.disks.filter(d => d.type === 'data')} />
          <PoolSection title="Cache"  icon={Zap} iconColor="text-violet-400"
            disks={stats.disks.filter(d => d.type === 'cache')} />

          <ForecastTiles stats={stats} />

          {stats.lastUpdated && (
            <p className="text-2xs text-surface-600 text-center pt-1">
              Updated {new Date(stats.lastUpdated).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
