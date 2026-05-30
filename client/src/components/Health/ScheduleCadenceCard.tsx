import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, ScanSearch, Loader2 } from 'lucide-react';
import {
  useScanCadence,
  useScanStatus,
  useTriggerScan,
  queryKeys,
} from '@/hooks/useApi';
import { useToast } from '@/components/common/Toast';
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

// Cron → plain-English label. Handles the common 5-field patterns and falls
// back to a readable phrase rather than ever showing raw cron syntax.
const CRON_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clockLabel(hour: number, minute: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

function formatSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 'Custom schedule';
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];

  // Every N minutes  (*/N * * * *)
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = min.slice(2);
    return n === '1' ? 'Every minute' : `Every ${n} minutes`;
  }
  // Every hour  (0 * * * *)  /  Every N hours  (0 */N * * *)
  if (min === '0' && dom === '*' && mon === '*' && dow === '*') {
    if (hour === '*') return 'Every hour';
    if (hour.startsWith('*/')) {
      const n = hour.slice(2);
      return n === '1' ? 'Every hour' : `Every ${n} hours`;
    }
  }

  // Fixed time-of-day patterns need numeric minute + hour.
  const m = Number(min);
  const h = Number(hour);
  const fixedTime = Number.isInteger(m) && Number.isInteger(h) && min !== '*' && hour !== '*';

  if (fixedTime) {
    const at = clockLabel(h, m);
    // Daily  (M H * * *)
    if (dom === '*' && mon === '*' && dow === '*') return `Daily at ${at}`;
    // Weekly on a single weekday  (M H * * D)
    if (dom === '*' && mon === '*' && /^[0-6]$/.test(dow)) {
      return `Every ${CRON_DAYS[Number(dow)]} at ${at}`;
    }
    // Monthly on a day-of-month  (M H DOM * *)
    if (mon === '*' && dow === '*' && /^\d{1,2}$/.test(dom)) {
      return `Monthly on day ${dom} at ${at}`;
    }
  }

  return 'Custom schedule';
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

  // ---- manual "Scan now" ----
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const triggerScan = useTriggerScan();
  const [scanning, setScanning] = useState(false);
  const { data: scanStatus } = useScanStatus(scanning);

  const runScan = async () => {
    if (scanning || triggerScan.isPending) return;
    try {
      await triggerScan.mutateAsync();
      setScanning(true);
      addToast({ type: 'info', title: 'Scan started', message: 'Checking your library against all enabled rules…' });
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Could not start the scan.';
      addToast({ type: 'error', title: 'Scan failed to start', message });
    }
  };

  // When the scan we kicked off finishes, refresh the chart + header and notify.
  useEffect(() => {
    if (scanning && scanStatus && !scanStatus.isRunning) {
      setScanning(false);
      queryClient.invalidateQueries({ queryKey: ['scan', 'cadence'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.healthStatus });
      addToast({ type: 'success', title: 'Scan complete', message: 'The schedule chart has been updated.' });
    }
  }, [scanning, scanStatus, queryClient, addToast]);

  const isScanning = scanning || triggerScan.isPending;

  // The chart fills its container: we drive the viewBox width from the measured
  // body width so 1 viewBox unit = 1 CSS px. That keeps a fixed height and crisp
  // text (no aspect-ratio scaling/stretch) however wide the card's column gets.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- chart geometry (viewBox units = CSS px) ----
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

  // The chart always returns 14 days. Bars represent files actually pruned, so we
  // only draw the chart once there's something to plot. Two empty cases are then
  // distinguished below: scans have run but nothing's been pruned yet (items are
  // queued, awaiting their grace period) vs. no scans at all.
  const hasPruned = days.some((d) => d.files > 0);
  const hasScans = days.some((d) => d.timed);
  const showChart = !loading && !cadenceLoading && hasPruned;
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
        <div className="sc-head-actions">
          <div className={'sc-run' + (scheduler.isRunning ? '' : ' paused')}>
            {scheduler.isRunning ? 'enabled' : 'paused'}
          </div>
          <button
            type="button"
            className="sc-scan-btn"
            onClick={runScan}
            disabled={isScanning}
            title="Scan now — check the library against all enabled rules"
            aria-label="Scan now"
          >
            {isScanning ? (
              <Loader2 className="sc-scan-spin" />
            ) : (
              <ScanSearch />
            )}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="sc-body" ref={bodyRef}>
        <div className="cad-cap">
          <span className="cad-cap-k">
            Files pruned <span className="cad-cap-em">per scan</span>
          </span>
          {hasPruned && (
            <span className="cad-cap-sub">
              avg {mean} · {n}d
            </span>
          )}
        </div>

        {!showChart ? (
          <div className="cad-empty">
            {loading || cadenceLoading ? (
              'Loading scan history…'
            ) : hasScans ? (
              // Scans have run, but nothing's been pruned in the window yet —
              // matched items are queued and delete only after their grace period.
              <div className="cad-empty-cta">
                <p className="cad-empty-title">No files pruned yet</p>
                <p className="cad-empty-sub">
                  Scans are running {formatSchedule(scheduler.scanSchedule).toLowerCase()}. Items
                  matching your rules are queued and will be pruned once their grace period passes —
                  this chart fills in as deletions happen.
                </p>
              </div>
            ) : (
              <div className="cad-empty-cta">
                <p className="cad-empty-title">No scans yet</p>
                <p className="cad-empty-sub">
                  Runs automatically {formatSchedule(scheduler.scanSchedule).toLowerCase()} — or run one
                  now to check your library against all enabled rules.
                </p>
                <button
                  type="button"
                  className="cad-scan-cta"
                  onClick={runScan}
                  disabled={isScanning}
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="sc-scan-spin" />
                      Scanning…
                    </>
                  ) : (
                    <>
                      <ScanSearch />
                      Scan now
                    </>
                  )}
                </button>
              </div>
            )}
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
                  className="cad-guide"
                  x1={x(hover.idx)}
                  y1={padT - 8}
                  x2={x(hover.idx)}
                  y2={baseY}
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
                  {hoveredRun.timed && (
                    <span className="cad-tip-time">{fmtTime(hoveredDate)}</span>
                  )}
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
                ) : hoveredRun.status === 'failed' ? (
                  <div className="cad-tip-state failed">Run failed — retried</div>
                ) : hoveredRun.flagged > 0 ? (
                  // Scanned and queued items, but the grace period delays the prune.
                  <div className="cad-tip-main">
                    <b>{hoveredRun.flagged}</b>
                    <span>flagged for deletion</span>
                  </div>
                ) : (
                  <div className="cad-tip-state skipped">
                    {hoveredRun.timed ? 'Nothing to prune' : 'No scan'}
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
