import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The card idiom every panel shares: 14px radius, near-black fill, hairline
 * border that lifts on hover. `failing` tints the border ruby.
 */
export function SettingsCard({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  tone?: 'default' | 'failing';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[14px] border bg-surface-900/90 transition-colors duration-200',
        tone === 'failing'
          ? 'border-ruby-500/[0.28]'
          : 'border-surface-700/90 hover:border-surface-600/90',
        className
      )}
    >
      {children}
    </div>
  );
}
