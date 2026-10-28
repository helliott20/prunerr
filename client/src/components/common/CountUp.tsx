import { useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from 'framer-motion';

/**
 * Animates a number from its previous value up to `value` whenever it
 * changes (e.g. 0 → 42 when a preview resolves). Respects reduced-motion by
 * snapping instantly. Uses a motion value so only the text node updates, not
 * the React tree. `format` turns the in-between values into text (whole
 * numbers by default, or e.g. formatBytes for sizes).
 */
export function CountUp({
  value,
  format = (v) => Math.round(v).toLocaleString(),
  className,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, format);

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.5, ease: [0.4, 0, 0.2, 1] });
    return () => controls.stop();
  }, [value, reduce, mv]);

  return <motion.span className={className}>{text}</motion.span>;
}
