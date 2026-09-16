import { useEffect, useState } from 'react';

/**
 * Whether the measured content is tall enough to be worth jumping around in.
 *
 * Returns a callback ref rather than taking a RefObject: the detail page
 * renders a skeleton first, so a ref object would still be null when the
 * effect ran and the observer would never attach. A callback ref re-runs the
 * effect the moment the real node mounts.
 *
 * Re-measures as the content grows — expanding a season is exactly what turns
 * a short page into a long one.
 */
export function useIsLongContent(factor = 1.4): [(node: HTMLElement | null) => void, boolean] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [isLong, setIsLong] = useState(false);

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return;

    const measure = () => setIsLong(node.getBoundingClientRect().height > window.innerHeight * factor);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [node, factor]);

  return [setNode, isLong];
}
