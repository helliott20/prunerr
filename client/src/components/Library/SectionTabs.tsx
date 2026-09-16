import { motion, useReducedMotion } from 'framer-motion';
import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/lib/utils';

export interface DetailSection {
  /** Stable id, also used as the tab/panel aria wiring. */
  id: string;
  label: string;
  /** Takes the animated nav icons, which play off the button's `group`. */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Optional count shown next to the label (e.g. episodes). */
  count?: number;
}

/**
 * The detail page's section switcher: one panel at a time, Details first.
 *
 * The tabs float directly on the page — no bar behind them — so the poster
 * backdrop stays visible underneath. The active pill is a shared layout
 * element, so it slides from the old tab to the new one instead of blinking
 * across.
 */
export function SectionTabs({
  sections,
  activeId,
  onChange,
  className,
  idPrefix = 'section',
}: {
  sections: DetailSection[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  idPrefix?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (sections.length < 2) return null;

  /** Roving arrow-key movement, as expected of a tablist. */
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = sections[(index + delta + sections.length) % sections.length];
    if (!next) return;
    onChange(next.id);
    document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn('flex items-center gap-1.5 overflow-x-auto', className)}
    >
      {sections.map((section, index) => {
        const Icon = section.icon;
        const isActive = activeId === section.id;

        return (
          <button
            key={section.id}
            id={`${idPrefix}-tab-${section.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`${idPrefix}-panel-${section.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(section.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'group relative flex-shrink-0 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium',
              'transition-colors duration-200',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/60 focus-visible:ring-offset-0',
              isActive ? 'text-accent-text' : 'text-surface-400 hover:text-surface-100'
            )}
          >
            {isActive && (
              <motion.span
                aria-hidden="true"
                layoutId={`${idPrefix}-tab-pill`}
                className="absolute inset-0 rounded-xl bg-accent-500/12 border border-accent-500/25 shadow-sm shadow-accent-500/10"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }
                }
              />
            )}
            <Icon className="relative w-4 h-4" />
            <span className="relative">{section.label}</span>
            {section.count !== undefined && (
              <span
                className={cn(
                  'relative rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                  isActive ? 'bg-accent-500/20 text-accent-text' : 'bg-surface-800/70 text-surface-400'
                )}
              >
                {section.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The panel a tab reveals. Keyed on the section id by the caller, so switching
 * tabs remounts it and replays the entrance — the same remount-driven approach
 * the page transition uses, which fires reliably on every change.
 */
export function SectionPanel({
  sectionId,
  idPrefix = 'section',
  children,
}: {
  sectionId: string;
  idPrefix?: string;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      id={`${idPrefix}-panel-${sectionId}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${sectionId}`}
      tabIndex={-1}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      className="focus:outline-none"
    >
      {children}
    </motion.div>
  );
}
