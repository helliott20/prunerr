import { cn } from '@/lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Accessible name. Visible labelling is the caller's job. */
  label: string;
  /** `lg` is the mobile size — 48x28 track, clearing the 44px hit target. */
  size?: 'sm' | 'lg';
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, size = 'sm', disabled = false }: ToggleProps) {
  const isLarge = size === 'lg';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      data-track
      className={cn(
        'relative shrink-0 rounded-full',
        'transition-colors duration-[180ms] ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60',
        isLarge ? 'h-7 w-12' : 'h-6 w-[42px]',
        checked ? 'bg-accent-500' : 'bg-surface-600',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={cn(
          // left-0 is load-bearing: without a horizontal anchor the knob lands at
          // the button's centred static position, not the track's left edge.
          'absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-white',
          'transition-transform duration-[180ms] ease-out',
          'motion-reduce:transition-none',
          isLarge ? 'h-[22px] w-[22px]' : 'h-[18px] w-[18px]',
          checked
            ? isLarge
              ? 'translate-x-[23px]'
              : 'translate-x-[21px]'
            : 'translate-x-[3px]'
        )}
      />
    </button>
  );
}
