import { describe, it, expect } from 'vitest';
import { useEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';

import { useScrollRestoration } from '../useScrollRestoration';

/**
 * A stand-in for the `<main>` scroll container. jsdom has no layout, so a real
 * element's scrollTop never moves; this one clamps to a `max` the test
 * controls, which is what makes the "content has not loaded yet" path testable.
 */
function createScroller() {
  const el = document.createElement('div');
  let value = 0;
  let max = 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => value,
    set: (next: number) => {
      value = Math.max(0, Math.min(next, max));
    },
    configurable: true,
  });
  return {
    el,
    setMaxScroll(next: number) {
      max = next;
    },
    scrollTo(next: number) {
      el.scrollTop = next;
      el.dispatchEvent(new Event('scroll'));
    },
  };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

/** Hands its `navigate` out so a test can drive the router from outside. */
function Harness({
  el,
  onReady,
}: {
  el: HTMLElement;
  onReady: (navigate: NavigateFunction) => void;
}) {
  const ref = useRef<HTMLElement | null>(el);
  useScrollRestoration(ref);
  const navigate = useNavigate();
  useEffect(() => {
    onReady(navigate);
  }, [onReady, navigate]);
  return null;
}

function renderAt(el: HTMLElement, path = '/queue') {
  let routerNavigate: NavigateFunction | null = null;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={<Harness el={el} onReady={(n) => { routerNavigate = n; }} />}
        />
      </Routes>
    </MemoryRouter>
  );

  return async function navigate(to: string | number) {
    await act(async () => {
      (routerNavigate as unknown as (to: string | number) => void)(to);
      await nextFrame();
    });
  };
}

describe('useScrollRestoration', () => {
  it('starts a newly opened page at the top', async () => {
    const scroller = createScroller();
    scroller.setMaxScroll(5000);
    const navigate = renderAt(scroller.el);

    await act(async () => {
      scroller.scrollTo(1200);
      await nextFrame();
    });
    expect(scroller.el.scrollTop).toBe(1200);

    await navigate('/library/7');

    expect(scroller.el.scrollTop).toBe(0);
  });

  it('leaves the scroll alone when only the query string changes', async () => {
    const scroller = createScroller();
    scroller.setMaxScroll(5000);
    const navigate = renderAt(scroller.el, '/settings');

    await act(async () => {
      scroller.scrollTo(800);
      await nextFrame();
    });

    // The settings rail rewrites ?section= as you scroll past each section.
    await navigate('/settings?section=alerts');

    expect(scroller.el.scrollTop).toBe(800);
  });

  it('restores the previous position on back', async () => {
    const scroller = createScroller();
    scroller.setMaxScroll(5000);
    const navigate = renderAt(scroller.el);

    await act(async () => {
      scroller.scrollTo(1500);
      await nextFrame();
    });
    await navigate('/library/7');
    expect(scroller.el.scrollTop).toBe(0);

    await navigate(-1);

    expect(scroller.el.scrollTop).toBe(1500);
  });

  it('keeps reapplying a restored position until the content is tall enough', async () => {
    const scroller = createScroller();
    scroller.setMaxScroll(5000);
    const navigate = renderAt(scroller.el);

    await act(async () => {
      scroller.scrollTo(2000);
      await nextFrame();
    });
    await navigate('/library/7');

    // Going back to a page whose list is still being fetched: the container
    // cannot hold the old offset yet, so the first attempt gets clamped.
    scroller.setMaxScroll(300);
    await navigate(-1);
    expect(scroller.el.scrollTop).toBe(300);

    // ...and once the rows land, the saved position becomes reachable.
    scroller.setMaxScroll(5000);
    await act(async () => {
      await nextFrame();
      await nextFrame();
    });

    expect(scroller.el.scrollTop).toBe(2000);
  });

  it('does not restore a position onto a forward navigation', async () => {
    const scroller = createScroller();
    scroller.setMaxScroll(5000);
    const navigate = renderAt(scroller.el);

    await act(async () => {
      scroller.scrollTo(900);
      await nextFrame();
    });
    await navigate('/library/7');
    await navigate(-1);
    expect(scroller.el.scrollTop).toBe(900);

    // Same destination as before, but reached by a link rather than the back
    // button — that is a fresh visit and belongs at the top.
    await navigate('/library/7');

    expect(scroller.el.scrollTop).toBe(0);
  });
});
