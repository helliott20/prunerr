import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';

import { useTelemetry, useUpdateTelemetry } from '@/hooks/useApi';
import { Button } from '@/components/common/Button';

/**
 * First-run disclosure for the anonymous install count.
 *
 * Telemetry ships on, so this is the part that keeps that honest: it appears
 * once, says in plain language exactly what is sent, and offers to turn it off
 * right there rather than sending anyone hunting through Settings. Dismissing
 * it is what marks it seen — it never reappears.
 *
 * It renders nothing at all when telemetry is already off, when the
 * deployment disabled it via TELEMETRY_ENABLED, or when there is no endpoint
 * configured, because in those cases there is nothing to disclose.
 */
export function TelemetryNotice() {
  const { t } = useTranslation('common');
  const reduce = useReducedMotion();
  const { data: telemetry } = useTelemetry();
  const update = useUpdateTelemetry();

  const show = Boolean(telemetry && telemetry.enabled && !telemetry.noticeSeen);

  const handleAcknowledge = () => update.mutate({ noticeSeen: true });
  const handleOptOut = () => update.mutate({ enabled: false, noticeSeen: true });

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={reduce ? { opacity: 1 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          role="dialog"
          aria-label={t('telemetry.noticeTitle', 'Anonymous install count')}
          // Sits above the content but clear of the mobile nav bar, and capped
          // so it reads as a notice rather than taking over the page.
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-[16px] border border-surface-700/80 bg-surface-800/95 p-4 shadow-2xl backdrop-blur sm:inset-x-6 sm:bottom-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[14px] font-semibold text-surface-50">
                {t('telemetry.noticeTitle', 'Anonymous install count')}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-surface-300">
                {t(
                  'telemetry.noticeBody',
                  'Once a day, Prunerr sends a random ID and its version number so we can see how many people are using it. That is all it sends — nothing about your library, your settings or you.'
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={handleAcknowledge}
              disabled={update.isPending}
              aria-label={t('telemetry.dismiss', 'Dismiss')}
              className="-m-1 shrink-0 rounded-lg p-1 text-surface-400 transition-colors hover:text-surface-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] w-full sm:w-auto"
              onClick={handleOptOut}
              disabled={update.isPending}
            >
              {t('telemetry.turnOff', 'Turn it off')}
            </Button>
            <Button
              size="sm"
              className="min-h-[44px] w-full sm:w-auto"
              onClick={handleAcknowledge}
              disabled={update.isPending}
            >
              {t('telemetry.gotIt', 'Got it')}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default TelemetryNotice;
