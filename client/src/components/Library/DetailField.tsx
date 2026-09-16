import { cn } from '@/lib/utils';

export interface DetailFieldProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}

/**
 * Icon + label + value row used across the media detail view (Details card,
 * Sonarr panel) so every stat on the page reads the same way.
 */
export function DetailField({ icon, label, value, className, valueClassName }: DetailFieldProps) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div className="p-2 rounded-lg bg-surface-800/60 text-surface-400 flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-surface-500 font-medium">{label}</p>
        <p className={cn('text-sm text-surface-200 mt-0.5 break-words', valueClassName)}>{value}</p>
      </div>
    </div>
  );
}
