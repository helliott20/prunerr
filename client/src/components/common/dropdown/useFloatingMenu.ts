import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type MenuPhase = 'closed' | 'open' | 'closing';

export interface MenuPosition {
  top: number;
  left: number;
  minWidth: number;
  up: boolean;
}

const GAP = 6;
const VIEWPORT_PAD = 8;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Shared open/close + positioning for every dropdown menu.
 *
 * - `phase` keeps the menu mounted for the 120ms exit animation ('closing').
 * - The menu is expected to be portalled to <body> and positioned `fixed` from
 *   `pos`, so overflow-hidden cards never clip it. It flips above the trigger
 *   when there is no room below, and re-places on any scroll (capture phase —
 *   the app scrolls <main>, not the window) and on resize.
 * - Mousedown outside trigger + menu closes without stealing focus back.
 */
export function useFloatingMenu({
  triggerRef,
  menuRef,
  align = 'start',
  closeMs = 120,
}: {
  triggerRef: RefObject<HTMLElement>;
  menuRef: RefObject<HTMLElement>;
  align?: 'start' | 'end';
  closeMs?: number;
}) {
  const [phase, setPhase] = useState<MenuPhase>('closed');
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const open = useCallback(() => {
    clearTimeout(timer.current);
    setPos(null);
    setPhase('open');
  }, []);

  const close = useCallback(
    (refocus = true) => {
      clearTimeout(timer.current);
      setPhase((p) => (p === 'closed' ? p : 'closing'));
      timer.current = setTimeout(() => setPhase('closed'), prefersReducedMotion() ? 0 : closeMs);
      if (refocus) triggerRef.current?.focus({ preventScroll: true });
    },
    [closeMs, triggerRef]
  );

  const place = useCallback(() => {
    const t = triggerRef.current;
    const m = menuRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const mh = m?.offsetHeight ?? 0;
    const mw = Math.max(m?.offsetWidth ?? 0, r.width);
    const below = window.innerHeight - r.bottom;
    const up = below < mh + GAP + VIEWPORT_PAD && r.top > below;
    let left = align === 'end' ? r.right - mw : r.left;
    left = Math.min(Math.max(VIEWPORT_PAD, left), window.innerWidth - mw - VIEWPORT_PAD);
    setPos({ top: up ? r.top - GAP - mh : r.bottom + GAP, left, minWidth: r.width, up });
  }, [align, menuRef, triggerRef]);

  useLayoutEffect(() => {
    if (phase === 'closed') return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [phase, place]);

  useEffect(() => {
    if (phase !== 'open') return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [phase, close, menuRef, triggerRef]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    phase,
    isOpen: phase === 'open',
    mounted: phase !== 'closed',
    open,
    close,
    pos,
    /** Re-measure after the menu's content changes size (e.g. search filtering). */
    place,
  };
}
