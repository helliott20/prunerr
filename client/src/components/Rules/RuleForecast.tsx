import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { rulesApi, type RuleForecastPoint, type RuleForecastResult } from '@/services/api';
import { cn, formatBytes } from '@/lib/utils';
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
 * "What if" for the rule editor: what this rule will reach later that it
 * doesn't reach now, and how an edit changes that against the saved rule.
 * The Live Preview already shows what it matches today, so this stays out
 * of the way when there's nothing to add: a rule that doesn't depend on
 * time (resolution, size) reaches nothing new as the months pass.
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

  const proposed = data?.proposed;
  if (failed || !proposed || proposed.length < 3) return null;
  const saved = data?.saved ?? null;
  const [now, quarter, year] = proposed as [RuleForecastPoint, RuleForecastPoint, RuleForecastPoint];

  // Totals are running, so what comes later is each point less today's.
  const later = (p: RuleForecastPoint) => ({ items: p.items - now.items, bytes: p.bytes - now.bytes });
  const rows = [
    { key: 'quarter', label: t('forecast.next3Months', 'Next 3 months'), ...later(quarter) },
    { key: 'year', label: t('forecast.next12Months', 'Next 12 months'), ...later(year) },
  ].filter((r) => r.items > 0);

  // The first point where the edit makes a difference, if any.
  const changeAt = saved ? proposed.findIndex((p, i) => p.items !== saved[i]?.items || p.bytes !== saved[i]?.bytes) : -1;
  if (rows.length === 0 && changeAt === -1) return null;

  const signed = (n: number, text: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`;
  const when = (i: number) =>
    i === 0 ? t('forecast.atNextScan', 'at the next scan') : i === 1 ? t('forecast.within3Months', 'within 3 months') : t('forecast.withinYear', 'within a year');

  return (
    <div
      className={cn('border-t border-surface-700/60 pt-4 shrink-0 transition-opacity', isPending && 'opacity-60')}
      aria-busy={isPending}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h5 className="text-sm font-medium text-surface-200 inline-flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4 text-surface-400" />
          {t('forecast.later', 'Coming later')}
        </h5>
        <Link to="/forecast" className="text-xs text-accent-text hover:text-accent-text-hover">
          {t('forecast.open', 'Full forecast')}
        </Link>
      </div>

      {rows.length > 0 ? (
        <dl className="text-xs space-y-1">
          {rows.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-3">
              <dt className="text-surface-400">{r.label}</dt>
              <dd className="text-surface-100 text-right">
                {t('forecast.more', '+{{count}} items · {{size}}', { count: r.items, size: formatBytes(r.bytes) })}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-surface-400">
          {t('forecast.nothingLater', 'Reaches nothing more within a year.')}
        </p>
      )}

      {saved && changeAt !== -1 && (
        <p className="mt-2 text-xs rounded-md bg-surface-700/50 text-surface-200 px-2.5 py-1.5">
          {t('forecast.change', 'Your change: {{items}} items · {{size}} {{when}}, compared with the saved rule', {
            count: Math.abs(proposed[changeAt]!.items - saved[changeAt]!.items),
            items: signed(proposed[changeAt]!.items - saved[changeAt]!.items, String(Math.abs(proposed[changeAt]!.items - saved[changeAt]!.items))),
            size: signed(proposed[changeAt]!.bytes - saved[changeAt]!.bytes, formatBytes(Math.abs(proposed[changeAt]!.bytes - saved[changeAt]!.bytes))),
            when: when(changeAt),
          })}
        </p>
      )}

      <p className="mt-2 text-[11px] text-surface-500">
        {t('forecast.hint', 'This rule on its own, counting items it will reach as they age. Your other rules aren’t taken into account.')}
      </p>
    </div>
  );
}
