import { useEffect, useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
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
 * backdrop stays visible underneath. The active pill slides from the old tab to
 * the new one instead of blinking across.
 *
 * The pill is positioned by writing a transform straight to its node rather
 * than through framer-motion's shared-layout (`layoutId`) machinery: that
 * measures the whole tree, including every scroll container, and a CPU profile
 * of a switch on a throttled phone had `measureScroll` as the single largest
 * cost on the page. One element and one transform costs nothing.
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
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  /** The pill is placed, not animated, the first time it lands. */
  const hasPlaced = useRef(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    const pill = pillRef.current;
    if (!list || !pill) return;

    const place = () => {
      const tab = list.querySelector<HTMLElement>(`[data-section-id="${activeId}"]`);
      if (!tab) return;
      pill.style.transition = hasPlaced.current && !reduceMotion
        ? 'transform 260ms cubic-bezier(0.2, 0.8, 0.3, 1), width 260ms cubic-bezier(0.2, 0.8, 0.3, 1)'
        : 'none';
      // The Y half-offset lives here too: a class-based `-translate-y-1/2`
      // would be overwritten by this same `transform` property.
      pill.style.transform = `translate(${tab.offsetLeft}px, -50%)`;
      pill.style.width = `${tab.offsetWidth}px`;
      pill.style.opacity = '1';
      hasPlaced.current = true;
    };

    place();
    // Labels and counts arrive with the data, and the row reflows on resize.
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeId, reduceMotion, sections]);

  /** Roving arrow-key movement, as expected of a tablist. */
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = sections[(index + delta + sections.length) % sections.length];
    if (!next) return;
    onChange(next.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-section-id="${next.id}"]`)
      ?.focus();
  };

  if (sections.length < 2) return null;

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="horizontal"
      // The row scrolls rather than wraps on a narrow screen; the negative
      // margin keeps the focus ring from being clipped by that scroller.
      className={cn('no-scrollbar relative flex items-center gap-1.5 overflow-x-auto -mx-1 px-1', className)}
    >
      <span
        ref={pillRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-1/2 h-[44px] rounded-xl bg-accent-500/12 border border-accent-500/25 shadow-sm shadow-accent-500/10 opacity-0"
      />

      {sections.map((section, index) => {
        const Icon = section.icon;
        const isActive = activeId === section.id;

        return (
          <button
            key={section.id}
            id={`${idPrefix}-tab-${section.id}`}
            data-section-id={section.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`${idPrefix}-panel-${section.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={(event) => {
              onChange(section.id);
              event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'group relative flex-shrink-0 flex items-center gap-2 rounded-xl text-sm font-medium',
              // Comfortably tappable on a phone without the row overflowing.
              'min-h-[44px] px-3 sm:px-4 py-2.5',
              'transition-colors duration-200',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/60 focus-visible:ring-offset-0',
              isActive ? 'text-accent-text' : 'text-surface-400 hover:text-surface-100'
            )}
          >
            <Icon className="w-4 h-4" />
            <span>{section.label}</span>
            {section.count !== undefined && (
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums transition-colors',
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
 * The panel a tab reveals.
 *
 * Every panel stays mounted and the inactive ones are hidden, because
 * remounting the heavier ones (the timeline, the season tree) meant rebuilding
 * them on every switch. Hiding costs nothing, so a switch is just the entrance
 * animation.
 *
 * That animation is played imperatively rather than through `initial`/`animate`,
 * which only fire on mount: the panel is already mounted by the time it becomes
 * the active one.
 */
export function SectionPanel({
  sectionId,
  isActive,
  idPrefix = 'section',
  children,
}: {
  sectionId: string;
  isActive: boolean;
  idPrefix?: string;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const wasActive = useRef(isActive);

  useEffect(() => {
    const justRevealed = isActive && !wasActive.current;
    wasActive.current = isActive;
    if (!justRevealed || reduceMotion) return;

    ref.current?.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 180, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
    );
  }, [isActive, reduceMotion]);

  return (
    <div
      ref={ref}
      id={`${idPrefix}-panel-${sectionId}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${sectionId}`}
      tabIndex={-1}
      hidden={!isActive}
      className="focus:outline-none"
    >
      {children}
    </div>
  );
}
