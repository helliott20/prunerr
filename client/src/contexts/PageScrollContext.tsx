import { createContext, useContext, useMemo, type ReactNode, type RefObject } from 'react';

interface PageScrollContextValue {
  /** Jump the page scroller back to the top. */
  scrollToTop: () => void;
}

/**
 * Defaults to a no-op so a page rendered outside the layout — a unit test,
 * say — can call this without a provider.
 */
const PageScrollContext = createContext<PageScrollContextValue>({ scrollToTop: () => {} });

interface PageScrollProviderProps {
  containerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function PageScrollProvider({ containerRef, children }: PageScrollProviderProps) {
  const value = useMemo<PageScrollContextValue>(
    () => ({
      scrollToTop: () => {
        // Instant rather than smooth: this stands in for the jump you get
        // when a page first opens, and a long list makes an animated scroll
        // feel like a hang.
        containerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      },
    }),
    [containerRef]
  );

  return <PageScrollContext.Provider value={value}>{children}</PageScrollContext.Provider>;
}

/**
 * Lets a page move the layout's scroll container, which it does not own.
 *
 * Paging through a list is the case this exists for: the list swaps its rows
 * without changing the route, so nothing resets the scroll, and clicking
 * "next" from the controls at the bottom would otherwise leave you looking at
 * the last rows of the new page.
 */
export function usePageScroll() {
  return useContext(PageScrollContext);
}
