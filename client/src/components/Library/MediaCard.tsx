import { useState } from 'react';
import { Film, Tv, Eye, EyeOff, Trash2, MoreVertical, Shield, Clock, Play, ExternalLink, Check } from 'lucide-react';
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils';
import { useMarkForDeletion, useProtectItem, useSettings } from '@/hooks/useApi';
import { DeletionOptionsModal, type DeletionOptions } from './DeletionOptionsModal';
import type { MediaItem, Settings } from '@/types';

interface MediaCardProps {
  item: MediaItem;
  onRefetch: () => void;
  index?: number;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  isSelected?: boolean;
  onToggleSelect?: (shiftKey?: boolean) => void;
}

export default function MediaCard({ item, onRefetch, index = 0, isMenuOpen, onMenuToggle, onMenuClose, isSelected, onToggleSelect }: MediaCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showDeletionModal, setShowDeletionModal] = useState(false);
  const deleteMutation = useMarkForDeletion();
  const protectMutation = useProtectItem();
  const { data: settings } = useSettings();

  // Build external URLs
  const externalLinks = buildExternalLinks(item, settings);

  // Check if Overseerr is configured
  const hasOverseerr = Boolean(settings?.services?.overseerr?.url);

  const handleMarkForDeletion = () => {
    onMenuClose();
    setShowDeletionModal(true);
  };

  const handleConfirmDeletion = (options: DeletionOptions) => {
    deleteMutation.mutate({
      id: item.id,
      options: {
        gracePeriodDays: options.gracePeriodDays,
        deletionAction: options.deletionAction,
        resetOverseerr: options.resetOverseerr,
      },
    }, {
      onSuccess: () => {
        setShowDeletionModal(false);
        onRefetch();
      },
    });
  };

  const handleProtect = () => {
    protectMutation.mutate(item.id, {
      onSuccess: () => {
        onMenuClose();
        onRefetch();
      },
    });
  };

  const TypeIcon = item.type === 'movie' ? Film : Tv;
  const typeColor = item.type === 'movie' ? 'violet' : 'emerald';

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't select if clicking on menu button or menu items
    const target = e.target as HTMLElement;
    if (target.closest('[data-menu-trigger]') || target.closest('[data-menu-content]')) {
      return;
    }
    onToggleSelect?.(e.shiftKey);
  };

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        "group relative rounded-2xl overflow-hidden bg-surface-900/80 border transition-all duration-300 ease-out animate-fade-up opacity-0 cursor-pointer select-none",
        "hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-1 hover:scale-[1.02]",
        isMenuOpen && "z-50",
        isSelected
          ? "border-accent-500 ring-2 ring-accent-500/30 bg-accent-500/5"
          : "border-surface-700/50 hover:border-accent-500/50"
      )}
      style={{
        animationDelay: `${index * 30}ms`,
        animationFillMode: 'forwards'
      }}
    >
      {/* Selection indicator - appears on hover or when selected */}
      <div
        className={cn(
          "absolute top-3 left-3 z-20 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all pointer-events-none",
          isSelected
            ? "bg-accent-500 border-accent-500 opacity-100 scale-100"
            : "bg-surface-900/80 border-surface-400 opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
        )}
      >
        {isSelected ? (
          <Check className="w-4 h-4 text-white" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-surface-400 opacity-0 group-hover:opacity-50" />
        )}
      </div>

      {/* Hover overlay for selection feedback */}
      <div className={cn(
        "absolute inset-0 z-10 pointer-events-none transition-opacity duration-200",
        isSelected
          ? "bg-accent-500/10"
          : "bg-accent-500/0 group-hover:bg-accent-500/5"
      )} />

      {/* Poster Container */}
      <div className="aspect-[2/3] relative overflow-hidden">
        {/* Loading skeleton */}
        {!imageLoaded && item.posterUrl && (
          <div className="absolute inset-0 skeleton-shimmer" />
        )}

        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className={cn(
              'w-full h-full object-cover transition-all duration-500',
              imageLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-105',
              'group-hover:scale-110'
            )}
            onLoad={() => setImageLoaded(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-surface-800 to-surface-900 flex items-center justify-center">
            <div className={cn(
              'p-6 rounded-2xl',
              typeColor === 'violet' ? 'bg-violet-500/10' : 'bg-emerald-500/10'
            )}>
              <TypeIcon className={cn(
                'w-12 h-12',
                typeColor === 'violet' ? 'text-violet-500/50' : 'text-emerald-500/50'
              )} />
            </div>
          </div>
        )}

        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-950 via-transparent to-transparent opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-surface-950 via-surface-950/60 to-transparent opacity-0 group-hover:opacity-90 transition-opacity duration-300" />

        {/* Play button on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform group-hover:scale-100 scale-90">
          <div className="p-4 rounded-full bg-accent-500/90 shadow-lg shadow-accent-500/30 backdrop-blur-sm">
            <Play className="w-6 h-6 text-surface-950 fill-current" />
          </div>
        </div>

        {/* Status badges - top left */}
        <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
          {item.status === 'queued' && (
            <span className="badge bg-ruby-500/20 text-ruby-400 border border-ruby-500/30 text-2xs font-semibold">
              <Trash2 className="w-3 h-3" />
              Queued
            </span>
          )}
          {item.status === 'deleted' && (
            <span className="badge bg-surface-500/20 text-surface-400 border border-surface-500/30 text-2xs font-semibold">
              <Trash2 className="w-3 h-3" />
              Deleted
            </span>
          )}
          {item.isProtected && (
            <span className="badge bg-accent-500/20 text-accent-400 border border-accent-500/30 text-2xs font-semibold">
              <Shield className="w-3 h-3" />
              Protected
            </span>
          )}
        </div>

        {/* Watch status indicator - top right */}
        <div className="absolute top-3 right-3 z-10">
          {item.watched ? (
            <div className="p-1.5 rounded-lg bg-emerald-500/20 backdrop-blur-sm border border-emerald-500/30">
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          ) : (
            <div className="p-1.5 rounded-lg bg-surface-800/80 backdrop-blur-sm border border-surface-700/50">
              <EyeOff className="w-3.5 h-3.5 text-surface-500" />
            </div>
          )}
        </div>

        {/* Menu button - appears on hover */}
        <button
          data-menu-trigger
          onClick={(e) => {
            e.stopPropagation();
            onMenuToggle();
          }}
          className="absolute top-3 right-3 p-1.5 rounded-lg bg-surface-800/90 backdrop-blur-sm border border-surface-700/50 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-surface-700/90 hover:border-surface-600/50 z-20"
        >
          <MoreVertical className="w-4 h-4 text-surface-300" />
        </button>

        {/* Bottom info overlay - appears on hover */}
        <div className="absolute bottom-0 left-0 right-0 p-4 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out">
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-400 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {item.lastWatched ? formatRelativeTime(item.lastWatched) : 'Never watched'}
            </span>
            <span className="text-surface-300 font-medium">{formatBytes(item.size)}</span>
          </div>
        </div>
      </div>

      {/* Dropdown menu - outside poster container to avoid overflow clipping */}
      {isMenuOpen && (
        <div data-menu-content className="absolute top-12 right-3 z-40 bg-surface-800/95 backdrop-blur-xl border border-surface-700/50 rounded-xl shadow-2xl shadow-black/50 py-1.5 min-w-[160px] max-h-[320px] overflow-y-auto animate-fade-down">
            {/* External Links */}
            {externalLinks.length > 0 && (
              <>
                <div className="px-4 py-1.5 text-xs font-medium text-surface-500 uppercase tracking-wider">
                  Open in
                </div>
                {externalLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full px-4 py-2.5 text-left text-sm text-surface-300 hover:bg-surface-700/50 flex items-center gap-3 transition-colors"
                    onClick={onMenuClose}
                  >
                    <ExternalLink className="w-4 h-4 text-surface-400" />
                    {link.name}
                  </a>
                ))}
                <div className="border-t border-surface-700/50 my-1" />
              </>
            )}
            {/* Actions */}
            {!item.isProtected && item.status !== 'queued' && (
              <button
                onClick={handleMarkForDeletion}
                disabled={deleteMutation.isPending}
                className="w-full px-4 py-2.5 text-left text-sm text-surface-300 hover:bg-ruby-500/10 hover:text-ruby-400 flex items-center gap-3 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Mark for Deletion
              </button>
            )}
            <button
              onClick={handleProtect}
              disabled={protectMutation.isPending}
              className="w-full px-4 py-2.5 text-left text-sm text-surface-300 hover:bg-accent-500/10 hover:text-accent-400 flex items-center gap-3 transition-colors disabled:opacity-50"
            >
              <Shield className="w-4 h-4" />
              {item.isProtected ? 'Remove Protection' : 'Protect Item'}
            </button>
        </div>
      )}

      {/* Card Footer */}
      <div className="p-4 relative">
        {/* Subtle glow effect based on type */}
        <div className={cn(
          'absolute inset-x-0 top-0 h-px',
          typeColor === 'violet'
            ? 'bg-gradient-to-r from-transparent via-violet-500/30 to-transparent'
            : 'bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent'
        )} />

        <h3 className="text-sm font-display font-semibold text-surface-100 line-clamp-2 leading-snug group-hover:text-white transition-colors">
          {item.title}
        </h3>

        <div className="mt-2.5 flex items-center gap-2">
          <span className={cn(
            'badge text-2xs',
            typeColor === 'violet' ? 'badge-violet' : 'badge-emerald'
          )}>
            <TypeIcon className="w-3 h-3" />
            {item.type === 'movie' ? 'Movie' : 'TV Show'}
          </span>
          {item.year && (
            <span className="text-xs text-surface-500 font-medium">{item.year}</span>
          )}
        </div>

        {/* Play count indicator */}
        {item.playCount !== undefined && item.playCount > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-2xs text-surface-500">
            <Play className="w-3 h-3" />
            <span>Played {item.playCount} {item.playCount === 1 ? 'time' : 'times'}</span>
          </div>
        )}
      </div>

      {/* Deletion Options Modal */}
      <DeletionOptionsModal
        isOpen={showDeletionModal}
        onClose={() => setShowDeletionModal(false)}
        onConfirm={handleConfirmDeletion}
        item={item}
        isLoading={deleteMutation.isPending}
        showOverseerr={hasOverseerr}
      />
    </div>
  );
}

// Helper to build external links based on available IDs and settings
interface ExternalLinkItem {
  name: string;
  url: string;
}

function buildExternalLinks(item: MediaItem, settings?: Settings | null): ExternalLinkItem[] {
  const links: ExternalLinkItem[] = [];

  if (!settings?.services) return links;

  const services = settings.services;

  // Plex link
  if (services.plex?.url && item.plexId) {
    const plexUrl = services.plex.url.replace(/\/$/, '');
    links.push({
      name: 'Plex',
      url: `${plexUrl}/web/index.html#!/server/*/details?key=%2Flibrary%2Fmetadata%2F${item.plexId}`,
    });
  }

  // Sonarr link (for TV shows)
  if (services.sonarr?.url && item.sonarrId && item.type === 'tv') {
    const sonarrUrl = services.sonarr.url.replace(/\/$/, '');
    links.push({
      name: 'Sonarr',
      url: `${sonarrUrl}/series/${item.sonarrId}`,
    });
  }

  // Radarr link (for movies)
  if (services.radarr?.url && item.radarrId && item.type === 'movie') {
    const radarrUrl = services.radarr.url.replace(/\/$/, '');
    links.push({
      name: 'Radarr',
      url: `${radarrUrl}/movie/${item.radarrId}`,
    });
  }

  // Tautulli link
  if (services.tautulli?.url && item.plexId) {
    const tautulliUrl = services.tautulli.url.replace(/\/$/, '');
    links.push({
      name: 'Tautulli',
      url: `${tautulliUrl}/info?rating_key=${item.plexId}`,
    });
  }

  // Overseerr link
  if (services.overseerr?.url && item.tmdbId) {
    const overseerrUrl = services.overseerr.url.replace(/\/$/, '');
    const overseerrType = item.type === 'movie' ? 'movie' : 'tv';
    links.push({
      name: 'Overseerr',
      url: `${overseerrUrl}/${overseerrType}/${item.tmdbId}`,
    });
  }

  // TMDB link
  if (item.tmdbId) {
    const tmdbType = item.type === 'movie' ? 'movie' : 'tv';
    links.push({
      name: 'TMDB',
      url: `https://www.themoviedb.org/${tmdbType}/${item.tmdbId}`,
    });
  }

  // IMDB link
  if (item.imdbId) {
    links.push({
      name: 'IMDb',
      url: `https://www.imdb.com/title/${item.imdbId}`,
    });
  }

  return links;
}
