import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDisplayPreferences } from '@/contexts/DisplayPreferencesContext';
import { useHapticsEnabled } from '@/lib/haptics';
import { LANGUAGES, SUPPORTED_LANGUAGES } from '@/i18n/languages';
import type { DisplaySettings } from '@/types';

import { PanelSection } from '../components/PanelSection';
import { SegmentedControl } from '../components/SegmentedControl';
import { SettingsCard } from '../components/SettingsCard';
import { Toggle } from '../components/Toggle';
import type { PanelProps } from '../types';

/**
 * One label/hint pair on the left, one control on the right. 44px minimum height
 * keeps every control tappable on mobile.
 */
function PreferenceRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-display text-[13.5px] font-semibold text-surface-50">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] text-surface-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Interface — display preferences and haptics.
 *
 * Neither sub-section is part of the staged settings payload:
 * display preferences persist through `DisplayPreferencesContext` (which also
 * drives live date/number formatting and the UI language), and haptics is a
 * per-device `localStorage` flag. Both therefore stay out of `onChange` and out
 * of the dirty count.
 */
export default function InterfacePanel({ registerSection }: PanelProps) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { preferences, setPreferences } = useDisplayPreferences();
  const [hapticsEnabled, setHapticsEnabled] = useHapticsEnabled();

  const dateHintKeys: Record<DisplaySettings['dateFormat'], [string, string]> = {
    relative: ['display.dateFormat.relative', 'Relative (2 hours ago)'],
    absolute: ['display.dateFormat.absolute', 'Absolute (Jan 24, 2026)'],
    iso: ['display.dateFormat.iso', 'ISO (2026-01-24)'],
  };
  const timeHintKeys: Record<DisplaySettings['timeFormat'], [string, string]> = {
    '12h': ['display.timeFormat.h12', '12-hour (3:00 PM)'],
    '24h': ['display.timeFormat.h24', '24-hour (15:00)'],
  };
  const sizeHintKeys: Record<DisplaySettings['fileSizeUnit'], [string, string]> = {
    auto: ['display.fileSizeUnit.auto', 'Auto (best fit)'],
    MB: ['display.fileSizeUnit.mb', 'Always MB'],
    GB: ['display.fileSizeUnit.gb', 'Always GB'],
    TB: ['display.fileSizeUnit.tb', 'Always TB'],
  };

  const dateHint = dateHintKeys[preferences.dateFormat] ?? dateHintKeys.relative;
  const timeHint = timeHintKeys[preferences.timeFormat] ?? timeHintKeys['24h'];
  const sizeHint = sizeHintKeys[preferences.fileSizeUnit] ?? sizeHintKeys.auto;

  return (
    <>
      <PanelSection
        id="display-preferences"
        register={registerSection}
        title={t('nav.sub.displayPreferences', 'Display preferences')}
        description={t('display.description', 'Customize how dates, times, and sizes are shown')}
      >
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          <PreferenceRow
            label={t('display.dateFormat.label', 'Date Format')}
            hint={t(dateHint[0], dateHint[1])}
          >
            <SegmentedControl<DisplaySettings['dateFormat']>
              value={preferences.dateFormat}
              ariaLabel={t('display.dateFormat.label', 'Date Format')}
              onChange={(dateFormat) => setPreferences({ dateFormat })}
              options={[
                { value: 'relative', label: t('display.dateFormat.relativeShort', 'Relative') },
                { value: 'absolute', label: t('display.dateFormat.absoluteShort', 'Absolute') },
                { value: 'iso', label: t('display.dateFormat.isoShort', 'ISO') },
              ]}
            />
          </PreferenceRow>

          <PreferenceRow
            label={t('display.timeFormat.label', 'Time Format')}
            hint={t(timeHint[0], timeHint[1])}
          >
            <SegmentedControl<DisplaySettings['timeFormat']>
              value={preferences.timeFormat}
              ariaLabel={t('display.timeFormat.label', 'Time Format')}
              onChange={(timeFormat) => setPreferences({ timeFormat })}
              options={[
                { value: '24h', label: t('display.timeFormat.h24Short', '24-hour') },
                { value: '12h', label: t('display.timeFormat.h12Short', '12-hour') },
              ]}
            />
          </PreferenceRow>

          <PreferenceRow
            label={t('display.fileSizeUnit.label', 'File Size Unit')}
            hint={t(sizeHint[0], sizeHint[1])}
          >
            <SegmentedControl<DisplaySettings['fileSizeUnit']>
              value={preferences.fileSizeUnit}
              ariaLabel={t('display.fileSizeUnit.label', 'File Size Unit')}
              onChange={(fileSizeUnit) => setPreferences({ fileSizeUnit })}
              options={[
                { value: 'auto', label: t('display.fileSizeUnit.autoShort', 'Auto') },
                { value: 'MB', label: t('display.fileSizeUnit.mbShort', 'MB') },
                { value: 'GB', label: t('display.fileSizeUnit.gbShort', 'GB') },
                { value: 'TB', label: t('display.fileSizeUnit.tbShort', 'TB') },
              ]}
            />
          </PreferenceRow>

          {/* Interface language. Not in the handoff's three rows, but dropping it
              would strand anyone who cannot read the current language. */}
          <PreferenceRow label={tCommon('language.label', 'Language')}>
            <select
              value={preferences.language}
              aria-label={tCommon('language.label', 'Language')}
              onChange={(event) =>
                setPreferences({ language: event.target.value as DisplaySettings['language'] })
              }
              className="min-h-[44px] rounded-[11px] border border-surface-600/60 bg-surface-800/70 px-3 py-2.5 font-sans text-[12.5px] text-surface-100 focus:border-accent-500/50 focus:outline-none"
            >
              {SUPPORTED_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGES[code]}
                </option>
              ))}
            </select>
          </PreferenceRow>
        </SettingsCard>
      </PanelSection>

      <PanelSection
        id="haptics"
        register={registerSection}
        title={t('nav.sub.haptics', 'Haptic feedback')}
        description={t(
          'haptics.description',
          'Vibration on touch interactions — supported mobile devices only'
        )}
      >
        <SettingsCard className="px-[18px] py-4">
          <PreferenceRow
            label={t('haptics.enable', 'Enable haptics')}
            hint={t(
              'haptics.enableDescription',
              'A subtle tap when opening, closing, and dismissing sheets. Saved per device.'
            )}
          >
            <Toggle
              checked={hapticsEnabled}
              onChange={setHapticsEnabled}
              label={t('haptics.enable', 'Enable haptics')}
            />
          </PreferenceRow>
        </SettingsCard>
      </PanelSection>
    </>
  );
}
