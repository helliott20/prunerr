import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Film,
  Tv,
  Eye,
  EyeOff,
  Shield,
  Trash2,
  ExternalLink,
  HardDrive,
  Calendar,
  Clock,
  BarChart3,
  Monitor,
  FileVideo,
  History,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { ActivityTimeline } from './ActivityTimeline';
import { DeletionOptionsModal, type DeletionOptions } from './DeletionOptionsModal';
import {
  useLibraryItem,
  useItemActivity,
  useMarkForDeletion,
  useProtectItem,
  useUnprotectItem,
  useSettings,
} from '@/hooks/useApi';
import { cn, formatBytes, formatRelativeTime, formatDate } from '@/lib/utils';
import type { Settings } from '@/types';

// The server returns raw DB format for single items (snake_case fields)
// We normalize it here
interface RawMediaItem {
  id: number;
  title: string;
  type: 'movie' | 'show' | 'episode';
  year?: number;
  file_size?: number;
  poster_url?: string;
  plex_id?: string;
  sonarr_id?: number;
  radarr_id?: number;
  tvdb_id?: number;
  tmdb_id?: number;
  imdb_id?: string;
  play_count?: number;
  watched_by?: string;
  last_watched_at?: string;
  added_at?: string;
  created_at?: string;
  status: string;
  is_protected?: boolean | number;
  protected_by_collection?: { id: number; title: string } | null;
  protection_reason?: string;
  resolution?: string;
  codec?: string;
  marked_at?: string;
  delete_after?: string;
  file_path?: string;
}

function normalizeItem(raw: RawMediaItem) {
  return {
    id: String(raw.id),
    numericId: raw.id,
    title: raw.title,
    type: (raw.type === 'show' || raw.type === 'episode') ? ('tv' as const) : ('movie' as const),
    year: raw.year,
    size: raw.file_size || 0,
    posterUrl: raw.poster_url,
    plexId: raw.plex_id,
    sonarrId: raw.sonarr_id,
    radarrId: raw.radarr_id,
    tvdbId: raw.tvdb_id,
    tmdbId: raw.tmdb_id,
    imdbId: raw.imdb_id,
    playCount: raw.play_count || 0,
    watchedBy: (() => {
      if (!raw.watched_by) return null;
      try {
        const parsed = typeof raw.watched_by === 'string' ? JSON.parse(raw.watched_by) : raw.watched_by;
        return Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
      } catch { return String(raw.watched_by); }
    })(),
    lastWatched: raw.last_watched_at,
    addedAt: raw.added_at || raw.created_at,
    status: raw.status === 'pending_deletion' ? 'queued' : raw.status === 'monitored' ? 'active' : raw.status,
    isProtected: Boolean(raw.is_protected),
    protectedByCollection: raw.protected_by_collection || null,
    protectionReason: raw.protection_reason,
    watched: (raw.play_count || 0) > 0,
    resolution: raw.resolution,
    codec: raw.codec,
    markedAt: raw.marked_at,
    deleteAfter: raw.delete_after,
    filePath: raw.file_path,
    createdAt: raw.created_at,
  };
}

export default function MediaItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showDeletionModal, setShowDeletionModal] = useState(false);

  const queryClient = useQueryClient();
  const { data: rawItem, isLoading, isError, error, refetch } = useLibraryItem(id || '');
  const { data: activityEntries, isLoading: activityLoading } = useItemActivity(id || '');
  const { data: settings } = useSettings();
  const deleteMutation = useMarkForDeletion();
  const protectMutation = useProtectItem();
  const unprotectMutation = useUnprotectItem();

  // Normalize the raw server response
  const item = rawItem ? normalizeItem(rawItem as unknown as RawMediaItem) : null;

  const hasOverseerr = Boolean(settings?.services?.overseerr?.url);
  const hasArrService = Boolean(settings?.services?.sonarr?.url || settings?.services?.radarr?.url);

  const handleConfirmDeletion = (options: DeletionOptions) => {
    if (!item) return;
    deleteMutation.mutate(
      {
        id: item.id,
        options: {
          gracePeriodDays: options.gracePeriodDays,
          deletionAction: options.deletionAction,
          resetOverseerr: options.resetOverseerr,
        },
      },
      {
        onSuccess: () => {
          setShowDeletionModal(false);
          refetch();
          queryClient.invalidateQueries({ queryKey: ['activity', 'item', id] });
        },
      }
    );
  };

  const handleProtectToggle = () => {
    if (!item) return;
    const mutation = item.isProtected ? unprotectMutation : protectMutation;
    mutation.mutate(item.id, {
      onSuccess: () => {
        refetch();
        queryClient.invalidateQueries({ queryKey: ['activity', 'item', id] });
      },
    });
  };

  // Build external links
  const externalLinks = item ? buildExternalLinks(item, settings) : [];

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (isError || !item) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate('/library')}
          className="flex items-center gap-2 text-surface-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Library
        </button>
        <Card className="p-12 text-center">
          <div className="p-4 rounded-2xl bg-ruby-500/10 inline-block mb-4">
            <Film className="w-8 h-8 text-ruby-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">
            {isError ? 'Failed to load item' : 'Item not found'}
          </h2>
          <p className="text-surface-400 text-sm mb-6">
            {isError
              ? (error as Error)?.message || 'An error occurred while loading this item.'
              : 'This media item could not be found. It may have been deleted.'}
          </p>
          <Button variant="secondary" onClick={() => navigate('/library')}>
            Return to Library
          </Button>
        </Card>
      </div>
    );
  }

  const TypeIcon = item.type === 'movie' ? Film : Tv;
  const typeColor = item.type === 'movie' ? 'violet' : 'emerald';

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-surface-400 hover:text-white transition-colors text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Library
      </button>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Poster column */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="aspect-[2/3] relative">
              {item.posterUrl ? (
                <img
                  src={item.posterUrl}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-surface-800 to-surface-900 flex items-center justify-center">
                  <div
                    className={cn(
                      'p-8 rounded-2xl',
                      typeColor === 'violet' ? 'bg-violet-500/10' : 'bg-emerald-500/10'
                    )}
                  >
                    <TypeIcon
                      className={cn(
                        'w-16 h-16',
                        typeColor === 'violet' ? 'text-violet-500/50' : 'text-emerald-500/50'
                      )}
                    />
                  </div>
                </div>
              )}

              {/* Status overlay */}
              {(item.status === 'queued' || item.status === 'deleted') && (
                <div
                  className={cn(
                    'absolute top-0 left-0 right-0 flex items-center justify-center gap-1.5 py-2 text-xs font-bold tracking-wide uppercase',
                    item.status === 'queued' && 'bg-ruby-600/95 text-white',
                    item.status === 'deleted' && 'bg-surface-700/95 text-surface-300'
                  )}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {item.status === 'queued' ? 'Queued for Deletion' : 'Deleted'}
                </div>
              )}

              {/* Protected badge */}
              {item.isProtected && item.status !== 'queued' && item.status !== 'deleted' && (
                <div className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent-500/90 backdrop-blur-sm text-white text-xs font-semibold shadow-md shadow-black/30">
                  <Shield className="w-3.5 h-3.5" />
                  {item.protectedByCollection
                    ? `Protected via ${item.protectedByCollection.title}`
                    : 'Protected'}
                </div>
              )}
            </div>
          </Card>

          {/* Action buttons */}
          <div className="space-y-2">
            <Button
              variant={item.isProtected ? 'secondary' : 'primary'}
              className="w-full"
              onClick={handleProtectToggle}
              isLoading={protectMutation.isPending || unprotectMutation.isPending}
            >
              <Shield className="w-4 h-4" />
              {item.isProtected ? 'Remove Protection' : 'Protect Item'}
            </Button>

            {!item.isProtected && item.status !== 'queued' && (
              <Button
                variant="danger"
                className="w-full"
                onClick={() => setShowDeletionModal(true)}
              >
                <Trash2 className="w-4 h-4" />
                Mark for Deletion
              </Button>
            )}
          </div>

          {/* External links */}
          {externalLinks.length > 0 && (
            <Card className="p-4">
              <h3 className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-3">
                Open in
              </h3>
              <div className="space-y-1">
                {externalLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-surface-300 hover:bg-surface-800/80 hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-surface-500" />
                    {link.name}
                  </a>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Details column */}
        <div className="space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white leading-tight">{item.title}</h1>
            </div>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <Badge variant={item.type === 'movie' ? 'movie' : 'tv'}>
                <TypeIcon className="w-3 h-3" />
                {item.type === 'movie' ? 'Movie' : 'TV Show'}
              </Badge>
              {item.year && (
                <span className="text-sm text-surface-400 font-medium">{item.year}</span>
              )}
              {item.status === 'queued' ? (
                <Badge variant="danger">Queued</Badge>
              ) : item.isProtected ? (
                <Badge variant="accent">Protected</Badge>
              ) : item.status === 'deleted' ? (
                <Badge variant="default">Deleted</Badge>
              ) : (
                <Badge variant="success">Active</Badge>
              )}
            </div>
          </div>

          {/* Details grid */}
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-4">
              Details
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField
                icon={<HardDrive className="w-4 h-4" />}
                label="File Size"
                value={formatBytes(item.size)}
              />
              <DetailField
                icon={<Monitor className="w-4 h-4" />}
                label="Resolution"
                value={item.resolution ? `${item.resolution}${item.resolution.match(/\d$/) ? 'p' : ''}` : 'Unknown'}
              />
              <DetailField
                icon={<FileVideo className="w-4 h-4" />}
                label="Codec"
                value={item.codec ? item.codec.toUpperCase() : 'Unknown'}
              />
              <DetailField
                icon={<BarChart3 className="w-4 h-4" />}
                label="Play Count"
                value={String(item.playCount)}
              />
              <DetailField
                icon={item.watched ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                label="Last Watched"
                value={
                  item.lastWatched
                    ? `${formatRelativeTime(item.lastWatched)} (${formatDate(item.lastWatched)})`
                    : 'Never'
                }
              />
              <DetailField
                icon={<Calendar className="w-4 h-4" />}
                label="Added"
                value={item.addedAt ? formatDate(item.addedAt) : 'Unknown'}
              />
              {item.watchedBy && (
                <DetailField
                  icon={<Eye className="w-4 h-4" />}
                  label="Watched By"
                  value={item.watchedBy}
                  className="sm:col-span-2"
                />
              )}
              {item.isProtected && item.protectionReason && (
                <DetailField
                  icon={<Shield className="w-4 h-4" />}
                  label="Protection Reason"
                  value={item.protectionReason}
                  className="sm:col-span-2"
                />
              )}
              {item.status === 'queued' && item.deleteAfter && (
                <DetailField
                  icon={<Clock className="w-4 h-4" />}
                  label="Scheduled Deletion"
                  value={`${formatRelativeTime(item.deleteAfter)} (${formatDate(item.deleteAfter)})`}
                  className="sm:col-span-2"
                  valueClassName="text-ruby-400"
                />
              )}
            </div>
          </Card>

          {/* Activity Timeline */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-5">
              <History className="w-4 h-4 text-surface-400" />
              <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
                Activity Timeline
              </h2>
            </div>
            <ActivityTimeline
              entries={activityEntries || []}
              isLoading={activityLoading}
              addedAt={item.addedAt}
              firstScannedAt={item.createdAt}
            />
          </Card>
        </div>
      </div>

      {/* Deletion Options Modal */}
      <DeletionOptionsModal
        isOpen={showDeletionModal}
        onClose={() => setShowDeletionModal(false)}
        onConfirm={handleConfirmDeletion}
        item={{
          id: item.id,
          title: item.title,
          type: item.type,
          size: item.size,
          watched: item.watched,
          addedAt: item.addedAt || '',
          status: item.status as 'active' | 'queued' | 'protected' | 'deleted',
          isProtected: item.isProtected,
        }}
        isLoading={deleteMutation.isPending}
        showOverseerr={hasOverseerr}
        hasArrService={hasArrService}
      />
    </div>
  );
}

// Detail field sub-component
function DetailField({
  icon,
  label,
  value,
  className,
  valueClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
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

// Loading skeleton
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-32 bg-surface-800/80 rounded animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        <div className="space-y-4">
          <div className="aspect-[2/3] rounded-2xl bg-surface-800/80 animate-pulse" />
          <div className="h-10 rounded-xl bg-surface-800/80 animate-pulse" />
        </div>
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="h-8 w-2/3 bg-surface-800/80 rounded animate-pulse" />
            <div className="flex gap-2">
              <div className="h-6 w-20 bg-surface-800/80 rounded-lg animate-pulse" />
              <div className="h-6 w-16 bg-surface-800/80 rounded-lg animate-pulse" />
            </div>
          </div>
          <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-6">
            <div className="grid grid-cols-2 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-800/80 animate-pulse" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-3 w-16 bg-surface-800/60 rounded animate-pulse" />
                    <div className="h-4 w-24 bg-surface-800/80 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-6">
            <div className="h-5 w-40 bg-surface-800/80 rounded animate-pulse mb-5" />
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-surface-800/80 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-surface-800/80 rounded w-3/4 animate-pulse" />
                    <div className="h-3 bg-surface-800/50 rounded w-1/2 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// External link builder (reused from MediaCard pattern)
interface ExternalLinkItem {
  name: string;
  url: string;
}

function buildExternalLinks(
  item: {
    plexId?: string;
    sonarrId?: number;
    radarrId?: number;
    tmdbId?: number;
    imdbId?: string;
    type: 'movie' | 'tv';
  },
  settings?: Settings | null
): ExternalLinkItem[] {
  const links: ExternalLinkItem[] = [];
  if (!settings?.services) return links;
  const services = settings.services;

  if (services.plex?.url && item.plexId) {
    const plexUrl = services.plex.url.replace(/\/$/, '');
    links.push({
      name: 'Plex',
      url: `${plexUrl}/web/index.html#!/server/*/details?key=%2Flibrary%2Fmetadata%2F${item.plexId}`,
    });
  }

  if (services.sonarr?.url && item.sonarrId && item.type === 'tv') {
    const sonarrUrl = services.sonarr.url.replace(/\/$/, '');
    links.push({ name: 'Sonarr', url: `${sonarrUrl}/series/${item.sonarrId}` });
  }

  if (services.radarr?.url && item.radarrId && item.type === 'movie') {
    const radarrUrl = services.radarr.url.replace(/\/$/, '');
    links.push({ name: 'Radarr', url: `${radarrUrl}/movie/${item.radarrId}` });
  }

  if (services.tracearr?.url) {
    const tracearrUrl = services.tracearr.url.replace(/\/$/, '');
    links.push({ name: 'Tracearr', url: `${tracearrUrl}/history` });
  } else if (services.tautulli?.url && item.plexId) {
    const tautulliUrl = services.tautulli.url.replace(/\/$/, '');
    links.push({ name: 'Tautulli', url: `${tautulliUrl}/info?rating_key=${item.plexId}` });
  }

  if (services.overseerr?.url && item.tmdbId) {
    const overseerrUrl = services.overseerr.url.replace(/\/$/, '');
    const overseerrType = item.type === 'movie' ? 'movie' : 'tv';
    links.push({ name: 'Seerr', url: `${overseerrUrl}/${overseerrType}/${item.tmdbId}` });
  }

  if (item.tmdbId) {
    const tmdbType = item.type === 'movie' ? 'movie' : 'tv';
    links.push({ name: 'TMDB', url: `https://www.themoviedb.org/${tmdbType}/${item.tmdbId}` });
  }

  if (item.imdbId) {
    links.push({ name: 'IMDb', url: `https://www.imdb.com/title/${item.imdbId}` });
  }

  return links;
}
