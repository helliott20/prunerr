import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
} from 'framer-motion';
import { Eye, ChevronUp, X, AlertCircle } from 'lucide-react';
import { LivePreview, type LivePreviewSummary } from './LivePreview';
import type { ConditionNode } from '@/types';

interface MobilePreviewSheetProps {
  root: ConditionNode;
  mediaType?: 'all' | 'movie' | 'show' | 'tv';
  /** If false, the chip is hidden entirely (e.g. on the Templates tab). */
  enabled?: boolean;
}

/**
 * Mobile-only floating preview. Always-mounted internally so the headline
 * numbers stay live; the bottom-sheet slides up over the builder when the
 * user taps the chip, and dismisses on swipe-down, backdrop tap, or the
 * close button. The lg breakpoint shows the inline side panel instead and
 * hides this entirely.
 */
export function MobilePreviewSheet({
  root,
  mediaType = 'all',
  enabled = true,
}: MobilePreviewSheetProps) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<LivePreviewSummary | null>(null);
  const reduce = useReducedMotion();

  // Close on Escape while the sheet is open (composes with the modal's own
  // Escape handler — we stop propagation so this fires first).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open]);

  if (!enabled) return null;

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    // Close on either a moderate downward drag (offset > 80px) or a clear
    // downward flick (velocity > 350 px/s). Anything less and the sheet
    // springs back to fully open via dragConstraints.
    if (info.offset.y > 80 || info.velocity.y > 350) {
      setOpen(false);
    }
  };

  // Portal to document.body so the fixed chip/sheet are positioned relative to
  // the viewport, not the SmartRuleBuilder modal container. That container has
  // `backdrop-blur`, which makes it the containing block for our fixed
  // descendants; combined with framer's transform animation, Chrome
  // intermittently re-resolves the containing block mid-animation, making the
  // sheet flash to full screen as it slides up. Escaping to the body fixes it.
  return createPortal(
    <div className="lg:hidden">
      {/* Floating chip — visible whenever the sheet is closed */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="preview-chip"
            type="button"
            onClick={() => setOpen(true)}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 30 }}
            transition={
              reduce
                ? { duration: 0.1 }
                : { type: 'spring', stiffness: 380, damping: 28 }
            }
            className="fixed inset-x-0 mx-auto z-[60] flex items-center gap-2 px-4 py-2.5 bg-surface-900/95 border border-accent-500/40 rounded-full shadow-lg shadow-black/40 text-sm text-surface-100 active:scale-[0.98] transition-transform"
            style={{
              width: 'fit-content',
              maxWidth: 'calc(100vw - 2rem)',
              bottom: `calc(1rem + env(safe-area-inset-bottom, 0px))`,
            }}
            aria-label="Open live preview"
          >
            <ChipContents summary={summary} />
            <ChevronUp className="w-4 h-4 text-surface-400 ml-0.5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Backdrop — fades in behind the sheet */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="preview-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-black/55 z-[60]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
        )}
      </AnimatePresence>

      {/* Bottom sheet — always mounted so LivePreview keeps fetching and the
          chip stays in sync. Native framer drag owns the gesture from
          pointerdown anywhere on the sheet; framer reliably differentiates
          a brief tap from a drag based on its own internal threshold, and
          dragElastic gives the rubber-band feel on overdrag. */}
      <motion.div
        role="dialog"
        aria-modal={open}
        aria-label="Live preview"
        initial={false}
        animate={{ y: open ? '0%' : '100%' }}
        transition={
          reduce
            ? { duration: 0.15 }
            : { type: 'spring', stiffness: 340, damping: 34 }
        }
        drag={open ? 'y' : false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        dragMomentum={false}
        whileDrag={{ cursor: 'grabbing' }}
        onDragEnd={handleDragEnd}
        className="fixed inset-x-0 bottom-0 z-[61] bg-surface-900 border-t border-surface-700/60 rounded-t-2xl shadow-2xl shadow-black/60 flex flex-col"
        style={{
          maxHeight: '85vh',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Grab handle — visual affordance only; framer drags the whole
            sheet regardless of which child the pointer started on. */}
        <div className="flex flex-col items-center pt-2.5 pb-1 shrink-0 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 rounded-full bg-surface-600" aria-hidden />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-4 pb-2 shrink-0">
          <h3 className="text-sm font-semibold text-surface-100 flex items-center gap-2">
            <Eye className="w-4 h-4 text-accent-text" />
            Live Preview
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex items-center justify-center w-9 h-9 -mr-1 rounded-lg text-surface-400 hover:text-surface-50 hover:bg-surface-800 active:bg-surface-700 transition-colors"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content — overflow-y-auto so wheel/trackpad scroll still works on
            laptop touch devices; touch scrolling inside the sheet is owned
            by the drag gesture (acceptable since the preview content fits
            on most phone heights). */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 min-h-0">
          <LivePreview
            root={root}
            mediaType={mediaType}
            enabled={enabled}
            onSummaryChange={setSummary}
          />
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

function ChipContents({ summary }: { summary: LivePreviewSummary | null }) {
  // Initial render before LivePreview has reported anything
  if (!summary) {
    return (
      <>
        <Eye className="w-4 h-4 text-accent-text" />
        <span className="text-surface-300">Live preview</span>
      </>
    );
  }
  if (summary.hasError) {
    return (
      <>
        <AlertCircle className="w-4 h-4 text-ruby-400" />
        <span className="text-ruby-400">Preview failed</span>
      </>
    );
  }
  if (summary.isEmpty) {
    return (
      <>
        <Eye className="w-4 h-4 text-accent-text" />
        <span className="text-surface-400">Add a condition to preview</span>
      </>
    );
  }
  if (summary.isPending && summary.total === 0) {
    return (
      <>
        <Eye className="w-4 h-4 text-accent-text animate-pulse" />
        <span className="text-surface-300">Calculating…</span>
      </>
    );
  }
  return (
    <>
      <Eye className="w-4 h-4 text-accent-text" />
      <span className="font-semibold tabular-nums text-surface-50">
        {summary.total}
      </span>
      <span className="text-surface-400">
        match{summary.total === 1 ? '' : 'es'}
      </span>
      {summary.total > 0 && summary.freedGB > 0 && (
        <>
          <span className="text-surface-600">•</span>
          <span className="text-emerald-400 font-medium tabular-nums">
            {formatStorageGB(summary.freedGB)}
          </span>
        </>
      )}
      {summary.isPending && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse ml-0.5"
          aria-hidden
        />
      )}
    </>
  );
}

function formatStorageGB(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
  if (gb >= 10) return `${gb.toFixed(0)} GB`;
  return `${gb.toFixed(1)} GB`;
}
