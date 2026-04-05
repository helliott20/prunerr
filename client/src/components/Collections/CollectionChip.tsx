import { Link } from 'react-router-dom';
import { Layers, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CollectionChipProps {
  id: number;
  title: string;
  isProtected?: boolean;
  className?: string;
}

export function CollectionChip({ id, title, isProtected, className }: CollectionChipProps) {
  return (
    <Link
      to={`/collections/${id}`}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border',
        'transition-colors',
        isProtected
          ? 'bg-accent-500/15 text-accent-400 border-accent-500/20 hover:bg-accent-500/25'
          : 'bg-surface-800/60 text-surface-300 border-surface-700/40 hover:bg-surface-700/60 hover:text-white',
        className
      )}
      data-testid="collection-chip"
    >
      {isProtected ? (
        <Shield className="w-3 h-3" data-testid="collection-chip-shield" />
      ) : (
        <Layers className="w-3 h-3" />
      )}
      <span className="truncate max-w-[16ch]">{title}</span>
    </Link>
  );
}
