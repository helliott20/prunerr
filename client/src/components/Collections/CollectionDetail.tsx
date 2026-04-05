import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Shield, ShieldOff, Film, Layers } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { ConfirmModal } from '@/components/common/Modal';
import { collectionsApi } from '@/services/api';
import { formatBytes, formatDate, formatRelativeTime } from '@/lib/utils';
import type { CollectionItem } from '@/types';

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const numericId = id ? parseInt(id, 10) : NaN;

  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    data: collection,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['collections', 'detail', numericId],
    queryFn: () => collectionsApi.getById(numericId),
    enabled: !isNaN(numericId),
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['collections', 'items', numericId],
    queryFn: () => collectionsApi.getItems(numericId),
    enabled: !isNaN(numericId),
  });

  const protectionMutation = useMutation({
    mutationFn: (isProtected: boolean) =>
      collectionsApi.setProtection(numericId, {
        isProtected,
        reason: isProtected ? 'Manually protected from Collections UI' : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setConfirmOpen(false);
    },
  });

  if (isNaN(numericId)) {
    return <p className="text-ruby-400">Invalid collection ID</p>;
  }

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (isError || !collection) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Card className="p-12 text-center">
          <div className="p-4 rounded-2xl bg-ruby-500/10 inline-block mb-4">
            <Layers className="w-8 h-8 text-ruby-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">
            {isError ? 'Failed to load collection' : 'Collection not found'}
          </h2>
          <p className="text-surface-400 text-sm mb-6">
            {(error as Error)?.message || 'This collection could not be found.'}
          </p>
          <Button variant="secondary" onClick={() => navigate('/collections')}>
            Back to Collections
          </Button>
        </Card>
      </div>
    );
  }

  const isProtected = collection.isProtected;

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* Poster */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="aspect-[2/3] relative bg-gradient-to-br from-surface-800 to-surface-900">
              {collection.posterUrl ? (
                <img
                  src={collection.posterUrl}
                  alt={collection.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-6">
                  <Layers className="w-16 h-16 text-surface-600" />
                </div>
              )}
            </div>
          </Card>

          {/* Protection toggle */}
          <Button
            variant={isProtected ? 'secondary' : 'primary'}
            className="w-full"
            onClick={() => setConfirmOpen(true)}
            data-testid="protection-toggle"
          >
            {isProtected ? (
              <>
                <ShieldOff className="w-4 h-4" />
                Unprotect
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                Protect this collection
              </>
            )}
          </Button>
        </div>

        {/* Details */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h1 className="text-2xl font-display font-bold text-white">{collection.title}</h1>
              {isProtected && (
                <Badge variant="accent">
                  <Shield className="w-3 h-3" />
                  Protected
                </Badge>
              )}
            </div>
            {collection.overview && (
              <p className="text-sm text-surface-400 leading-relaxed mt-2">
                {collection.overview}
              </p>
            )}
            <div className="flex items-center gap-3 mt-4 flex-wrap text-xs text-surface-400">
              <span>
                <strong className="text-surface-200">{collection.itemCount}</strong> item
                {collection.itemCount === 1 ? '' : 's'}
              </span>
              {collection.lastSyncedAt && (
                <span>Last synced {formatRelativeTime(collection.lastSyncedAt)}</span>
              )}
            </div>
          </div>

          {isProtected && collection.protectedAt && (
            <Card className="p-4 border-accent-500/30 bg-accent-500/5">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-accent-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-accent-300 font-medium">Collection protected</p>
                  <p className="text-surface-400 text-xs mt-1">
                    Since {formatDate(collection.protectedAt)}
                  </p>
                  {collection.protectionReason && (
                    <p className="text-surface-300 text-xs mt-1">
                      {collection.protectionReason}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Items */}
          <div>
            <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-4">
              Items in collection
            </h2>
            {itemsLoading ? (
              <ItemsSkeleton />
            ) : items.length === 0 ? (
              <Card className="p-8 text-center">
                <Film className="w-8 h-8 text-surface-600 mx-auto mb-2" />
                <p className="text-sm text-surface-400">
                  No items from this collection are in your library yet.
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {items.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => protectionMutation.mutate(!isProtected)}
        title={isProtected ? 'Unprotect collection' : 'Protect collection'}
        message={
          isProtected
            ? `Remove protection from "${collection.title}"? Items in this collection will be subject to deletion rules again.`
            : `Protect "${collection.title}"? All items in this collection (current and future) will be shielded from deletion rules.`
        }
        confirmText={isProtected ? 'Unprotect' : 'Protect'}
        variant={isProtected ? 'warning' : 'primary'}
        isLoading={protectionMutation.isPending}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/collections"
      className="inline-flex items-center gap-2 text-surface-400 hover:text-white transition-colors text-sm"
    >
      <ArrowLeft className="w-4 h-4" />
      Back to collections
    </Link>
  );
}

function ItemCard({ item }: { item: CollectionItem }) {
  return (
    <Link to={`/library/${item.id}`} className="block group">
      <Card variant="interactive" className="overflow-hidden h-full flex flex-col">
        <div className="aspect-[2/3] bg-gradient-to-br from-surface-800 to-surface-900 relative">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={item.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-10 h-10 text-surface-600" />
            </div>
          )}
          {item.isProtected && (
            <div className="absolute top-2 left-2 p-1 rounded-md bg-accent-500/90 backdrop-blur-sm">
              <Shield className="w-3 h-3 text-white" />
            </div>
          )}
        </div>
        <div className="p-2.5 flex-1 flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-white line-clamp-2 leading-tight">
            {item.title}
          </h3>
          <div className="flex items-center justify-between mt-auto text-2xs text-surface-500">
            {item.year && <span>{item.year}</span>}
            {item.size > 0 && <span>{formatBytes(item.size)}</span>}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-32 bg-surface-800/80 rounded animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        <div className="space-y-4">
          <div className="aspect-[2/3] rounded-2xl bg-surface-800/80 animate-pulse" />
          <div className="h-10 bg-surface-800/80 rounded-xl animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="h-8 w-2/3 bg-surface-800/80 rounded animate-pulse" />
          <div className="h-16 bg-surface-800/60 rounded animate-pulse" />
          <ItemsSkeleton />
        </div>
      </div>
    </div>
  );
}

function ItemsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="rounded-2xl overflow-hidden border border-surface-700/50"
        >
          <div className="aspect-[2/3] bg-surface-800/60 animate-pulse" />
          <div className="p-2.5 space-y-1.5">
            <div className="h-3 bg-surface-800/60 rounded animate-pulse" />
            <div className="h-2.5 w-1/2 bg-surface-800/40 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
