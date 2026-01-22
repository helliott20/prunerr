import { cn } from '@/lib/utils';
import { Button } from './Button';

export type EmptyStateVariant = 'default' | 'success' | 'filtered';

export interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  variant?: EmptyStateVariant;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  variant = 'default',
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('empty-state py-12 text-center', className)}>
      <div
        className={cn(
          'w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center',
          variant === 'success'
            ? 'bg-emerald-500/10'
            : variant === 'filtered'
              ? 'bg-amber-500/10'
              : 'bg-surface-800/50'
        )}
      >
        <Icon
          className={cn(
            'w-8 h-8',
            variant === 'success'
              ? 'text-emerald-400'
              : variant === 'filtered'
                ? 'text-amber-400'
                : 'text-surface-500'
          )}
        />
      </div>
      <h3 className="text-lg font-display font-semibold text-surface-200">
        {title}
      </h3>
      <p className="text-sm text-surface-500 mt-1 max-w-md mx-auto">
        {description}
      </p>
      {action && (
        <Button variant="primary" onClick={action.onClick} className="mt-4">
          {action.label}
        </Button>
      )}
      {secondaryAction && (
        <button
          onClick={secondaryAction.onClick}
          className="mt-2 block mx-auto text-sm text-accent-400 hover:text-accent-300 transition-colors"
        >
          {secondaryAction.label}
        </button>
      )}
    </div>
  );
}
