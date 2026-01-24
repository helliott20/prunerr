import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, disabled, isLoading, ...props }, ref) => {
    const baseStyles = cn(
      'inline-flex items-center justify-center gap-2 font-semibold rounded-xl',
      'transition-all duration-200 ease-out',
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-950',
      'disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none',
      'active:scale-[0.98]'
    );

    const variants: Record<ButtonVariant, string> = {
      primary: cn(
        'bg-gradient-to-r from-accent-500 to-accent-600 text-surface-950',
        'hover:from-accent-400 hover:to-accent-500',
        'hover:shadow-lg hover:shadow-accent-500/25',
        'focus:ring-accent-500/50'
      ),
      secondary: cn(
        'bg-surface-700/80 border border-surface-600/50 text-surface-100',
        'hover:bg-surface-600/80 hover:border-surface-500/50 hover:text-white',
        'focus:ring-surface-500/30'
      ),
      danger: cn(
        'bg-ruby-500/20 border border-ruby-500/30 text-ruby-400',
        'hover:bg-ruby-500/30 hover:border-ruby-500/50 hover:text-ruby-300',
        'focus:ring-ruby-500/30'
      ),
      ghost: cn(
        'bg-transparent text-surface-300',
        'hover:text-white hover:bg-surface-800/60',
        'focus:ring-surface-500/30'
      ),
      outline: cn(
        'bg-transparent border border-surface-600/50 text-surface-200',
        'hover:bg-surface-800/60 hover:border-surface-500/50 hover:text-white',
        'focus:ring-surface-500/30'
      ),
    };

    const sizes: Record<ButtonSize, string> = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-5 py-2.5 text-sm',
      lg: 'px-6 py-3 text-base',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Loading...
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
