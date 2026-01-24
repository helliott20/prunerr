import { useState } from 'react';
import {
  Film,
  Tv,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Trash2,
  Shield,
  MoreHorizontal,
  ExternalLink,
  Check,
} from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { formatBytes, formatDate } from '@/lib/utils';
import { useMarkForDeletion, useProtectItem, useSettings } from '@/hooks/useApi';
import { DeletionOptionsModal, type DeletionOptions } from './DeletionOptionsModal';
import type { MediaItem, Settings } from '@/types';

interface MediaTableProps {
  items: MediaItem[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (column: string) => void;
  onRefetch: () => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string, shiftKey?: boolean) => void;
  onSelectAll?: () => void;
}

export default function MediaTable({
  items,
  sortBy,
  sortOrder,
  onSort,
  onRefetch,
  selectedIds = new Set(),
  onToggleSelect,
  onSelectAll,
}: MediaTableProps) {
  // Track which row's menu is open (by item ID)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const handleMenuToggle = (itemId: string) => {
    setOpenMenuId(openMenuId === itemId ? null : itemId);
  };

  const handleMenuClose = () => {
    setOpenMenuId(null);
  };

  const hasSelection = selectedIds.size > 0;
  const allSelected = items.length > 0 && items.every(item => selectedIds.has(item.id));
  const someSelected = items.some(item => selectedIds.has(item.id));

  return (
    <div className="card overflow-hidden relative">
      {/* Global overlay to close menu when clicking outside */}
      {openMenuId !== null && (
        <div
          className="fixed inset-0 z-10"
          onClick={handleMenuClose}
        />
      )}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12">
                <div className="w-5 h-5 flex items-center justify-center">
                  {hasSelection ? (
                    <div
                      onClick={onSelectAll}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                        allSelected
                          ? 'bg-accent-500 border-accent-500'
                          : someSelected
                            ? 'border-accent-500 bg-accent-500/30'
                            : 'border-surface-500 hover:border-surface-400'
                      }`}
                    >
                      {(allSelected || someSelected) && <Check className="w-3 h-3 text-white" />}
                    </div>
                  ) : (
                    <span className="text-surface-600 text-xs">#</span>
                  )}
                </div>
              </th>
              <SortableHeader
                label="Title"
                column="title"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
              <SortableHeader
                label="Type"
                column="type"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
              <SortableHeader
                label="Size"
                column="size"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
              <SortableHeader
                label="Last Watched"
                column="lastWatched"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
              <th>Status</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? (
              items.map((item) => (
                <MediaRow
                  key={item.id}
                  item={item}
                  onRefetch={onRefetch}
                  isMenuOpen={openMenuId === item.id}
                  onMenuToggle={() => handleMenuToggle(item.id)}
                  onMenuClose={handleMenuClose}
                  isSelected={selectedIds.has(item.id)}
                  hasSelection={hasSelection}
                  onToggleSelect={(shiftKey) => onToggleSelect?.(item.id, shiftKey)}
                />
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-surface-400">
                  No items found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SortableHeaderProps {
  label: string;
  column: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (column: string) => void;
}

function SortableHeader({
  label,
  column,
  sortBy,
  sortOrder,
  onSort,
}: SortableHeaderProps) {
  const isActive = sortBy === column;

  return (
    <th
      className="cursor-pointer hover:bg-surface-800 select-none"
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        <span className="text-surface-500">
          {isActive ? (
            sortOrder === 'asc' ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )
          ) : (
            <ChevronUp className="w-4 h-4 opacity-0" />
          )}
        </span>
      </div>
    </th>
  );
}

interface MediaRowProps {
  item: MediaItem;
  onRefetch: () => void;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  isSelected?: boolean;
  hasSelection?: boolean;
  onToggleSelect?: (shiftKey?: boolean) => void;
}

function MediaRow({ item, onRefetch, isMenuOpen, onMenuToggle, onMenuClose, isSelected, hasSelection, onToggleSelect }: MediaRowProps) {
  const [showDeletionModal, setShowDeletionModal] = useState(false);
  const deleteMutation = useMarkForDeletion();
  const protectMutation = useProtectItem();
  const { data: settings } = useSettings();

  const TypeIcon = item.type === 'movie' ? Film : Tv;

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

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't select if clicking on menu button, menu content, or links
    const target = e.target as HTMLElement;
    if (target.closest('[data-menu-trigger]') || target.closest('[data-menu-content]') || target.closest('a')) {
      return;
    }
    onToggleSelect?.(e.shiftKey);
  };

  return (
    <tr
      onClick={handleRowClick}
      className={`group cursor-pointer transition-all duration-150 select-none ${isMenuOpen ? 'relative z-20' : ''} ${
        isSelected
          ? 'bg-accent-500/10 hover:bg-accent-500/15'
          : 'hover:bg-surface-800/50'
      }`}
    >
      {/* Selection checkbox - visible on hover or when selected/hasSelection */}
      <td className="w-12">
        <div className={`transition-all duration-150 ${
          isSelected
            ? 'opacity-100'
            : hasSelection
              ? 'opacity-70'
              : 'opacity-0 group-hover:opacity-100'
        }`}>
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-accent-500 border-accent-500'
              : 'border-surface-500 group-hover:border-surface-400'
          }`}>
            {isSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        </div>
      </td>
      {/* Title */}
      <td>
        <div className="flex items-center gap-3">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt=""
              className="w-10 h-14 object-cover rounded"
            />
          ) : (
            <div className="w-10 h-14 bg-surface-800 rounded flex items-center justify-center">
              <TypeIcon className="w-5 h-5 text-surface-600" />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-white truncate max-w-xs">
              {item.title}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {item.year && (
                <span className="text-xs text-surface-400">{item.year}</span>
              )}
              {item.isProtected && (
                <Shield className="w-3 h-3 text-accent-400" />
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Type */}
      <td>
        <Badge variant={item.type}>{item.type}</Badge>
      </td>

      {/* Size */}
      <td>
        {formatBytes(item.size)}
      </td>

      {/* Last Watched */}
      <td>
        <div className="flex items-center gap-2">
          {item.watched ? (
            <>
              <Eye className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-surface-300">
                {item.lastWatched ? formatDate(item.lastWatched) : 'Watched'}
              </span>
            </>
          ) : (
            <>
              <EyeOff className="w-4 h-4 text-surface-500" />
              <span className="text-sm text-surface-500">Never</span>
            </>
          )}
        </div>
      </td>

      {/* Status */}
      <td>
        {item.status === 'queued' ? (
          <Badge variant="danger">Queued</Badge>
        ) : item.status === 'protected' ? (
          <Badge variant="accent">Protected</Badge>
        ) : item.status === 'deleted' ? (
          <Badge variant="default">Deleted</Badge>
        ) : (
          <Badge variant="success">Active</Badge>
        )}
      </td>

      {/* Actions */}
      <td className="relative">
        <button
          data-menu-trigger
          onClick={(e) => {
            e.stopPropagation();
            onMenuToggle();
          }}
          className="p-1.5 rounded hover:bg-surface-700 transition-colors"
        >
          <MoreHorizontal className="w-4 h-4 text-surface-400" />
        </button>

        {isMenuOpen && (
          <div data-menu-content className="absolute top-full right-0 mt-1 z-20 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 min-w-[180px]">
              {/* External Links */}
              {externalLinks.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-xs font-medium text-surface-500 uppercase tracking-wider">
                    Open in
                  </div>
                  {externalLinks.map((link) => (
                    <a
                      key={link.name}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-700 flex items-center gap-2"
                      onClick={onMenuClose}
                    >
                      <ExternalLink className="w-4 h-4 text-surface-400" />
                      {link.name}
                    </a>
                  ))}
                  <div className="border-t border-surface-700 my-1" />
                </>
              )}

              {/* Actions */}
              {!item.isProtected && item.status !== 'queued' && (
                <button
                  onClick={handleMarkForDeletion}
                  className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-700 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4 text-ruby-400" />
                  Mark for Deletion
                </button>
              )}
              <button
                onClick={handleProtect}
                className="w-full px-3 py-2 text-left text-sm text-surface-200 hover:bg-surface-700 flex items-center gap-2"
              >
                <Shield className="w-4 h-4 text-accent-400" />
                {item.isProtected ? 'Remove Protection' : 'Protect'}
              </button>
          </div>
        )}

        {/* Deletion Options Modal */}
        <DeletionOptionsModal
          isOpen={showDeletionModal}
          onClose={() => setShowDeletionModal(false)}
          onConfirm={handleConfirmDeletion}
          item={item}
          isLoading={deleteMutation.isPending}
          showOverseerr={hasOverseerr}
        />
      </td>
    </tr>
  );
}

// Helper to build external links based on available IDs and settings
interface ExternalLink {
  name: string;
  url: string;
}

function buildExternalLinks(item: MediaItem, settings?: Settings | null): ExternalLink[] {
  const links: ExternalLink[] = [];

  if (!settings?.services) return links;

  const services = settings.services;

  // Plex link
  if (services.plex?.url && item.plexId) {
    // Plex web URL format: /web/index.html#!/server/{machineId}/details?key=%2Flibrary%2Fmetadata%2F{id}
    // Simplified: just link to the media key
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
