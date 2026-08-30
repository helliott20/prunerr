import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Rendered but unselectable — pair with `title` to say why. */
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  /** `null` selects nothing, which is the first-run state. */
  value: T | null;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        // Full width on a phone so the segments are thumb-sized and the labels
        // stop truncating; natural width once there is room beside a label.
        'flex w-full gap-1 rounded-[11px] border border-surface-700/90 bg-surface-800/80 p-[3px]',
        'sm:inline-flex sm:w-auto',
        className
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            title={option.title}
            onClick={() => !option.disabled && onChange(option.value)}
            className={cn(
              'min-h-[38px] flex-1 rounded-lg px-2 text-xs font-semibold',
              'sm:min-h-0 sm:flex-none sm:px-[13px] sm:py-1.5',
              'transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60',
              selected
                ? 'bg-accent-500/[0.14] text-accent-text'
                : 'text-surface-400 hover:text-surface-200',
              option.disabled && 'cursor-not-allowed opacity-40 hover:text-surface-400'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
