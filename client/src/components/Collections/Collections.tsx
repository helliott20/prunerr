import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  Shield,
  RefreshCw,
  Search,
  Film,
} from 'lucide-react';
import { collectionsApi } from '@/services/api';
import type { CollectionSummary } from '@/services/api';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';

function CollectionCardSkeleton() {
  return (
    <Card className="animate-pulse overflow-hidden">
      <div className="flex gap-4 p-4">
        <div className="w-20 h-28 rounded-xl bg-surface-700/50 flex-shrink-0" />
        <div className="flex-1 space-y-3 py-1">
          <div className="h-5 bg-surface-700/50 rounded-lg w-3/4" />
          <div className="h-3 bg-surface-700/30 rounded-lg w-1/2" />
          <div className="h-3 bg-surface-700/30 rounded-lg w-1/3" />
        </div>
      </div>
    </Card>
  );
}

function CollectionCard({
  collection,
  onClick,
}: {
  collection: CollectionSummary;
  onClick: () => void;
}) {
  return (
    <Card
      variant="interactive"
      className="overflow-hidden cursor-pointer"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex gap-4 p-4">
        {/* Poster */}
        <div className="w-20 h-28 rounded-xl overflow-hidden flex-shrink-0 bg-surface-800/50">
          {collection.posterUrl ? (
            <img
              src={collection.posterUrl}
              alt={collection.title}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-8 h-8 text-surface-600" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div>
            <h3 className="text-sm font-display font-semibold text-surface-50 truncate">
              {collection.title}
            </h3>
            {collection.overview && (
              <p className="text-xs text-surface-500 mt-1 line-clamp-2">
                {collection.overview}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <Badge variant="muted" size="sm">
              {collection.itemCount} {collection.itemCount === 1 ? 'item' : 'items'}
            </Badge>
            {collection.isProtected && (
              <Badge variant="success" size="sm">
                <Shield className="w-3 h-3" />
                Protected
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Collections() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [search, setSearch] = useState('');

  const {
    data: collections,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionsApi.list,
  });

  const syncMutation = useMutation({
    mutationFn: collectionsApi.sync,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      addToast({
        type: 'success',
        title: 'Collections synced',
        message: result.message,
      });
    },
    onError: (err: Error) => {
      addToast({
        type: 'error',
        title: 'Sync failed',
        message: err.message || 'Failed to sync collections from Radarr',
      });
    },
  });

  const filtered = (collections || []).filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <header className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-500/5 via-transparent to-violet-500/5 rounded-3xl" />
        <div className="relative px-8 py-10">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-accent-text mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Media Groups
              </p>
              <h1 className="text-4xl font-display font-bold text-surface-50 tracking-tight">
                Collections
              </h1>
              <p className="text-surface-400 mt-2 max-w-lg">
                Manage your Radarr collections. Protect entire collections to prevent their items from being cleaned up.
              </p>
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={() => syncMutation.mutate()}
              isLoading={syncMutation.isPending}
              className="self-start"
            >
              <RefreshCw className={cn('w-4 h-4', syncMutation.isPending && 'animate-spin')} />
              Sync Collections
            </Button>
          </div>
        </div>
      </header>

      {/* Search */}
      <div className="px-1">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            type="text"
            placeholder="Search collections..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              'w-full sm:w-80 pl-10 pr-4 py-2.5 text-sm rounded-xl',
              'bg-surface-800/60 border border-surface-700/50 text-surface-200',
              'placeholder:text-surface-500',
              'focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500/40',
              'transition-colors'
            )}
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <CollectionCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          error={error as Error}
          title="Failed to load collections"
          retry={() => refetch()}
        />
      ) : filtered.length === 0 && search ? (
        <EmptyState
          icon={Search}
          title="No matching collections"
          description={`No collections found matching "${search}"`}
          variant="filtered"
          action={{ label: 'Clear search', onClick: () => setSearch('') }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No collections yet"
          description="Sync your collections from Radarr to get started."
          action={{
            label: 'Sync Now',
            onClick: () => syncMutation.mutate(),
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              onClick={() => navigate(`/collections/${collection.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
