import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, Search, RefreshCw, Shield, Film } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { collectionsApi } from '@/services/api';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { Collection } from '@/types';

export default function Collections() {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const {
    data: collections = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['collections', 'list'],
    queryFn: () => collectionsApi.list(),
    staleTime: 5 * 60 * 1000,
  });

  const syncMutation = useMutation({
    mutationFn: () => collectionsApi.sync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return collections;
    const needle = search.toLowerCase();
    return collections.filter((c) => c.title.toLowerCase().includes(needle));
  }, [collections, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-accent-500/10 border border-accent-500/20">
            <Layers className="w-5 h-5 text-accent-400" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Collections</h1>
            <p className="text-sm text-surface-400">
              Movie franchises and series grouped by Radarr
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          onClick={() => syncMutation.mutate()}
          isLoading={syncMutation.isPending}
          data-testid="sync-collections-button"
        >
          <RefreshCw className={cn('w-4 h-4', syncMutation.isPending && 'animate-spin')} />
          Sync now
        </Button>
      </header>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
        <input
          type="text"
          placeholder="Search collections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input input-with-icon w-full"
          data-testid="collections-search"
        />
      </div>

      {syncMutation.isError && (
        <Card className="p-4 border-ruby-500/30 bg-ruby-500/10">
          <p className="text-sm text-ruby-300">
            Sync failed: {(syncMutation.error as Error)?.message || 'unknown error'}
          </p>
        </Card>
      )}

      {/* Content */}
      {isLoading ? (
        <SkeletonGrid />
      ) : isError ? (
        <Card className="p-12 text-center">
          <p className="text-ruby-400 text-sm">
            Failed to load collections: {(error as Error)?.message}
          </p>
        </Card>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No collections yet"
          description="Configure Radarr in Settings and click Sync to import collection data."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          variant="filtered"
          title="No matching collections"
          description="Try a different search term."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((c) => (
            <CollectionCard key={c.id} collection={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <Link to={`/collections/${collection.id}`} data-testid="collection-card">
      <Card variant="interactive" className="overflow-hidden h-full flex flex-col">
        <div className="aspect-[2/3] relative bg-gradient-to-br from-surface-800 to-surface-900">
          {collection.posterUrl ? (
            <img
              src={collection.posterUrl}
              alt={collection.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-4">
              <div className="text-center">
                <Film className="w-10 h-10 text-surface-600 mx-auto mb-2" />
                <p className="text-xs text-surface-400 font-medium line-clamp-3">
                  {collection.title}
                </p>
              </div>
            </div>
          )}
          {collection.isProtected && (
            <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-500/90 backdrop-blur-sm text-white text-2xs font-semibold shadow-md">
              <Shield className="w-3 h-3" />
              Protected
            </div>
          )}
        </div>
        <div className="p-3 flex-1 flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
            {collection.title}
          </h3>
          <div className="flex items-center justify-between gap-2 mt-auto">
            <Badge variant="muted" size="sm">
              {collection.itemCount} item{collection.itemCount === 1 ? '' : 's'}
            </Badge>
            {collection.lastSyncedAt && (
              <span className="text-2xs text-surface-500">
                {formatRelativeTime(collection.lastSyncedAt)}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {[...Array(10)].map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden border border-surface-700/50">
          <div className="aspect-[2/3] bg-surface-800/60 animate-pulse" />
          <div className="p-3 space-y-2">
            <div className="h-4 bg-surface-800/60 rounded animate-pulse" />
            <div className="h-3 w-1/2 bg-surface-800/40 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
