import { useState, useEffect } from 'react';
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  LayoutList,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Film,
  Tv,
  Library as LibraryIcon,
  Sparkles,
  Trash2,
  Shield,
  X,
  Loader2,
} from 'lucide-react';
import MediaTable from './MediaTable';
import MediaCard from './MediaCard';
import { DeletionOptionsModal, type DeletionOptions } from './DeletionOptionsModal';
import { useLibrary, useSyncLibrary, useSyncStatus, useBulkMarkForDeletion, useBulkProtect, useSettings } from '@/hooks/useApi';
import { useToast } from '@/components/common/Toast';
import { cn, formatBytes } from '@/lib/utils';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import type { MediaItem, LibraryFilters } from '@/types';

type ViewMode = 'table' | 'grid';
type MediaType = 'all' | 'movie' | 'tv';
type StatusFilter = 'all' | 'watched' | 'unwatched' | 'queued';

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export default function Library() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('library-view-mode');
    return (saved === 'table' || saved === 'grid') ? saved : 'grid';
  });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);
  const [mediaType, setMediaType] = useState<MediaType>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<string>('title');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);

  // Selection state (no explicit "selection mode" - just start selecting)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Deletion modal state
  const [showDeletionModal, setShowDeletionModal] = useState(false);

  // Persist view mode to localStorage
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('library-view-mode', mode);
  };

  const filters: LibraryFilters = {
    search: debouncedSearch,
    page,
    limit: viewMode === 'grid' ? 24 : 20,
    type: mediaType !== 'all' ? mediaType : undefined,
    status: status !== 'all' ? status : undefined,
    sortBy,
    sortOrder,
  };

  const { data, isLoading, isFetching, isError, error, refetch } = useLibrary(filters);
  const { data: settings } = useSettings();
  const syncMutation = useSyncLibrary();
  const [isSyncing, setIsSyncing] = useState(false);
  const { data: syncStatus } = useSyncStatus(isSyncing);
  const bulkDeleteMutation = useBulkMarkForDeletion();
  const bulkProtectMutation = useBulkProtect();
  const { addToast } = useToast();

  // Check if Overseerr is configured
  const hasOverseerr = Boolean(settings?.services?.overseerr?.url);

  // Show loading when typing (debouncing) or fetching
  const isSearching = (searchInput !== debouncedSearch) || (isFetching && !!searchInput);

  // Selection handlers
  const handleToggleSelect = (id: string, shiftKey = false) => {
    if (shiftKey && lastSelectedId && data?.items) {
      // Shift-click: select range
      const itemIds = data.items.map(item => item.id);
      const lastIndex = itemIds.indexOf(lastSelectedId);
      const currentIndex = itemIds.indexOf(id);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeIds = itemIds.slice(start, end + 1);

        setSelectedIds(prev => {
          const next = new Set(prev);
          rangeIds.forEach(rangeId => next.add(rangeId));
          return next;
        });
        return;
      }
    }

    // Regular click: toggle single item
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  };

  const handleSelectAll = () => {
    if (!data?.items) return;
    const allIds = data.items.map(item => item.id);
    const allSelected = allIds.every(id => selectedIds.has(id));
    if (allSelected) {
      // Deselect all on current page
      setSelectedIds(prev => {
        const next = new Set(prev);
        allIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all on current page
      setSelectedIds(prev => {
        const next = new Set(prev);
        allIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  };

  const handleBulkAddToQueue = () => {
    setShowDeletionModal(true);
  };

  const handleConfirmBulkDeletion = (options: DeletionOptions) => {
    const ids = Array.from(selectedIds).map(id => parseInt(id, 10));
    bulkDeleteMutation.mutate({
      ids,
      options: {
        gracePeriodDays: options.gracePeriodDays,
        deletionAction: options.deletionAction,
        resetOverseerr: options.resetOverseerr,
      },
    }, {
      onSuccess: (result) => {
        addToast({
          type: 'success',
          title: 'Added to queue',
          message: `${result.success.length} item(s) added to deletion queue${result.skipped.length > 0 ? `, ${result.skipped.length} skipped` : ''}`,
        });
        setShowDeletionModal(false);
        handleClearSelection();
        refetch();
      },
      onError: (error) => {
        addToast({
          type: 'error',
          title: 'Failed to add to queue',
          message: error instanceof Error ? error.message : 'An error occurred',
        });
      },
    });
  };

  const handleBulkProtect = () => {
    const ids = Array.from(selectedIds).map(id => parseInt(id, 10));
    bulkProtectMutation.mutate({ ids }, {
      onSuccess: (result) => {
        addToast({
          type: 'success',
          title: 'Items protected',
          message: `${result.success.length} item(s) protected${result.skipped.length > 0 ? `, ${result.skipped.length} already protected` : ''}`,
        });
        handleClearSelection();
        refetch();
      },
      onError: (error) => {
        addToast({
          type: 'error',
          title: 'Failed to protect items',
          message: error instanceof Error ? error.message : 'An error occurred',
        });
      },
    });
  };

  const hasSelection = selectedIds.size > 0;

  // Calculate selected items info
  const selectedItems = data?.items.filter(item => selectedIds.has(item.id)) || [];
  const selectedSize = selectedItems.reduce((acc, item) => acc + item.size, 0);

  // Reset page when debounced search changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // Handle sync completion
  useEffect(() => {
    if (isSyncing && syncStatus && !syncStatus.inProgress) {
      // Sync just completed
      setIsSyncing(false);
      refetch(); // Refresh library data
      addToast({
        type: 'success',
        title: 'Library sync complete',
        message: 'Your library has been synchronized',
      });
    }
  }, [isSyncing, syncStatus, refetch, addToast]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const handleSync = () => {
    setIsSyncing(true);
    syncMutation.mutate(undefined, {
      onSuccess: () => {
        addToast({
          type: 'info',
          title: 'Sync started',
          message: 'Your library is being synchronized with Plex and other services',
        });
      },
      onError: (error) => {
        setIsSyncing(false);
        addToast({
          type: 'error',
          title: 'Sync failed',
          message: error instanceof Error ? error.message : 'An error occurred while syncing',
        });
      },
    });
  };

  const totalPages = data ? Math.ceil(data.total / filters.limit) : 1;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <header className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-emerald-500/5 rounded-3xl" />
        <div className="relative px-8 py-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-violet-400 mb-2 flex items-center gap-2">
                <LibraryIcon className="w-4 h-4" />
                Browse
              </p>
              <h1 className="text-4xl font-display font-bold text-white tracking-tight">
                Media Library
              </h1>
              <p className="text-surface-400 mt-2">
                {data?.total || 0} items in your collection
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="btn-primary"
            >
              <RefreshCw className={cn('w-4 h-4', isSyncing && 'animate-spin')} />
              {isSyncing ? 'Syncing...' : 'Sync Library'}
            </button>
          </div>
        </div>
      </header>

      {/* Filters Bar */}
      <div className="card p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            {isSearching ? (
              <Loader2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-accent-400 animate-spin" />
            ) : (
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
            )}
            <input
              type="text"
              placeholder="Search movies, shows..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="input input-with-icon"
            />
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-2">
            <TypeButton
              active={mediaType === 'all'}
              onClick={() => { setMediaType('all'); setPage(1); }}
              icon={Sparkles}
              label="All"
            />
            <TypeButton
              active={mediaType === 'movie'}
              onClick={() => { setMediaType('movie'); setPage(1); }}
              icon={Film}
              label="Movies"
              color="violet"
            />
            <TypeButton
              active={mediaType === 'tv'}
              onClick={() => { setMediaType('tv'); setPage(1); }}
              icon={Tv}
              label="TV Shows"
              color="emerald"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-surface-500" />
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as StatusFilter);
                setPage(1);
              }}
              className="select min-w-[140px]"
            >
              <option value="all">All Status</option>
              <option value="watched">Watched</option>
              <option value="unwatched">Unwatched</option>
              <option value="queued">Queued</option>
            </select>
          </div>

          {/* View Toggle */}
          <div className="flex items-center p-1 bg-surface-800/60 rounded-xl">
            <button
              onClick={() => handleViewModeChange('grid')}
              className={cn(
                'p-2.5 rounded-lg transition-all duration-200',
                viewMode === 'grid'
                  ? 'bg-accent-500/20 text-accent-400 shadow-sm'
                  : 'text-surface-400 hover:text-surface-200'
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleViewModeChange('table')}
              className={cn(
                'p-2.5 rounded-lg transition-all duration-200',
                viewMode === 'table'
                  ? 'bg-accent-500/20 text-accent-400 shadow-sm'
                  : 'text-surface-400 hover:text-surface-200'
              )}
            >
              <LayoutList className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton viewMode={viewMode} />
      ) : isError ? (
        <ErrorState
          error={error as Error}
          title="Failed to load library"
          retry={refetch}
        />
      ) : data?.items && data.items.length > 0 ? (
        <div className={cn("transition-opacity duration-150", isFetching && "opacity-60")}>
          {viewMode === 'table' ? (
          <MediaTable
            items={data.items}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            onRefetch={refetch}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
          />
        ) : (
          <>
            {/* Global overlay to close any open menu when clicking outside */}
            {openCardMenuId !== null && (
              <div
                className="fixed inset-0 z-30"
                onClick={() => setOpenCardMenuId(null)}
              />
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
              {data.items.map((item: MediaItem, index: number) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  onRefetch={refetch}
                  index={index}
                  isMenuOpen={openCardMenuId === item.id}
                  onMenuToggle={() => setOpenCardMenuId(openCardMenuId === item.id ? null : item.id)}
                  onMenuClose={() => setOpenCardMenuId(null)}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={(shiftKey) => handleToggleSelect(item.id, shiftKey)}
                />
              ))}
            </div>
          </>
          )}
        </div>
      ) : (
        <EmptyLibraryState
          search={searchInput}
          mediaType={mediaType}
          status={status}
          onClearSearch={() => setSearchInput('')}
          onClearFilters={() => { setMediaType('all'); setStatus('all'); }}
          onSync={handleSync}
        />
      )}

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-400">
            Showing <span className="text-surface-200 font-medium">{(page - 1) * filters.limit + 1}</span> to{' '}
            <span className="text-surface-200 font-medium">{Math.min(page * filters.limit, data.total)}</span> of{' '}
            <span className="text-surface-200 font-medium">{data.total}</span> items
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="btn-ghost p-2"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            {generatePageNumbers(page, totalPages).map((pageNum, idx) =>
              pageNum === '...' ? (
                <span key={`ellipsis-${idx}`} className="px-3 text-surface-500">
                  ...
                </span>
              ) : (
                <button
                  key={pageNum}
                  onClick={() => setPage(Number(pageNum))}
                  className={cn(
                    'min-w-[40px] h-10 rounded-xl text-sm font-medium transition-all duration-200',
                    page === pageNum
                      ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30'
                      : 'text-surface-400 hover:bg-surface-800/60 hover:text-surface-200'
                  )}
                >
                  {pageNum}
                </button>
              )
            )}

            <button
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
              className="btn-ghost p-2"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Action Bar */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-surface-800 border border-surface-700 rounded-2xl shadow-2xl px-6 py-4 flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-white">{selectedIds.size}</span>
              <div className="text-sm">
                <p className="text-surface-300">items selected</p>
                <p className="text-surface-500">{formatBytes(selectedSize)}</p>
              </div>
            </div>

            <div className="w-px h-10 bg-surface-700" />

            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkAddToQueue}
                disabled={bulkDeleteMutation.isPending}
                className="btn-danger flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Add to Queue
              </button>
              <button
                onClick={handleBulkProtect}
                disabled={bulkProtectMutation.isPending}
                className="btn-secondary flex items-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Protect
              </button>
              <button
                onClick={handleClearSelection}
                className="btn-ghost p-2"
                title="Clear selection"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Deletion Options Modal */}
      <DeletionOptionsModal
        isOpen={showDeletionModal}
        onClose={() => setShowDeletionModal(false)}
        onConfirm={handleConfirmBulkDeletion}
        itemCount={selectedIds.size}
        isLoading={bulkDeleteMutation.isPending}
        showOverseerr={hasOverseerr}
      />
    </div>
  );
}

interface TypeButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  color?: 'violet' | 'emerald';
}

function TypeButton({ active, onClick, icon: Icon, label, color }: TypeButtonProps) {
  const colorClasses = {
    violet: active ? 'bg-violet-500/20 text-violet-400 border-violet-500/30' : '',
    emerald: active ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : '',
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border',
        active
          ? color
            ? colorClasses[color]
            : 'bg-accent-500/20 text-accent-400 border-accent-500/30'
          : 'bg-surface-800/60 text-surface-400 border-transparent hover:text-surface-200 hover:bg-surface-700/60'
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'grid') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {[...Array(24)].map((_, i) => (
          <div key={i} className="aspect-[2/3] skeleton-shimmer rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="divide-y divide-surface-800/50">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="h-20 skeleton-shimmer" />
        ))}
      </div>
    </div>
  );
}

interface EmptyLibraryStateProps {
  search: string;
  mediaType: MediaType;
  status: StatusFilter;
  onClearSearch: () => void;
  onClearFilters: () => void;
  onSync: () => void;
}

function EmptyLibraryState({
  search,
  mediaType,
  status,
  onClearSearch,
  onClearFilters,
  onSync,
}: EmptyLibraryStateProps) {
  const hasFilters = mediaType !== 'all' || status !== 'all';

  // Search active but no results
  if (search) {
    return (
      <div className="card p-12">
        <EmptyState
          icon={Search}
          variant="filtered"
          title="No results found"
          description={`No media matching "${search}" was found. Try a different search term or clear filters.`}
          action={{ label: 'Clear Search', onClick: onClearSearch }}
        />
      </div>
    );
  }

  // Filters applied but no results
  if (hasFilters) {
    return (
      <div className="card p-12">
        <EmptyState
          icon={SlidersHorizontal}
          variant="filtered"
          title="No items match filters"
          description="Try adjusting your type or status filters to see more items."
          action={{ label: 'Clear Filters', onClick: onClearFilters }}
        />
      </div>
    );
  }

  // Library is truly empty (no search, no filters)
  return (
    <div className="card p-12">
      <EmptyState
        icon={LibraryIcon}
        title="Your library is empty"
        description="Sync your library to import media from Plex and start managing your collection."
        action={{ label: 'Sync Library', onClick: onSync }}
      />
    </div>
  );
}

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  if (current <= 3) {
    return [1, 2, 3, 4, 5, '...', total];
  }

  if (current >= total - 2) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }

  return [1, '...', current - 1, current, current + 1, '...', total];
}
