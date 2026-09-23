import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './useFloatingMenu';

/**
 * Types `text` in one character at a time whenever `playKey` changes.
 * playKey 0 = initial render → show the full text, no animation.
 * Step: ~420ms total, clamped to 14–28ms per character.
 */
export function useTypewriter(text: string, playKey: number) {
  const [count, setCount] = useState(text.length);
  const iv = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    clearInterval(iv.current);
    if (playKey === 0 || prefersReducedMotion()) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const step = Math.max(14, Math.min(28, 420 / Math.max(1, text.length)));
    iv.current = setInterval(() => {
      setCount((c) => {
        if (c + 1 >= text.length) clearInterval(iv.current);
        return Math.min(text.length, c + 1);
      });
    }, step);
    return () => clearInterval(iv.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey]);

  // If the text changes without a replay (external value change), show it whole.
  useEffect(() => {
    if (playKey === 0) setCount(text.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return { typed: text.slice(0, count), done: count >= text.length };
}
