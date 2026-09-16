import { useRef, useState, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NavSection {
  /** Anchor id — must match the section element's id. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Optional count shown next to the label (e.g. episodes). */
  count?: number;
}

/**
 * Sticky jump links for the sections below them, with the current one
 * highlighted as you scroll.
 *
 * The page scrolls inside <main>, so this sticks to the top of that scroller;
 * sections carry a scroll-margin so they land under the rail rather than
 * behind it.
 */
export function SectionNav({ sections, className }: { sections: NavSection[]; className?: string }) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  // A click scrolls smoothly, which fires a burst of intersections on the way;
  // the target wins until the scroll settles.
  const isJumping = useRef(false);

  useEffect(() => {
    const nodes = sections
      .map((section) => document.getElementById(section.id))
      .filter((node): node is HTMLElement => Boolean(node));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isJumping.current) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // Band across the upper third: the section heading nearest the rail wins.
      { rootMargin: '-72px 0px -65% 0px', threshold: 0 }
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [sections]);

  const jumpTo = (id: string) => {
    const node = document.getElementById(id);
    if (!node) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    isJumping.current = true;
    window.setTimeout(() => { isJumping.current = false; }, reduceMotion ? 100 : 800);
    setActiveId(id);
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  if (sections.length < 2) return null;

  return (
    <nav
      className={cn(
        'sticky top-0 z-20 -mx-1 px-1 py-2',
        // Content scrolls underneath, so the rail needs its own backdrop.
        'bg-surface-950/80 backdrop-blur-sm',
        className
      )}
    >
      <ul className="flex items-center gap-1 overflow-x-auto">
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = activeId === section.id;

          return (
            <li key={section.id} className="flex-shrink-0">
              <button
                type="button"
                onClick={() => jumpTo(section.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200',
                  isActive
                    ? 'bg-accent-500/15 text-accent-text border-accent-500/30'
                    : 'bg-surface-800/50 text-surface-400 border-transparent hover:text-surface-200 hover:bg-surface-700/60'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {section.label}
                {section.count !== undefined && (
                  <span className="text-2xs tabular-nums opacity-70">{section.count}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
