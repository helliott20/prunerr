import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Shield,
  ShieldOff,
  Layers,
  Film,
  Tv,
  Clock,
  Hash,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { collectionsApi } from '@/services/api';
import type { CollectionItem } from '@/services/api';
import { Card, CardContent } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';
import { useTranslation, Trans } from 'react-i18next';
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils';
import { DeletionAction } from '@/types';
import { DELETION_ACTIONS, deletionActionLabel, deletionActionDescription } from '@/lib/deletionActions';

function DetailSkeleton() {
  return (
    <div className="space-y-6 pb-8 animate-pulse">
      <div className="px-8 py-10">
        <div className="h-4 w-32 bg-surface-700/50 rounded-lg mb-6" />
        <div className="h-8 w-64 bg-surface-700/50 rounded-lg mb-3" />
        <div className="h-4 w-48 bg-surface-700/30 rounded-lg" />
      </div>
      <div className="px-1">
        <Card className="p-6">
          <div className="h-5 w-40 bg-surface-700/50 rounded-lg mb-4" />
          <div className="h-10 w-full bg-surface-700/30 rounded-lg" />
        </Card>
      </div>
    </div>
  );
}

function ItemRow({ item, onClick }: { item: CollectionItem; onClick: () => void }) {
  const { t } = useTranslation('collections');
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-4 px-4 py-3 text-left',
        'hover:bg-surface-800/60 transition-colors rounded-xl',
        'focus:outline-none focus:ring-2 focus:ring-accent-500/30'
      )}
    >
      {/* Poster */}
      <div className="w-10 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-surface-800/50">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {item.type === 'tv' ? (
              <Tv className="w-4 h-4 text-surface-600" />
            ) : (
              <Film className="w-4 h-4 text-surface-600" />
            )}
          </div>
        )}
      </div>

      {/* Title + year */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-surface-200 truncate">{item.title}</p>
        {item.year && (
          <p className="text-xs text-surface-500">{item.year}</p>
        )}
      </div>

      {/* Badges */}
      <div className="hidden sm:flex items-center gap-2">
        <Badge variant={item.type === 'tv' ? 'tv' : 'movie'} size="sm">
          {item.type === 'tv' ? t('itemType.tv', 'TV') : t('itemType.movie', 'Movie')}
        </Badge>
        {item.isProtected && (
          <Badge variant="success" size="sm">
            <Shield className="w-3 h-3" />
          </Badge>
        )}
      </div>

      {/* Size */}
      <span className="text-xs text-surface-500 font-mono whitespace-nowrap">
        {formatBytes(item.size)}
      </span>
    </button>
  );
}

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { t } = useTranslation('collections');

  const parsedId = parseInt(id || '', 10);
  const collectionId = Number.isNaN(parsedId) || parsedId <= 0 ? 0 : parsedId;
  const isValidId = collectionId > 0;

  const {
    data: collection,
    isLoading: isLoadingCollection,
    error: collectionError,
    refetch: refetchCollection,
  } = useQuery({
    queryKey: ['collections', collectionId],
    queryFn: () => collectionsApi.getById(collectionId),
    enabled: isValidId,
  });

  const {
    data: items,
    isLoading: isLoadingItems,
    error: itemsError,
  } = useQuery({
    queryKey: ['collections', collectionId, 'items'],
    queryFn: () => collectionsApi.getItems(collectionId),
    enabled: collectionId > 0,
  });

  const [reason, setReason] = useState('');
  const [deletionAction, setDeletionAction] = useState<DeletionAction>('unmonitor_and_delete');
  const [gracePeriodDays, setGracePeriodDays] = useState(7);
  const [resetOverseerr, setResetOverseerr] = useState(false);
  const [confirmingQueue, setConfirmingQueue] = useState(false);

  const protectionMutation = useMutation({
    mutationFn: ({
      isProtected,
      protectionReason,
    }: {
      isProtected: boolean;
      protectionReason?: string;
    }) => collectionsApi.setProtection(collectionId, isProtected, protectionReason),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.setQueryData(['collections', collectionId], updated);
      addToast({
        type: 'success',
        title: updated.isProtected
          ? t('toasts.protectedTitle', 'Collection protected')
          : t('toasts.protectionRemovedTitle', 'Protection removed'),
        message: updated.isProtected
          ? t('toasts.protectedMsg', '"{{title}}" is now protected', { title: updated.title })
          : t('toasts.protectionRemovedMsg', '"{{title}}" is no longer protected', { title: updated.title }),
      });
    },
    onError: (err: Error) => {
      addToast({
        type: 'error',
        title: t('toasts.protectionFailedTitle', 'Failed to update protection'),
        message: err.message || t('toasts.somethingWrong', 'Something went wrong'),
      });
    },
  });

  const queueMutation = useMutation({
    mutationFn: (vars: { deletionAction: string; gracePeriodDays: number; resetOverseerr: boolean }) =>
      collectionsApi.queueForDeletion(collectionId, vars),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['collections', collectionId, 'items'] });
      setConfirmingQueue(false);
      addToast({
        type: 'success',
        title: t('toasts.queuedTitle', 'Collection queued for deletion'),
        message:
          t('toasts.queuedMsg', 'Queued {{count}} items ({{size}})', { count: result.queued, size: formatBytes(result.totalSize) }) +
          (result.skipped > 0 ? t('toasts.queuedSkippedSuffix', ', {{count}} skipped', { count: result.skipped }) : ''),
      });
    },
    onError: (err: Error) => {
      setConfirmingQueue(false);
      addToast({
        type: 'error',
        title: t('toasts.queueFailedTitle', 'Failed to queue collection'),
        message: err.message || t('toasts.somethingWrong', 'Something went wrong'),
      });
    },
  });

  if (!isValidId) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Layers}
          title={t('notFound.title', 'Collection not found')}
          description={t('notFound.invalidIdDesc', 'The collection ID in the URL is not valid.')}
          action={{ label: t('backToCollections', 'Back to Collections'), onClick: () => navigate('/collections') }}
        />
      </div>
    );
  }

  if (isLoadingCollection) {
    return <DetailSkeleton />;
  }

  if (collectionError) {
    return (
      <div className="p-6">
        <ErrorState
          error={collectionError as Error}
          title={t('errors.loadCollection', 'Failed to load collection')}
          retry={() => refetchCollection()}
        />
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Layers}
          title={t('notFound.title', 'Collection not found')}
          description={t('notFound.removedDesc', 'This collection may have been removed.')}
          action={{ label: t('backToCollections', 'Back to Collections'), onClick: () => navigate('/collections') }}
        />
      </div>
    );
  }

  const handleToggleProtection = () => {
    protectionMutation.mutate({
      isProtected: !collection.isProtected,
      protectionReason: !collection.isProtected ? reason || undefined : undefined,
    });
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <header className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-500/5 via-transparent to-violet-500/5 rounded-3xl" />
        <div className="relative px-8 py-10">
          <button
            type="button"
            onClick={() => navigate('/collections')}
            className="inline-flex items-center gap-2 text-sm text-surface-400 hover:text-surface-50 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('backToCollections', 'Back to Collections')}
          </button>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-4xl font-display font-bold text-surface-50 tracking-tight">
                {collection.title}
              </h1>
              {collection.overview && (
                <p className="text-surface-400 mt-2 max-w-2xl">
                  {collection.overview}
                </p>
              )}
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <Badge variant="muted" size="sm">
                  <Hash className="w-3 h-3" />
                  {t('badges.tmdb', 'TMDB {{id}}', { id: collection.tmdbId })}
                </Badge>
                <Badge variant="accent" size="sm">
                  {t('card.itemCount', '{{count}} items', { count: collection.itemCount })}
                </Badge>
                {collection.lastSyncedAt && (
                  <Badge variant="muted" size="sm">
                    <Clock className="w-3 h-3" />
                    {t('badges.synced', 'Synced {{time}}', { time: formatRelativeTime(collection.lastSyncedAt) })}
                  </Badge>
                )}
                {collection.isProtected && (
                  <Badge variant="success" size="sm">
                    <Shield className="w-3 h-3" />
                    {t('badges.protected', 'Protected')}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Protection Toggle */}
      <div className="px-1">
        <Card>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-3 flex-1">
                <div
                  className={cn(
                    'p-3 rounded-xl',
                    collection.isProtected ? 'bg-emerald-500/10' : 'bg-surface-800/50'
                  )}
                >
                  <Shield
                    className={cn(
                      'w-5 h-5',
                      collection.isProtected ? 'text-emerald-400' : 'text-surface-500'
                    )}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-display font-semibold text-surface-50">
                    {t('protection.title', 'Collection Protection')}
                  </h3>
                  <p className="text-xs text-surface-500 mt-0.5">
                    {collection.isProtected
                      ? t('protection.enabledDesc', 'All items in this collection are protected from cleanup rules.')
                      : t('protection.disabledDesc', 'Enable protection to prevent items from being cleaned up.')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {!collection.isProtected && (
                  <input
                    type="text"
                    placeholder={t('protection.reasonPlaceholder', 'Reason (optional)')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className={cn(
                      'w-48 px-3 py-2 text-sm rounded-xl',
                      'bg-surface-800/60 border border-surface-700/50 text-surface-200',
                      'placeholder:text-surface-500',
                      'focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500/40',
                      'transition-colors'
                    )}
                  />
                )}
                <Button
                  type="button"
                  variant={collection.isProtected ? 'danger' : 'primary'}
                  size="sm"
                  onClick={handleToggleProtection}
                  isLoading={protectionMutation.isPending}
                >
                  {collection.isProtected ? (
                    <>
                      <ShieldOff className="w-4 h-4" />
                      {t('protection.removeButton', 'Remove Protection')}
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" />
                      {t('protection.protectButton', 'Protect Collection')}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {collection.isProtected && collection.protectionReason && (
              <div className="mt-3 px-4 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                <p className="text-xs text-emerald-400">
                  <span className="font-medium">{t('protection.reasonLabel', 'Reason:')}</span> {collection.protectionReason}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Queue for Deletion */}
      <div className="px-1">
        <Card>
          <CardContent>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-xl bg-red-500/10">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-display font-semibold text-surface-50">
                  {t('queue.title', 'Queue for Deletion')}
                </h3>
                <p className="text-xs text-surface-500 mt-0.5">
                  {t('queue.subtitle', 'Add all items in this collection to the deletion queue.')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {/* Deletion Action */}
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">
                  {t('queue.deletionActionLabel', 'Deletion Action')}
                </label>
                <select
                  value={deletionAction}
                  onChange={(e) => setDeletionAction(e.target.value as DeletionAction)}
                  className={cn(
                    'w-full px-3 py-2 text-sm rounded-xl',
                    'bg-surface-800/60 border border-surface-700/50 text-surface-200',
                    'focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500/40',
                    'transition-colors'
                  )}
                >
                  {DELETION_ACTIONS.map((value) => (
                    <option key={value} value={value}>
                      {deletionActionLabel(value)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-surface-500 mt-1">
                  {deletionActionDescription(deletionAction)}
                </p>
              </div>

              {/* Grace Period */}
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">
                  {t('queue.gracePeriodLabel', 'Grace Period (days)')}
                </label>
                <input
                  type="number"
                  min={0}
                  value={gracePeriodDays}
                  onChange={(e) => setGracePeriodDays(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className={cn(
                    'w-full px-3 py-2 text-sm rounded-xl',
                    'bg-surface-800/60 border border-surface-700/50 text-surface-200',
                    'focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500/40',
                    'transition-colors'
                  )}
                />
                <p className="text-xs text-surface-500 mt-1">
                  {t('queue.gracePeriodHelp', 'Items will be deleted after this many days.')}
                </p>
              </div>

              {/* Reset Overseerr */}
              <div className="flex items-start pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetOverseerr}
                    onChange={(e) => setResetOverseerr(e.target.checked)}
                    className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-accent-500 focus:ring-accent-500/30"
                  />
                  <span className="text-sm text-surface-300">{t('queue.resetSeerr', 'Reset in Seerr')}</span>
                </label>
              </div>
            </div>

            {/* Action Button / Confirmation */}
            {confirmingQueue ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/20">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-300 flex-1">
                  <Trans
                    i18nKey="queue.confirmPrompt"
                    t={t}
                    count={collection.itemCount}
                    defaults="This will queue <strong>{{count}} items</strong> for deletion. Are you sure?"
                    components={{ strong: <span className="font-semibold" /> }}
                  />
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmingQueue(false)}
                  >
                    {t('queue.cancel', 'Cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => queueMutation.mutate({ deletionAction, gracePeriodDays, resetOverseerr })}
                    isLoading={queueMutation.isPending}
                    className="bg-red-600 hover:bg-red-700 text-white border-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('queue.confirm', 'Confirm')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => setConfirmingQueue(true)}
                className="bg-red-600 hover:bg-red-700 text-white border-red-600"
              >
                <Trash2 className="w-4 h-4" />
                {t('queue.queueButton', 'Queue Collection for Deletion')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Items List */}
      <div className="px-1">
        <Card>
          <div className="px-6 py-4 border-b border-surface-700/50">
            <h2 className="text-base font-display font-semibold text-surface-50">
              {t('items.heading', 'Items ({{count}})', { count: items?.length ?? 0 })}
            </h2>
          </div>

          <div className="p-2">
            {isLoadingItems ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-3 text-surface-400">
                  <div className="w-5 h-5 border-2 border-surface-600 border-t-accent-500 rounded-full animate-spin" />
                  <span className="text-sm">{t('items.loading', 'Loading items...')}</span>
                </div>
              </div>
            ) : itemsError ? (
              <div className="p-4">
                <ErrorState
                  error={itemsError as Error}
                  title={t('items.loadFailed', 'Failed to load items')}
                />
              </div>
            ) : !items || items.length === 0 ? (
              <EmptyState
                icon={Film}
                title={t('items.emptyTitle', 'No items found')}
                description={t('items.emptyDesc', 'This collection has no matched media items in your library.')}
              />
            ) : (
              <div className="divide-y divide-surface-800/40">
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onClick={() => navigate(`/library/${item.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
