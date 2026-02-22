import { useState, useEffect, useRef, useCallback } from 'react';
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
  ChevronDown,
} from 'lucide-react';
import MediaTable from './MediaTable';
import MediaCard from './MediaCard';
import { DeletionOptionsModal, type DeletionOptions } from './DeletionOptionsModal';
import { useLibrary, useBulkMarkForDeletion, useBulkProtect, useSettings } from '@/hooks/useApi';
import { useToast } from '@/components/common/Toast';
import { cn, formatBytes } from '@/lib/utils';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import type { MediaItem, LibraryFilters } from '@/types';

// ============================================================================
// Sync Progress Types & Log Component
// ============================================================================

interface SyncProgress {
  stage: 'initializing' | 'building_cache' | 'scanning_library' | 'processing_items' | 'saving' | 'complete' | 'error';
  message: string;
  libraryProgress?: {
    current: number;
    total: number;
    libraryName: string;
  };
  itemProgress?: {
    scanned: number;
    total: number;
    currentItem?: string;
  };
  result?: {
    success: boolean;
    itemsScanned: number;
    itemsAdded: number;
    itemsUpdated: number;
    errors: number;
  };
}

interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error' | 'progress';
}

function SyncLogPanel({
  logs,
  progress,
  isOpen,
}: {
  logs: LogEntry[];
  progress: SyncProgress | null;
  isOpen: boolean;
}) {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  if (!isOpen) return null;

  const pct = progress?.itemProgress
    ? Math.round((progress.itemProgress.scanned / progress.itemProgress.total) * 100)
    : null;

  return (
    <div className="absolute left-0 right-0 sm:left-auto sm:right-0 top-full mt-2 z-50 sm:w-[420px] animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-[#0d1117] border border-surface-700/60 rounded-xl shadow-2xl overflow-hidden">
        {/* Terminal header bar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[#161b22] border-b border-surface-800/60">
          <span className="text-[11px] text-surface-500 font-mono">sync — prunerr</span>
          {progress && progress.stage !== 'complete' && progress.stage !== 'error' && (
            <span className="ml-auto text-[11px] text-surface-600 font-mono">
              {progress.stage.replace(/_/g, ' ')}
            </span>
          )}
          {progress?.stage === 'complete' && (
            <span className="ml-auto text-[11px] text-emerald-500 font-mono">done</span>
          )}
          {progress?.stage === 'error' && (
            <span className="ml-auto text-[11px] text-ruby-500 font-mono">error</span>
          )}
        </div>

        {/* Progress bar */}
        {pct !== null && progress?.stage !== 'complete' && progress?.stage !== 'error' && (
          <div className="h-[2px] bg-surface-800/40">
            <div
              className="h-full bg-accent-500 transition-all duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {progress?.stage === 'complete' && <div className="h-[2px] bg-emerald-500" />}
        {progress?.stage === 'error' && <div className="h-[2px] bg-ruby-500" />}

        {/* Log output */}
        <div ref={logContainerRef} className="max-h-56 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.6] space-y-px">
          {logs.length === 0 && (
            <div className="text-surface-600 py-2">$ starting sync...</div>
          )}
          {logs.map((log, idx) => (
            <div key={idx} className="flex gap-2 min-w-0">
              <span className="text-surface-600 select-none flex-shrink-0">
                {log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={cn(
                'truncate',
                log.type === 'success' && 'text-emerald-400',
                log.type === 'error' && 'text-ruby-400',
                log.type === 'info' && 'text-surface-400',
                log.type === 'progress' && 'text-sky-400',
              )}>
                {log.message}
              </span>
            </div>
          ))}
          {/* Blinking cursor on last line while running */}
          {progress && progress.stage !== 'complete' && progress.stage !== 'error' && (
            <div className="flex gap-2 min-w-0">
              <span className="text-surface-600 select-none flex-shrink-0">
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="text-surface-500 truncate">
                {progress.itemProgress?.currentItem
                  ? `processing "${progress.itemProgress.currentItem}"`
                  : progress.message.toLowerCase()}
                <span className="animate-pulse ml-0.5">_</span>
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        {progress?.stage === 'complete' && progress.result && (
          <div className="px-3 py-2 border-t border-surface-800/40 bg-emerald-500/5 font-mono text-[11px]">
            <span className="text-emerald-400">{progress.result.itemsScanned} scanned</span>
            <span className="text-surface-600 mx-2">|</span>
            <span className="text-surface-400">{progress.result.itemsAdded} synced</span>
            {progress.result.errors > 0 && (
              <>
                <span className="text-surface-600 mx-2">|</span>
                <span className="text-ruby-400">{progress.result.errors} errors</span>
              </>
            )}
          </div>
        )}
        {progress && progress.stage !== 'complete' && progress.stage !== 'error' && pct !== null && (
          <div className="px-3 py-1.5 border-t border-surface-800/40 font-mono text-[11px] text-surface-500">
            {progress.itemProgress?.scanned}/{progress.itemProgress?.total} items ({pct}%)
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncLogs, setSyncLogs] = useState<LogEntry[]>([]);
  const [showSyncLog, setShowSyncLog] = useState(false);
  const syncButtonRef = useRef<HTMLDivElement>(null);
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

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setSyncLogs(prev => [...prev, { timestamp: new Date(), message, type }]);
  }, []);

  const handleSync = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    setSyncProgress(null);
    setSyncLogs([]);
    setShowSyncLog(true);
    addLog('Starting library sync...', 'info');

    try {
      const response = await fetch('/api/library/sync/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to start sync');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let lastItemProgress = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const progress: SyncProgress = JSON.parse(line.slice(6));
              setSyncProgress(progress);

              // Add log entries based on stage changes
              if (progress.stage === 'initializing') {
                addLog(progress.message, 'info');
              } else if (progress.stage === 'building_cache') {
                addLog(progress.message, 'info');
              } else if (progress.stage === 'scanning_library' && progress.libraryProgress) {
                addLog(progress.message, 'info');
              } else if (progress.stage === 'processing_items' && progress.itemProgress) {
                // Log every 25 items to avoid flooding
                const scanned = progress.itemProgress.scanned;
                if (scanned === 1 || scanned - lastItemProgress >= 25 || scanned === progress.itemProgress.total) {
                  addLog(
                    `${progress.libraryProgress?.libraryName || 'Library'}: ${scanned}/${progress.itemProgress.total} items`,
                    'progress',
                  );
                  lastItemProgress = scanned;
                }
              } else if (progress.stage === 'complete') {
                addLog(progress.message, 'success');
                addToast({
                  type: 'success',
                  title: 'Library sync complete',
                  message: `${progress.result?.itemsScanned || 0} items scanned, ${progress.result?.itemsAdded || 0} synced`,
                });
                refetch();
                // Auto-hide the log after a delay
                setTimeout(() => setShowSyncLog(false), 5000);
              } else if (progress.stage === 'error') {
                addLog(progress.message, 'error');
                addToast({
                  type: 'error',
                  title: 'Sync error',
                  message: progress.message,
                });
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An error occurred while syncing';
      addLog(`Error: ${message}`, 'error');
      setSyncProgress({
        stage: 'error',
        message,
      });
      addToast({
        type: 'error',
        title: 'Sync failed',
        message,
      });
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, addLog, addToast, refetch]);

  const totalPages = data ? Math.ceil(data.total / filters.limit) : 1;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <header className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-emerald-500/5 rounded-3xl" />
        <div className="relative px-4 py-6 sm:px-8 sm:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-violet-400 mb-2 flex items-center gap-2">
                <LibraryIcon className="w-4 h-4" />
                Browse
              </p>
              <h1 className="text-2xl sm:text-4xl font-display font-bold text-white tracking-tight">
                Media Library
              </h1>
              <p className="text-surface-400 mt-2">
                {data?.total || 0} items in your collection
              </p>
            </div>
            <div
              ref={syncButtonRef}
              className="relative w-full sm:w-auto"
              onMouseEnter={() => isSyncing && setShowSyncLog(true)}
              onMouseLeave={() => {
                // Don't hide if sync just completed (auto-hide handles that)
                if (syncProgress?.stage !== 'complete') {
                  setShowSyncLog(false);
                }
              }}
            >
              <button
                onClick={() => {
                  if (isSyncing) {
                    setShowSyncLog(prev => !prev);
                  } else {
                    handleSync();
                  }
                }}
                className={cn(
                  'btn-primary w-full sm:w-auto',
                  isSyncing && showSyncLog && 'ring-2 ring-accent-500/30',
                )}
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Syncing...
                    <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showSyncLog && 'rotate-180')} />
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Sync Library
                  </>
                )}
              </button>
              <SyncLogPanel
                logs={syncLogs}
                progress={syncProgress}
                isOpen={showSyncLog && (isSyncing || syncProgress?.stage === 'complete' || syncProgress?.stage === 'error')}
              />
            </div>
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
          <div className="flex items-center gap-2 overflow-x-auto pb-2 -mb-2 no-scrollbar">
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
        <div className="fixed bottom-4 sm:bottom-6 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50">
          <div className="bg-surface-800 border border-surface-700 rounded-2xl shadow-2xl px-4 py-3 sm:px-6 sm:py-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-6">
            <div className="flex items-center justify-between sm:justify-start gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl sm:text-2xl font-bold text-white">{selectedIds.size}</span>
                <div className="text-sm">
                  <p className="text-surface-300">items selected</p>
                  <p className="text-surface-500">{formatBytes(selectedSize)}</p>
                </div>
              </div>
              <button
                onClick={handleClearSelection}
                className="btn-ghost p-2 sm:hidden"
                title="Clear selection"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="hidden sm:block w-px h-10 bg-surface-700" />

            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkAddToQueue}
                disabled={bulkDeleteMutation.isPending}
                className="btn-danger flex-1 sm:flex-none flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Add to Queue</span>
                <span className="sm:hidden">Queue</span>
              </button>
              <button
                onClick={handleBulkProtect}
                disabled={bulkProtectMutation.isPending}
                className="btn-secondary flex-1 sm:flex-none flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Protect
              </button>
              <button
                onClick={handleClearSelection}
                className="btn-ghost p-2 hidden sm:flex"
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
