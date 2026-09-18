import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/common/Button';
import { useUnraidStats } from '@/hooks/useApi';
import { cn, formatBytes } from '@/lib/utils';
import type {
  DiskPressureSettings,
  PlexSyncSettings,
  ScheduleSettings,
} from '@/types';

import { PanelSection } from '../components/PanelSection';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsEmptyState } from '../components/SettingsEmptyState';
import { Toggle } from '../components/Toggle';
import type { PanelProps } from '../types';

const GB = 1024 ** 3;

/**
 * Staging defaults. These match what the card *displays* when a field has never
 * been set, so toggling "enabled" can never silently persist a different time
 * than the one on screen.
 */
const SCHEDULE_DEFAULTS: ScheduleSettings = {
  enabled: false,
  interval: 'daily',
  time: '03:00',
  dayOfWeek: 0,
  autoProcess: false,
};

const SYNC_DEFAULTS: PlexSyncSettings = {
  enabled: true,
  interval: 'daily',
  time: '02:00',
  dayOfWeek: 0,
};

const DAY_KEYS: Array<{ value: number; key: string; fallback: string }> = [
  { value: 0, key: 'schedule.days.sunday', fallback: 'Sunday' },
  { value: 1, key: 'schedule.days.monday', fallback: 'Monday' },
  { value: 2, key: 'schedule.days.tuesday', fallback: 'Tuesday' },
  { value: 3, key: 'schedule.days.wednesday', fallback: 'Wednesday' },
  { value: 4, key: 'schedule.days.thursday', fallback: 'Thursday' },
  { value: 5, key: 'schedule.days.friday', fallback: 'Friday' },
  { value: 6, key: 'schedule.days.saturday', fallback: 'Saturday' },
];

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export default function AutomationPanel({
  draft,
  onChange,
  fresh,
  mediaServer,
  registerSection,
}: PanelProps) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const { data: unraid } = useUnraidStats();
  const uid = useId();

  const schedule = draft.schedule;
  const sync = draft.plexSync;
  const dp: DiskPressureSettings = draft.diskPressure ?? {};

  // --- staging --------------------------------------------------------------

  const patchSchedule = (patch: Partial<ScheduleSettings>) =>
    onChange('schedule', { ...SCHEDULE_DEFAULTS, ...schedule, ...patch });

  const patchSync = (patch: Partial<PlexSyncSettings>) =>
    onChange('plexSync', { ...SYNC_DEFAULTS, ...sync, ...patch });

  const patchDisk = (patch: Partial<DiskPressureSettings>) =>
    onChange('diskPressure', { ...dp, ...patch });

  // --- derived values -------------------------------------------------------

  const scanEnabled = schedule?.enabled ?? SCHEDULE_DEFAULTS.enabled;
  const scanInterval = schedule?.interval ?? SCHEDULE_DEFAULTS.interval;
  const scanTime = schedule?.time ?? SCHEDULE_DEFAULTS.time;
  const scanDay = schedule?.dayOfWeek ?? 0;

  const syncEnabled = sync?.enabled ?? SYNC_DEFAULTS.enabled;
  const syncInterval = sync?.interval ?? SYNC_DEFAULTS.interval;
  const syncTime = sync?.time ?? SYNC_DEFAULTS.time;
  const syncDay = sync?.dayOfWeek ?? 0;

  const intervalOptions = [
    { value: 'hourly', label: t('schedule.intervals.hourly', 'Every hour (at :00)') },
    { value: 'daily', label: t('schedule.intervals.daily', 'Once per day') },
    { value: 'weekly', label: t('schedule.intervals.weekly', 'Once per week') },
  ];

  const shortInterval = (interval: 'hourly' | 'daily' | 'weekly') =>
    ({
      hourly: t('automation.intervalShort.hourly', 'hourly'),
      daily: t('automation.intervalShort.daily', 'daily'),
      weekly: t('automation.intervalShort.weekly', 'weekly'),
    })[interval];

  // First run leaves the sync dormant, so the scanning card must not claim a
  // schedule that will never fire.
  const syncScheduled = syncEnabled && !fresh;
  const syncSummary = syncScheduled
    ? t('automation.syncSummary', '{{time}} {{interval}}', {
        time: syncTime,
        interval: shortInterval(syncInterval),
      })
    : t('automation.notScheduled', 'Not scheduled');

  const dpEnabled = dp.enabled ?? false;
  const targetMode = dp.targetMode ?? 'percent';
  const targetValue = dp.targetValue ?? 10;
  const criticalValue = dp.criticalValue ?? 5;
  const unit = targetMode === 'absolute' ? 'GB' : '%';
  const formatTarget = (value: number) => (targetMode === 'absolute' ? `${value} GB` : `${value}%`);

  const disk = unraid?.configured ? unraid : undefined;
  const usedPercent = disk ? clamp(disk.usedCapacity > 0 ? disk.usedPercent : 0) : undefined;
  const freePercent = usedPercent === undefined ? undefined : 100 - usedPercent;

  const criticalPercent =
    targetMode === 'percent'
      ? criticalValue
      : disk && disk.totalCapacity > 0
        ? (criticalValue * GB * 100) / disk.totalCapacity
        : undefined;
  const markerPercent =
    usedPercent !== undefined && criticalPercent !== undefined
      ? clamp(100 - criticalPercent)
      : undefined;

  const paths = dp.paths ?? [];
  const monitoredPaths = paths.filter((path) => path.trim().length > 0);

  const deletionActions = [
    {
      value: 'unmonitor_and_delete',
      label: t('diskPressure.deletionActions.unmonitorAndDelete', 'Unmonitor & delete files'),
    },
    {
      value: 'delete_files_only',
      label: t('diskPressure.deletionActions.deleteFilesOnly', 'Delete files only'),
    },
    { value: 'full_removal', label: t('diskPressure.deletionActions.fullRemoval', 'Full removal') },
    {
      value: 'unmonitor_only',
      label: t('diskPressure.deletionActions.unmonitorOnly', 'Unmonitor only (keep files)'),
    },
  ];

  return (
    <>
      {fresh && (
        <SettingsEmptyState
          title={t('firstRun.automation.title', 'Waiting on a {{name}} connection', {
            name: mediaServer.name,
          })}
          body={t(
            'firstRun.automation.body',
            'You can set schedules now — they stay dormant until {{name}} is connected.',
            { name: mediaServer.name }
          )}
          action={
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={() => navigate('/settings?section=connections')}
            >
              {t('firstRun.automation.action', 'Go to Connections')}
            </Button>
          }
        />
      )}

      {/* ---------------- library sync ---------------- */}
      <PanelSection
        id="library-sync"
        register={registerSection}
        title={t('automation.librarySync.title', '{{name}} library sync', {
          name: mediaServer.name,
        })}
        description={t(
          'automation.librarySync.description',
          'Automatically pull new movies and shows from {{name}} into Prunerr',
          { name: mediaServer.name }
        )}
      >
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          <RowHeader
            title={t('automation.librarySync.enable', 'Automatic {{name}} sync', {
              name: mediaServer.name,
            })}
            description={t(
              'automation.librarySync.enableHint',
              'Refresh the library so new items appear without clicking “Sync Library”',
              { name: mediaServer.name }
            )}
            control={
              <Toggle
                checked={syncEnabled}
                onChange={(checked) => patchSync({ enabled: checked })}
                label={t('automation.librarySync.enable', 'Automatic {{name}} sync', {
                  name: mediaServer.name,
                })}
              />
            }
          />

          {syncEnabled && (
            <div
              className={cn(
                'grid gap-3',
                syncInterval === 'weekly' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
              )}
            >
              <Field id={`${uid}-sync-interval`} label={t('plexSync.intervalLabel', 'Sync Interval')}>
                <select
                  id={`${uid}-sync-interval`}
                  value={syncInterval}
                  onChange={(event) =>
                    patchSync({ interval: event.target.value as PlexSyncSettings['interval'] })
                  }
                  className={controlClass}
                >
                  {intervalOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              {syncInterval === 'weekly' && (
                <Field id={`${uid}-sync-day`} label={t('schedule.dayOfWeek', 'Day of Week')}>
                  <select
                    id={`${uid}-sync-day`}
                    value={syncDay}
                    onChange={(event) => patchSync({ dayOfWeek: parseInt(event.target.value, 10) })}
                    className={controlClass}
                  >
                    {DAY_KEYS.map((day) => (
                      <option key={day.value} value={day.value}>
                        {t(day.key, day.fallback)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field
                id={`${uid}-sync-time`}
                label={t('plexSync.timeLabel', 'Sync Time')}
                hint={
                  syncInterval === 'hourly'
                    ? t('plexSync.hourlyHint', 'Sync will run at this minute past each hour')
                    : t('plexSync.timeHint', 'Run before your scan so rules see the latest catalog')
                }
              >
                <input
                  id={`${uid}-sync-time`}
                  type="time"
                  value={syncTime}
                  onChange={(event) => patchSync({ time: event.target.value })}
                  className={cn(controlClass, 'font-mono')}
                />
              </Field>
            </div>
          )}
        </SettingsCard>
      </PanelSection>

      {/* ---------------- scan schedule ---------------- */}
      <PanelSection
        id="scan-schedule"
        register={registerSection}
        title={t('schedule.title', 'Scan Schedule')}
        description={t('schedule.description', 'Automate library scanning and cleanup')}
      >
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          <RowHeader
            title={t('schedule.auto.title', 'Automatic Scanning')}
            description={t(
              'automation.scan.enableHint',
              'Evaluate the library against your rules on a schedule'
            )}
            control={
              <Toggle
                checked={scanEnabled}
                onChange={(checked) => patchSchedule({ enabled: checked })}
                label={t('schedule.auto.title', 'Automatic Scanning')}
              />
            }
          />

          {scanEnabled && (
            <div
              className={cn(
                'grid gap-3',
                scanInterval === 'weekly' ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'
              )}
            >
              <Field id={`${uid}-scan-interval`} label={t('schedule.intervalLabel', 'Scan Interval')}>
                <select
                  id={`${uid}-scan-interval`}
                  value={scanInterval}
                  onChange={(event) =>
                    patchSchedule({ interval: event.target.value as ScheduleSettings['interval'] })
                  }
                  className={controlClass}
                >
                  {intervalOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              {scanInterval === 'weekly' && (
                <Field id={`${uid}-scan-day`} label={t('schedule.dayOfWeek', 'Day of Week')}>
                  <select
                    id={`${uid}-scan-day`}
                    value={scanDay}
                    onChange={(event) =>
                      patchSchedule({ dayOfWeek: parseInt(event.target.value, 10) })
                    }
                    className={controlClass}
                  >
                    {DAY_KEYS.map((day) => (
                      <option key={day.value} value={day.value}>
                        {t(day.key, day.fallback)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field
                id={`${uid}-scan-time`}
                label={t('schedule.timeLabel', 'Scan Time')}
                hint={
                  scanInterval === 'hourly'
                    ? t('schedule.hourlyHint', 'Scan will run at this minute past each hour')
                    : t('schedule.timeHint', 'Scan will run at this time')
                }
              >
                <input
                  id={`${uid}-scan-time`}
                  type="time"
                  value={scanTime}
                  onChange={(event) => patchSchedule({ time: event.target.value })}
                  className={cn(controlClass, 'font-mono')}
                />
              </Field>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-surface-200">
                  {t('automation.mediaServerSync', '{{name}} sync', { name: mediaServer.name })}
                </span>
                <p
                  className={cn(
                    'flex min-h-[44px] items-center rounded-[11px] border border-surface-600/60 bg-surface-800/70 px-3 py-[9px] text-[13px] lg:min-h-[36px]',
                    syncScheduled ? 'font-mono text-surface-50' : 'text-surface-300'
                  )}
                >
                  {syncSummary}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-[11px] bg-surface-800/45 px-3.5 py-[11px]">
            <RowHeader
              title={t('schedule.autoProcess.title', 'Auto-Process Queue')}
              description={t(
                'automation.scan.autoProcessHint',
                'Delete queued items once the grace period expires'
              )}
              control={
                <Toggle
                  checked={schedule?.autoProcess ?? false}
                  onChange={(checked) => patchSchedule({ autoProcess: checked })}
                  label={t('schedule.autoProcess.title', 'Auto-Process Queue')}
                />
              }
            />
          </div>
        </SettingsCard>
      </PanelSection>

      {/* ---------------- disk pressure ---------------- */}
      <PanelSection
        id="disk-pressure"
        register={registerSection}
        title={t('diskPressure.title', 'Disk Pressure')}
        description={t(
          'automation.diskPressure.description',
          'Reclaim the lowest-value content only when space runs low'
        )}
      >
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          <RowHeader
            title={t('automation.diskPressure.enable', 'Disk pressure cleanup')}
            description={t(
              'diskPressure.enable.description',
              'Monitors real free space and acts only when below your target'
            )}
            control={
              <Toggle
                checked={dpEnabled}
                onChange={(checked) => patchDisk({ enabled: checked })}
                label={t('automation.diskPressure.enable', 'Disk pressure cleanup')}
              />
            }
          />

          {/* gauge */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-surface-700/80 bg-surface-950/60 px-4 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[12px] text-surface-300">
                {t('automation.diskPressure.keepFree', 'Keep free — soft target {{soft}}, critical {{critical}}', {
                  soft: formatTarget(targetValue),
                  critical: formatTarget(criticalValue),
                })}
              </p>
              {freePercent !== undefined && (
                <p className="font-mono text-[12px] text-accent-text">
                  {t('automation.diskPressure.freeSummary', '{{percent}}% free · {{size}}', {
                    percent: Math.round(freePercent),
                    size: formatBytes(disk?.freeCapacity ?? 0, 1),
                  })}
                </p>
              )}
            </div>

            <div className="relative h-[9px] w-full overflow-hidden rounded-full bg-surface-600/60">
              {usedPercent !== undefined && (
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-500 to-accent-600 transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${usedPercent}%` }}
                />
              )}
              {markerPercent !== undefined && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-[2px] bg-ruby-500"
                  style={{ left: `${markerPercent}%` }}
                />
              )}
            </div>

            <p
              className={cn(
                'text-[11px]',
                monitoredPaths.length > 0 ? 'font-mono text-surface-400' : 'text-surface-400'
              )}
            >
              {monitoredPaths.length > 0
                ? t('automation.diskPressure.monitoring', 'Monitoring {{paths}}', {
                    paths: monitoredPaths.join(' · '),
                  })
                : t(
                    'firstRun.automation.noPaths',
                    'No monitored paths yet — add one to watch free space'
                  )}
            </p>
          </div>

          {dpEnabled && (
            <>
              {/* monitored paths */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-surface-200">
                  {t('diskPressure.paths.title', 'Monitored paths')}
                </p>
                {paths.map((path, index) => (
                  // Index is the identity here: rows are positional and reorder only on delete.
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={path}
                      aria-label={t('diskPressure.paths.title', 'Monitored paths')}
                      placeholder="/data/media"
                      onChange={(event) => {
                        const next = [...paths];
                        next[index] = event.target.value;
                        patchDisk({ paths: next });
                      }}
                      className={cn(controlClass, 'font-mono')}
                    />
                    <button
                      type="button"
                      onClick={() => patchDisk({ paths: paths.filter((_, i) => i !== index) })}
                      title={t('diskPressure.paths.remove', 'Remove path')}
                      aria-label={t('diskPressure.paths.remove', 'Remove path')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-surface-400 transition-colors hover:bg-ruby-500/10 hover:text-ruby-text"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] self-start"
                  onClick={() => patchDisk({ paths: [...paths, ''] })}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {t('diskPressure.paths.add', 'Add path')}
                </Button>
              </div>

              {/* keep-free target */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-surface-200">
                  {t('diskPressure.target.title', 'Keep free')}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    role="radiogroup"
                    aria-label={t('diskPressure.target.title', 'Keep free')}
                    className="inline-flex gap-1 rounded-[11px] border border-surface-700/90 bg-surface-800/80 p-[3px]"
                  >
                    {(['percent', 'absolute'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={targetMode === mode}
                        onClick={() => patchDisk({ targetMode: mode })}
                        className={cn(
                          'min-h-[38px] rounded-lg px-[13px] text-xs font-semibold transition-colors',
                          targetMode === mode
                            ? 'bg-accent-500/[0.14] text-accent-text'
                            : 'text-surface-400 hover:text-surface-200'
                        )}
                      >
                        {mode === 'percent'
                          ? t('diskPressure.target.percentOfDisk', '% of disk')
                          : 'GB'}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={targetValue}
                    aria-label={t('diskPressure.target.softTarget', 'soft target')}
                    onChange={(event) => patchDisk({ targetValue: Number(event.target.value) })}
                    className={cn(controlClass, 'w-24 font-mono')}
                  />
                  <span className="text-[12px] text-surface-400">
                    {t('diskPressure.target.softTarget', 'soft target')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    value={criticalValue}
                    aria-label={t(
                      'diskPressure.target.criticalThreshold',
                      'critical threshold ({{unit}}) — below this, reclaim with no grace',
                      { unit }
                    )}
                    onChange={(event) => patchDisk({ criticalValue: Number(event.target.value) })}
                    className={cn(controlClass, 'w-24 font-mono')}
                  />
                  <span className="text-[12px] text-surface-400">
                    {t(
                      'diskPressure.target.criticalThreshold',
                      'critical threshold ({{unit}}) — below this, reclaim with no grace',
                      { unit }
                    )}
                  </span>
                </div>
              </div>

              {/* numeric knobs */}
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <Knob
                  id={`${uid}-dp-interval`}
                  label={t('diskPressure.knobs.intervalMin', 'Check interval (min)')}
                  value={dp.intervalMinutes ?? 20}
                  onChange={(value) => patchDisk({ intervalMinutes: value })}
                />
                <Knob
                  id={`${uid}-dp-max-gb`}
                  label={t('diskPressure.knobs.maxGbPerRun', 'Max GB per run')}
                  value={dp.maxGbPerRun ?? 500}
                  onChange={(value) => patchDisk({ maxGbPerRun: value })}
                />
                <Knob
                  id={`${uid}-dp-max-items`}
                  label={t('diskPressure.knobs.maxItemsPerRun', 'Max items per run')}
                  value={dp.maxItemsPerRun ?? 25}
                  onChange={(value) => patchDisk({ maxItemsPerRun: value })}
                />
                <Knob
                  id={`${uid}-dp-soft-grace`}
                  label={t('diskPressure.knobs.softGraceDays', 'Soft grace (days)')}
                  value={dp.softGraceDays ?? 7}
                  onChange={(value) => patchDisk({ softGraceDays: value })}
                />
                <Knob
                  id={`${uid}-dp-buffer`}
                  label={t('diskPressure.knobs.bufferGb', 'Buffer (GB)')}
                  value={dp.bufferGb ?? 50}
                  onChange={(value) => patchDisk({ bufferGb: value })}
                />
                <Knob
                  id={`${uid}-dp-unwatched`}
                  label={t('diskPressure.knobs.unwatchedDays', 'Unwatched threshold (days)')}
                  value={dp.unwatchedDays ?? 90}
                  onChange={(value) => patchDisk({ unwatchedDays: value })}
                />
              </div>

              {/* deletion action */}
              <Field
                id={`${uid}-dp-action`}
                label={t('diskPressure.deletionAction.label', 'Deletion action')}
              >
                <select
                  id={`${uid}-dp-action`}
                  value={dp.deletionAction ?? 'unmonitor_and_delete'}
                  onChange={(event) => patchDisk({ deletionAction: event.target.value })}
                  className={controlClass}
                >
                  {deletionActions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              {/* critical auto-process */}
              <div className="rounded-[11px] bg-surface-800/45 px-3.5 py-[11px]">
                <RowHeader
                  title={t(
                    'diskPressure.criticalAuto.title',
                    'Auto-delete immediately on critical pressure'
                  )}
                  description={t(
                    'diskPressure.criticalAuto.description',
                    'Bypasses the grace period when critically low. Protected items are always skipped.'
                  )}
                  control={
                    <Toggle
                      checked={dp.criticalAutoProcess ?? false}
                      onChange={(checked) => patchDisk({ criticalAutoProcess: checked })}
                      label={t(
                        'diskPressure.criticalAuto.title',
                        'Auto-delete immediately on critical pressure'
                      )}
                    />
                  }
                />
              </div>

              {/* observe only */}
              <div className="flex items-center justify-between gap-4 rounded-[11px] border border-violet-500/[0.22] bg-violet-500/[0.07] px-3.5 py-[11px]">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="rounded-md bg-violet-500/15 px-2 py-1 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-violet-text">
                    {t('automation.diskPressure.observeBadge', 'Observe only')}
                  </span>
                  <p className="text-[12.5px] text-surface-300">
                    {t(
                      'automation.diskPressure.observeHint',
                      'Logs and notifies what it would reclaim — nothing is deleted.'
                    )}
                  </p>
                </div>
                <Toggle
                  checked={dp.observeOnly ?? true}
                  onChange={(checked) => patchDisk({ observeOnly: checked })}
                  label={t('diskPressure.observeOnly.title', 'Observe-only mode')}
                />
              </div>
            </>
          )}
        </SettingsCard>
      </PanelSection>
    </>
  );
}

/** Shared field chrome: 11px radius, inset fill, hairline border. */
const controlClass = cn(
  'w-full min-h-[44px] rounded-[11px] border border-surface-600/60 bg-surface-800/70 px-3 py-[9px]',
  'font-sans text-[13px] text-surface-50 placeholder:text-surface-500',
  'transition-colors focus:border-accent-500/50 focus:bg-surface-800/95 focus:outline-none',
  'lg:min-h-[36px]'
);

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-surface-200">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-surface-400">{hint}</p>}
    </div>
  );
}

/** Title + description on the left, a control on the right. */
function RowHeader({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <p className="font-display text-[14.5px] font-semibold text-surface-50">{title}</p>
        <p className="text-[12.5px] text-surface-400">{description}</p>
      </div>
      {control}
    </div>
  );
}

/** One numeric knob in the disk-pressure grid: small label over a mono value. */
function Knob({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[11px] border border-surface-700/90 bg-surface-800/55 px-3 py-2.5">
      <label htmlFor={id} className="text-[11px] text-surface-400">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full min-h-[28px] border-0 bg-transparent p-0 font-mono text-[15px] font-semibold text-surface-50 focus:outline-none focus:ring-0"
      />
    </div>
  );
}
