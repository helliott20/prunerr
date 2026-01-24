import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'movie'
  | 'tv'
  | 'violet'
  | 'emerald'
  | 'ruby'
  | 'cyan'
  | 'muted';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function Badge({
  className,
  variant = 'default',
  size = 'md',
  children,
  ...props
}: BadgeProps) {
  const variants: Record<BadgeVariant, string> = {
    default: 'bg-surface-700/50 text-surface-300 border-surface-600/30',
    accent: 'bg-accent-500/15 text-accent-400 border-accent-500/20',
    success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    danger: 'bg-ruby-500/15 text-ruby-400 border-ruby-500/20',
    movie: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    tv: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    violet: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    ruby: 'bg-ruby-500/15 text-ruby-400 border-ruby-500/20',
    cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
    muted: 'bg-surface-800/50 text-surface-400 border-surface-700/30',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-2xs gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-lg font-medium tracking-wide border',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
