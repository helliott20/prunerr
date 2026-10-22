import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { rulesApi, type RuleForecastPoint, type RuleForecastResult } from '@/services/api';
import { formatBytes } from '@/lib/utils';
import type { ConditionNode } from '@/types';
import { stripUiIds } from './treeOps';

/** Waits a little longer than the preview: the forecast is the heavier call. */
const DEBOUNCE_MS = 900;

interface RuleForecastProps {
  root: ConditionNode;
  mediaType?: 'all' | 'movie' | 'show' | 'tv';
  libraryKeys?: string[];
  deletionAction?: string;
  /** The saved rule being edited, to compare against. */
  ruleId?: number;
}

/**
 * "What if" for the rule editor: what this rule would make eligible over the
 * next 12 months, on its own, next to what the saved rule would.
 */
export function RuleForecast({ root, mediaType, libraryKeys, deletionAction, ruleId }: RuleForecastProps) {
  const { t } = useTranslation('rules');
  const [data, setData] = useState<RuleForecastResult | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const body = JSON.stringify({ root: stripUiIds(root), mediaType, libraryKeys, deletionAction, ruleId });

  useEffect(() => {
    const myGen = ++generation.current;
    setIsPending(true);
    const handle = setTimeout(() => {
      const parsed = JSON.parse(body) as Omit<Parameters<typeof rulesApi.forecast>[0], 'version'>;
      // Started inside a promise so any failure, however early, lands in catch.
      Promise.resolve()
        .then(() =>
          rulesApi.forecast({ version: 2, ...parsed, libraryKeys: parsed.libraryKeys?.length ? parsed.libraryKeys : undefined })
        )
        .then((result) => {
          if (myGen !== generation.current) return;
          setData(result);
          setFailed(false);
          setIsPending(false);
        })
        .catch(() => {
          if (myGen !== generation.current) return;
          setFailed(true);
          setIsPending(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [body]);

  if (failed) return null;

  const proposed = data?.proposed;
  const saved = data?.saved ?? null;
  const periodLabel = (day: number) =>
    day === 0
      ? t('forecast.nextScan', 'Next scan')
      : day <= 120
        ? t('forecast.threeMonths', '3 months')
        : t('forecast.twelveMonths', '12 months');
  const cell = (p: RuleForecastPoint | undefined, strong: boolean) =>
    p ? (
      <>
        <span className={strong ? 'block font-semibold text-accent-text' : 'block text-surface-100'}>
          {t('forecast.items', '{{count}} items', { count: p.items })}
        </span>
        <span className="block text-[11px] text-surface-500">{formatBytes(p.bytes)}</span>
      </>
    ) : (
      '—'
    );
  // The first point where the edit makes a difference, if any.
  const firstChange = saved && proposed
    ? proposed.findIndex((p, i) => p.items !== saved[i]?.items || p.bytes !== saved[i]?.bytes)
    : -1;
  const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

  return (
    <div className="border-t border-surface-700/60 pt-4 shrink-0" aria-busy={isPending}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h5 className="text-sm font-medium text-surface-200 inline-flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4 text-surface-400" />
          {t('forecast.heading', 'Forecast')}
        </h5>
        <Link to="/forecast" className="text-xs text-accent-text hover:text-accent-text-hover">
          {t('forecast.open', 'Open')}
        </Link>
      </div>

      {!proposed ? (
        <div className="h-16 rounded bg-surface-700/60 animate-pulse" />
      ) : (
        <div className={isPending ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-surface-500">
                <th className="text-left font-normal pb-1" />
                {saved && <th className="text-right font-normal pb-1">{t('forecast.saved', 'Saved')}</th>}
                <th className="text-right font-normal pb-1 pl-3">
                  {saved ? t('forecast.withChange', 'Edited') : t('forecast.thisRule', 'This rule')}
                </th>
              </tr>
            </thead>
            <tbody>
              {proposed.map((p, i) => (
                <tr key={p.day} className="border-t border-surface-700/40 align-top">
                  <td className="py-1.5 text-surface-400 whitespace-nowrap">{periodLabel(p.day)}</td>
                  {saved && <td className="py-1.5 text-right whitespace-nowrap">{cell(saved[i], false)}</td>}
                  <td className="py-1.5 pl-3 text-right whitespace-nowrap">{cell(p, i === firstChange)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {saved && (
            <p className="mt-2 text-xs rounded-md bg-surface-700/50 text-surface-300 px-2.5 py-1.5">
              {firstChange === -1
                ? t('forecast.same', 'Same as the saved rule.')
                : t('forecast.diffAt', '{{period}}: {{items}} items · {{size}} compared with the saved rule', {
                    period: periodLabel(proposed[firstChange]!.day),
                    items: `${sign(proposed[firstChange]!.items - saved[firstChange]!.items)}${Math.abs(proposed[firstChange]!.items - saved[firstChange]!.items)}`,
                    size: `${sign(proposed[firstChange]!.bytes - saved[firstChange]!.bytes)}${formatBytes(Math.abs(proposed[firstChange]!.bytes - saved[firstChange]!.bytes))}`,
                  })}
            </p>
          )}
          <p className="mt-2 text-[11px] text-surface-500">
            {t('forecast.hint', 'This rule on its own, counting items it will reach as they age. Your other rules aren’t taken into account.')}
          </p>
        </div>
      )}
    </div>
  );
}
