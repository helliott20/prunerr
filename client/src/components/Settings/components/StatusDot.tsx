import { cn } from '@/lib/utils';

/**
 * `required-unset` is amber, not ruby: a service that has simply never been
 * configured is not an error, and an optional one is not even noteworthy.
 */
export type StatusDotState = 'healthy' | 'failed' | 'required-unset' | 'optional-unset';

const STATE_STYLES: Record<StatusDotState, string> = {
  healthy: 'bg-emerald-500',
  failed: 'bg-ruby-500',
  'required-unset': 'bg-accent-500',
  'optional-unset': 'bg-surface-600',
};

export function StatusDot({ state, size = 5 }: { state: StatusDotState; size?: 5 | 7 }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 rounded-full',
        size === 7 ? 'h-[7px] w-[7px]' : 'h-[5px] w-[5px]',
        STATE_STYLES[state]
      )}
    />
  );
}
