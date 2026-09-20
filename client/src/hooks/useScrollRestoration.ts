import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Scroll positions by history entry key, for the lifetime of the tab.
 *
 * Module scope rather than component state: the map has to outlive the
 * remounts that route transitions cause, and it is deliberately not persisted
 * — a reloaded tab gets fresh history keys anyway, so stored entries could
 * never be matched again.
 */
const scrollPositions = new Map<string, number>();

/**
 * How long to keep trying to put a restored position back. The content being
 * returned to is usually still being fetched, so the container starts out too
 * short to hold the offset.
 */
const RESTORE_TIMEOUT_MS = 800;

/**
 * Gives an app-owned scroll container the scroll behaviour a browser gives a
 * normal document: a new page starts at the top, and going back lands where
 * you left off.
 *
 * Neither happens for free here. The page scroller is a `<main>` element, not
 * the document, so the browser's own scroll restoration never touches it, and
 * React Router's `<ScrollRestoration>` is data-router-only and window-bound.
 * Without this, every navigation simply inherits the previous page's
 * scrollTop — click a link near the bottom of a long list and the next page
 * opens halfway down.
 */
export function useScrollRestoration(containerRef: RefObject<HTMLElement | null>) {
  const location = useLocation();
  const navigationType = useNavigationType();

  /** History entry whose scroll position the container is currently showing. */
  const activeKey = useRef(location.key);
  const previousPath = useRef(location.pathname);

  // Record the live position against the entry on screen, as it scrolls.
  //
  // Reading scrollTop at navigation time instead would lose it: by then the
  // next route has committed, and if its content is shorter the browser has
  // already clamped the container's scrollTop to fit.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        scrollPositions.set(activeKey.current, el.scrollTop);
      });
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [containerRef]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const samePage = previousPath.current === location.pathname;
    activeKey.current = location.key;
    previousPath.current = location.pathname;

    // A query-string change on the page you are already on is not a
    // navigation to somewhere new — the settings rail writes `?section=` as
    // you scroll past each section, and yanking the scroll back would fight
    // the user. Same path, same scroll.
    if (samePage) return;

    const saved = navigationType === 'POP' ? scrollPositions.get(location.key) : undefined;
    if (!saved) {
      el.scrollTop = 0;
      return;
    }

    // Back/forward to a position we remember. Keep reapplying it until the
    // content has grown enough to hold it, the deadline passes, or the user
    // takes over — whichever comes first.
    let cancelled = false;
    let frame = 0;
    const deadline = performance.now() + RESTORE_TIMEOUT_MS;

    const stop = () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };

    const attempt = () => {
      if (cancelled) return;
      el.scrollTop = saved;
      // The browser clamps to what currently fits, so a short read means the
      // content is not all there yet.
      if (Math.abs(el.scrollTop - saved) < 1 || performance.now() > deadline) {
        stop();
        return;
      }
      frame = requestAnimationFrame(attempt);
    };

    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    attempt();

    return stop;
  }, [containerRef, location.key, location.pathname, navigationType]);
}
