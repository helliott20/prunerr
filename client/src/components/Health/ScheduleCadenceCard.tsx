import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useScanCadence } from '@/hooks/useApi';
import type { ScanCadenceRun, SchedulerStatus } from '@/types';

interface ScheduleCadenceCardProps {
  scheduler: SchedulerStatus;
  loading?: boolean;
}

/* ---- formatters (compact, to match the design exactly) ---- */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function fmtDate(d: Date): string {
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${r}s` : `${r}s`;
}
function fmtRel(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const future = diff < 0;
  const a = Math.abs(diff);
  let v: string;
  if (a < 60) return 'just now';
  if (a < 3600) v = `${Math.round(a / 60)}m`;
  else if (a < 86400) v = `${Math.round(a / 3600)}h`;
  else v = `${Math.round(a / 86400)}d`;
  return future ? `in ${v}` : `${v} ago`;
}

// Cron → human label. Mirrors the original ScheduleInfoCard mapping.
function formatSchedule(cron: string): string {
  if (cron === '0 3 * * *') return 'Daily at 3:00 AM';
  if (cron === '0 4 * * *') return 'Daily at 4:00 AM';
  if (cron === '0 * * * *') return 'Every hour';
  if (cron.startsWith('*/')) {
    const minutes = cron.split(' ')[0]?.replace('*/', '');
    return `Every ${minutes} minutes`;
  }
  return cron;
}

// Live countdown to the next run. Ticks every second while a target exists.
function useCountdown(target: Date | null): string {
  const [, setTick] = useState(0);
  const t = target?.getTime() ?? null;
  useEffect(() => {
    if (t === null) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [t]);
  if (t === null) return '';
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h >= 1 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s`;
}

interface HoverState {
  idx: number;
  leftPx: number;
  topPx: number;
  arrowX: number;
}

export function ScheduleCadenceCard({ scheduler, loading }: ScheduleCadenceCardProps) {
  const { data: runs = [], isLoading: cadenceLoading } = useScanCadence(14);
  const [hover, setHover] = useState<HoverState | null>(null);

  const nextRun = scheduler.isRunning && scheduler.nextRun ? new Date(scheduler.nextRun) : null;
  const countdown = useCountdown(nextRun);

  // ---- chart geometry (viewBox units) ----
  const W = 340;
  const H = 152;
  const padT = 18;
  const padB = 28;
  const padL = 3;
  const padR = 3;

  const days = runs;
  const n = days.length;
  const okFiles = days.filter((d) => d.status === 'ok').map((d) => d.files);
  const maxF = Math.max(...okFiles, 1);
  const scaleMax = maxF * 1.14;
  const mean = okFiles.length
    ? Math.round(okFiles.reduce((a, b) => a + b, 0) / okFiles.length)
    : 0;

  const slot = (W - padL - padR) / (n + 1); // +1 reserves the right slot for the "next" ghost
  const x = (i: number) => padL + slot * (i + 0.5);
  const bw = Math.min(14, slot * 0.56);
  const baseY = H - padB; // 124
  const barH = (f: number) => (f / scaleMax) * (baseY - padT);
  const y = (f: number) => baseY - barH(f);
  const ghostX = x(n);
  const nowX = (x(n - 1) + ghostX) / 2;

  // Nearest-bar selection + tooltip placement, clamped to the card.
  const pick = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const localW = el.offsetWidth || rect.width;
    const px = ((clientX - rect.left) / localW) * W; // → viewBox units
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const TIPW = 176;
    const TIPH = 88;
    const GAP = 9;
    const PAD = 6;
    const barCenter = (x(best) / W) * localW;
    const maxLeft = localW - TIPW - PAD;
    const leftPx =
      maxLeft < PAD
        ? (localW - TIPW) / 2
        : Math.max(PAD, Math.min(maxLeft, barCenter - TIPW / 2));
    const arrowX = Math.max(15, Math.min(TIPW - 15, barCenter - leftPx));
    const card = el.closest('.sc-card');
    const roomAbove = card ? rect.top - card.getBoundingClientRect().top : 999;
    const topPx = Math.max(-(roomAbove - 4), -(TIPH + GAP)); // keep the top edge inside the card
    setHover({ idx: best, leftPx, topPx, arrowX });
  };

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => pick(e.clientX, e.currentTarget);
  // Touch: scrub with finger; keep the last reading visible after release.
  const handleTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    if (t) pick(t.clientX, e.currentTarget);
  };

  const showChart = !loading && !cadenceLoading && n > 0;
  const hoveredRun: ScanCadenceRun | undefined = hover ? days[hover.idx] : undefined;
  const hoveredDate = hoveredRun ? new Date(hoveredRun.date) : null;

  return (
    <div className="sc-card">
      {/* Header */}
      <div className="sc-head">
        <div className="sc-ico">
          <Clock className="w-[18px] h-[18px]" strokeWidth={2} />
        </div>
        <div className="sc-head-t">
          <div className="sc-title">Schedule</div>
          <div className="sc-sub">{formatSchedule(scheduler.scanSchedule)}</div>
        </div>
        <div className={'sc-run' + (scheduler.isRunning ? '' : ' paused')}>
          <span className="sc-run-dot" />
          {scheduler.isRunning ? 'running' : 'paused'}
        </div>
      </div>

      {/* Body */}
      <div className="sc-body">
        <div className="cad-cap">
          <span className="cad-cap-k">
            Files pruned <span className="cad-cap-em">per scan</span>
          </span>
          {n > 0 && (
            <span className="cad-cap-sub">
              avg {mean} · {n} run{n === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {!showChart ? (
          <div className="cad-empty">
            {loading || cadenceLoading ? 'Loading scan history…' : 'No scan history yet'}
          </div>
        ) : (
          <div
            className="cad-wrap"
            onMouseLeave={() => setHover(null)}
            onMouseMove={handleMove}
            onTouchStart={handleTouch}
            onTouchMove={handleTouch}
          >
            <svg viewBox={`0 0 ${W} ${H}`} className="cad-svg">
              <defs>
                <linearGradient id="cadFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#67e8f9" />
                  <stop offset="0.55" stopColor="#06b6d4" />
                  <stop offset="1" stopColor="#0a7d92" />
                </linearGradient>
                <linearGradient id="cadFillOn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#d9fbff" />
                  <stop offset="0.5" stopColor="#67e8f9" />
                  <stop offset="1" stopColor="#06b6d4" />
                </linearGradient>
              </defs>

              {/* gridlines */}
              {[0.5, 1].map((g, i) => {
                const gy = baseY - (g * (baseY - padT)) / 1.14;
                return (
                  <line
                    key={i}
                    x1={padL}
                    y1={gy}
                    x2={W - padR}
                    y2={gy}
                    stroke="rgba(148,163,184,0.06)"
                  />
                );
              })}

              {/* mean reference */}
              {mean > 0 && (
                <>
                  <line
                    x1={padL}
                    y1={y(mean)}
                    x2={x(n - 1) + bw / 2 + 2}
                    y2={y(mean)}
                    stroke="rgba(148,163,184,0.28)"
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                  <text x={padL + 1} y={y(mean) - 4} className="cad-mean">
                    avg
                  </text>
                </>
              )}

              {/* bars */}
              {days.map((d, i) => {
                const active = hover?.idx === i;
                const dim = hover !== null && !active;
                const bx = x(i) - bw / 2;
                if (d.status === 'ok') {
                  const h = Math.max(4, barH(d.files));
                  const by = baseY - h;
                  return (
                    <g key={i} style={{ opacity: dim ? 0.28 : 1, transition: 'opacity .16s' }}>
                      <rect
                        className={'cad-bar' + (active ? ' on' : '')}
                        style={{ animationDelay: `${i * 36}ms` }}
                        x={bx}
                        y={by}
                        width={bw}
                        height={h}
                        rx={3.5}
                        fill={active ? 'url(#cadFillOn)' : 'url(#cadFill)'}
                      />
                    </g>
                  );
                }
                // skipped / failed → baseline stub + marker dot
                const col = d.status === 'failed' ? '#f43f5e' : '#475569';
                return (
                  <g key={i} style={{ opacity: dim ? 0.28 : 1, transition: 'opacity .16s' }}>
                    <rect
                      className="cad-bar"
                      style={{ animationDelay: `${i * 36}ms` }}
                      x={bx}
                      y={baseY - 3}
                      width={bw}
                      height={3}
                      rx={1.5}
                      fill={col}
                    />
                    <circle
                      cx={x(i)}
                      cy={baseY - 9}
                      r={2.4}
                      fill="none"
                      stroke={col}
                      strokeWidth="1.3"
                      opacity="0.9"
                    />
                  </g>
                );
              })}

              {/* hover guide */}
              {hover && (
                <line
                  x1={x(hover.idx)}
                  y1={padT - 8}
                  x2={x(hover.idx)}
                  y2={baseY}
                  stroke="#67e8f9"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  opacity="0.35"
                />
              )}

              {/* baseline */}
              <line
                x1={padL}
                y1={baseY + 0.5}
                x2={W - padR}
                y2={baseY + 0.5}
                stroke="rgba(148,163,184,0.16)"
              />

              {/* now divider + ghost next-run */}
              <line
                x1={nowX}
                y1={padT - 8}
                x2={nowX}
                y2={baseY}
                stroke="#f59e0b"
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.5"
              />
              <g className="cad-ghost">
                <rect
                  x={ghostX - bw / 2}
                  y={baseY - barH(mean)}
                  width={bw}
                  height={barH(mean)}
                  rx={3.5}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.3"
                  strokeDasharray="3 2.5"
                />
              </g>
              <text x={ghostX} y={baseY - barH(mean) - 6} className="cad-next-tag">
                next
              </text>

              {/* weekday axis */}
              {days.map((d, i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={baseY + 14}
                  className={'cad-dow' + (i === n - 1 ? ' on' : '')}
                >
                  {DOWL[new Date(d.date).getDay()]}
                </text>
              ))}
              <text x={ghostX} y={baseY + 14} className="cad-dow next">
                {DOWL[(new Date(days[n - 1]!.date).getDay() + 1) % 7]}
              </text>
            </svg>

            {/* tooltip */}
            {hover && hoveredRun && hoveredDate && (
              <div className="cad-tip" style={{ left: hover.leftPx, top: hover.topPx }}>
                <div className="cad-tip-head">
                  <span className={'cad-tip-dot ' + hoveredRun.status} />
                  <span className="cad-tip-date">{fmtDate(hoveredDate)}</span>
                  <span className="cad-tip-time">{fmtTime(hoveredDate)}</span>
                </div>
                {hoveredRun.status === 'ok' ? (
                  <>
                    <div className="cad-tip-main">
                      <b>{hoveredRun.files}</b>
                      <span>files pruned</span>
                    </div>
                    <div className="cad-tip-sub">
                      <span className="cad-tip-rec">{hoveredRun.gb} GB freed</span>
                      <span className="cad-tip-dur">{fmtDur(hoveredRun.dur)}</span>
                    </div>
                  </>
                ) : (
                  <div className={'cad-tip-state ' + hoveredRun.status}>
                    {hoveredRun.status === 'skipped' ? 'Nothing to prune' : 'Run failed — retried'}
                  </div>
                )}
                <span className="cad-tip-arrow" style={{ left: hover.arrowX }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sc-foot">
        <div className="sc-foot-cell">
          <div className="sc-foot-k">Next run</div>
          {nextRun ? (
            <div className="sc-foot-v amber">{countdown}</div>
          ) : (
            <div className="sc-foot-v never">Paused</div>
          )}
        </div>
        <div className="sc-foot-div" />
        <div className="sc-foot-cell">
          <div className="sc-foot-k">Last scan</div>
          {scheduler.lastScan ? (
            <div className="sc-foot-v">{fmtRel(scheduler.lastScan)}</div>
          ) : (
            <div className="sc-foot-v never">Never run</div>
          )}
        </div>
      </div>
    </div>
  );
}
