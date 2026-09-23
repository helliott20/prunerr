import { cn } from '@/lib/utils';
import { useTypewriter } from './useTypewriter';

/**
 * Trigger label with the typewriter reveal.
 *
 * Width is reserved up front: every string in `reserve` is rendered invisibly
 * in the same grid cell, so the trigger is already its final size (the longest
 * option) while the text types in — nothing around it moves. When the trigger
 * is narrower than that (fixed width / max-width), the finished label
 * truncates with an ellipsis and the full text is in `title`.
 */
export function TypewriterLabel({
  text,
  reserve,
  playKey,
  className,
}: {
  text: string;
  reserve?: string[];
  playKey: number;
  className?: string;
}) {
  const { typed, done } = useTypewriter(text, playKey);
  const ghosts = reserve && reserve.length ? reserve : [text];

  return (
    <span className={cn('grid min-w-0', className)}>
      {ghosts.map((g, i) => (
        <span key={i} aria-hidden className="invisible whitespace-nowrap [grid-area:1/1]">
          {g}
        </span>
      ))}
      <span
        title={text}
        className={cn(
          'whitespace-pre overflow-hidden [grid-area:1/1]',
          done ? 'text-ellipsis' : 'text-clip'
        )}
      >
        {typed}
        {playKey > 0 && (
          <span
            key={`${playKey}-${done ? 'done' : 'typing'}`}
            aria-hidden
            className={cn('dd-caret', done && 'dd-caret-out')}
          />
        )}
      </span>
    </span>
  );
}
