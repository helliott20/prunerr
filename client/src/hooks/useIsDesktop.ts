import { useEffect, useState } from 'react';

const QUERY = '(min-width: 1024px)';

/** Without matchMedia (tests, old browsers) both layouts are assumed to be wanted. */
const supported = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * Whether the desktop layout (lg, 1024px and up) applies. Used to mount or
 * fetch for exactly one of two layouts: rendering both and hiding one with a
 * breakpoint class would run every data fetch twice.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => (supported() ? window.matchMedia(QUERY).matches : true));

  useEffect(() => {
    if (!supported()) return;
    const query = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
