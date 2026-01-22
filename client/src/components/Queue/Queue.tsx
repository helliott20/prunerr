import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trash2,
  Clock,
  AlertTriangle,
  Undo2,
  Play,
  Film,
  Tv,
  Shield,
  CheckCircle,
  RefreshCw,
  ExternalLink,
  Info,
  Loader2,
  Check,
  X,
  FileVideo,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { Modal } from '@/components/common/Modal';
import { useDeletionQueue, useRemoveFromQueue, useProcessQueue, useProtectItem, useSettings } from '@/hooks/useApi';
import { useToast } from '@/components/common/Toast';
import { formatBytes, formatDate, formatRelativeTime, getDaysUntil } from '@/lib/utils';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import type { QueueItem } from '@/types';

// Progress types for SSE streaming
interface DeletionProgress {
  stage: 'starting' | 'unmonitoring' | 'deleting_files' | 'resetting_overseerr' | 'complete' | 'error';
  message: string;
  fileProgress?: {
    current: number;
    total: number;
    fileName: string;
    status: 'deleting' | 'deleted' | 'failed';
  };
  result?: {
    success: boolean;
    fileSizeFreed?: number;
    overseerrReset?: boolean;
    error?: string;
  };
}

export default function Queue() {
  const navigate = useNavigate();
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [confirmProcessing, setConfirmProcessing] = useState(false);
  const [confirmDeleteNow, setConfirmDeleteNow] = useState<QueueItem | null>(null);

  // Deletion progress state
  const [deletionProgress, setDeletionProgress] = useState<DeletionProgress | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletedFiles, setDeletedFiles] = useState<Array<{ name: string; status: 'deleted' | 'deleting' | 'failed' }>>([]);
  const fileListRef = useRef<HTMLDivElement>(null);

  // Auto-scroll file list to bottom when new files are added
  useEffect(() => {
    if (fileListRef.current) {
      fileListRef.current.scrollTop = fileListRef.current.scrollHeight;
    }
  }, [deletedFiles, deletionProgress?.fileProgress]);

  const { data: queue, isLoading, isError, error, refetch } = useDeletionQueue();
  const removeFromQueueMutation = useRemoveFromQueue();
  const processQueueMutation = useProcessQueue();
  const protectMutation = useProtectItem();
  const { addToast } = useToast();

  const handleSelectAll = () => {
    if (queue && selectedItems.length === queue.length) {
      setSelectedItems([]);
    } else if (queue) {
      setSelectedItems(queue.map((item) => item.id));
    }
  };

  const handleSelectItem = (id: string) => {
    if (selectedItems.includes(id)) {
      setSelectedItems(selectedItems.filter((i) => i !== id));
    } else {
      setSelectedItems([...selectedItems, id]);
    }
  };

  const handleRemoveFromQueue = (id: string) => {
    removeFromQueueMutation.mutate(id, { onSuccess: () => refetch() });
  };

  const handleRemoveSelected = () => {
    selectedItems.forEach((id) => {
      removeFromQueueMutation.mutate(id);
    });
    setSelectedItems([]);
    refetch();
  };

  const handleProtect = (id: string) => {
    protectMutation.mutate(id, { onSuccess: () => refetch() });
  };

  const handleProcessQueue = () => {
    processQueueMutation.mutate(undefined, {
      onSuccess: () => {
        setConfirmProcessing(false);
        refetch();
      },
    });
  };

  const handleDeleteNow = (item: QueueItem) => {
    setConfirmDeleteNow(item);
    setDeletionProgress(null);
    setDeletedFiles([]);
  };

  const handleConfirmDeleteNow = useCallback(async () => {
    if (!confirmDeleteNow) return;

    setIsDeleting(true);
    setDeletionProgress(null);
    setDeletedFiles([]);

    try {
      // Use fetch with SSE streaming
      const response = await fetch(`/api/queue/${confirmDeleteNow.id}/delete-now/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to start deletion');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const progress: DeletionProgress = JSON.parse(line.slice(6));
              setDeletionProgress(progress);

              // Track deleted files
              if (progress.fileProgress && progress.fileProgress.status !== 'deleting') {
                setDeletedFiles(prev => [
                  ...prev.filter(f => f.name !== progress.fileProgress!.fileName),
                  { name: progress.fileProgress!.fileName, status: progress.fileProgress!.status }
                ]);
              }

              // Handle completion
              if (progress.stage === 'complete' && progress.result?.success) {
                addToast({
                  type: 'success',
                  title: 'Deleted successfully',
                  message: `"${confirmDeleteNow.title}" has been deleted (${formatBytes(progress.result.fileSizeFreed || 0)} freed)`,
                });
                // Keep modal open briefly to show completion
                setTimeout(() => {
                  setConfirmDeleteNow(null);
                  setIsDeleting(false);
                  setDeletionProgress(null);
                  setDeletedFiles([]);
                  refetch();
                }, 1500);
              } else if (progress.stage === 'error') {
                addToast({
                  type: 'error',
                  title: 'Delete failed',
                  message: progress.result?.error || 'Failed to delete item',
                });
                setIsDeleting(false);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Delete failed',
        message: error instanceof Error ? error.message : 'Failed to delete item',
      });
      setIsDeleting(false);
    }
  }, [confirmDeleteNow, addToast, refetch]);

  const { data: settings } = useSettings();

  // Calculate stats
  const totalSize = queue?.reduce((acc, item) => acc + item.size, 0) || 0;
  const readyToDelete = queue?.filter((item) => getDaysUntil(item.deleteAt) <= 0).length || 0;
  const willResetOverseerr = queue?.filter((item) => item.resetOverseerr).length || 0;

  // Get Overseerr URL for links
  const overseerrUrl = settings?.services?.overseerr?.url?.replace(/\/$/, '');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Deletion Queue</h1>
          <p className="text-surface-400 mt-1">
            Items marked for deletion with grace period countdown
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedItems.length > 0 && (
            <Button variant="secondary" onClick={handleRemoveSelected}>
              <Undo2 className="w-4 h-4 mr-2" />
              Remove Selected ({selectedItems.length})
            </Button>
          )}
          <Button
            variant="danger"
            onClick={() => setConfirmProcessing(true)}
            disabled={!queue || queue.length === 0}
          >
            <Play className="w-4 h-4 mr-2" />
            Process Queue
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-warning-500/10">
              <Clock className="w-6 h-6 text-warning-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Items in Queue</p>
              <p className="text-2xl font-bold text-white">{queue?.length || 0}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-ruby-500/10">
              <Trash2 className="w-6 h-6 text-ruby-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Ready to Delete</p>
              <p className="text-2xl font-bold text-white">{readyToDelete}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-accent-500/10">
              <AlertTriangle className="w-6 h-6 text-accent-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Space to Reclaim</p>
              <p className="text-2xl font-bold text-white">{formatBytes(totalSize)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-violet-500/10">
              <RefreshCw className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Will Reset Overseerr</p>
              <p className="text-2xl font-bold text-white">{willResetOverseerr}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Queue List */}
      {isLoading ? (
        <Card>
          <div className="divide-y divide-surface-800">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse bg-surface-800/50" />
            ))}
          </div>
        </Card>
      ) : isError ? (
        <ErrorState
          error={error as Error}
          title="Failed to load queue"
          retry={refetch}
        />
      ) : queue && queue.length > 0 ? (
        <Card>
          {/* Table Header */}
          <div className="px-4 py-3 border-b border-surface-800 bg-surface-800/30">
            <div className="flex items-center gap-4">
              <input
                type="checkbox"
                checked={selectedItems.length === queue.length}
                onChange={handleSelectAll}
                className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-accent-500 focus:ring-accent-500"
              />
              <span className="text-sm text-surface-400">Select All</span>
            </div>
          </div>

          {/* Queue Items */}
          <div className="divide-y divide-surface-800">
            {queue.map((item) => (
              <QueueItemRow
                key={item.id}
                item={item}
                selected={selectedItems.includes(item.id)}
                onSelect={() => handleSelectItem(item.id)}
                onRemove={() => handleRemoveFromQueue(item.id)}
                onProtect={() => handleProtect(item.id)}
                onDeleteNow={() => handleDeleteNow(item)}
                overseerrUrl={overseerrUrl}
              />
            ))}
          </div>
        </Card>
      ) : (
        <Card className="p-12">
          <EmptyState
            icon={CheckCircle}
            variant="success"
            title="Queue is empty"
            description="No items are currently marked for deletion. Browse your library to queue items for cleanup, or set up rules to automate the process."
            action={{ label: 'Browse Library', onClick: () => navigate('/library') }}
            secondaryAction={{ label: 'Set up rules', onClick: () => navigate('/rules') }}
          />
        </Card>
      )}

      {/* Confirm Processing Modal */}
      <Modal
        isOpen={confirmProcessing}
        onClose={() => setConfirmProcessing(false)}
        title="Process Deletion Queue"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-ruby-500/10 rounded-lg border border-ruby-500/20">
            <AlertTriangle className="w-6 h-6 text-ruby-400 flex-shrink-0" />
            <div>
              <p className="text-sm text-white">
                This will permanently delete all items that have passed their grace period.
              </p>
              <p className="text-sm text-ruby-400 mt-1">
                {readyToDelete} item{readyToDelete !== 1 ? 's' : ''} will be deleted ({formatBytes(totalSize)} total)
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setConfirmProcessing(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleProcessQueue}
              disabled={processQueueMutation.isPending || readyToDelete === 0}
            >
              {processQueueMutation.isPending ? 'Processing...' : 'Confirm Delete'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete Now Modal */}
      <Modal
        isOpen={!!confirmDeleteNow}
        onClose={() => !isDeleting && setConfirmDeleteNow(null)}
        title={isDeleting ? "Deleting..." : "Delete Now"}
        size={isDeleting ? "lg" : "md"}
      >
        <div className="space-y-4">
          {!isDeleting ? (
            // Pre-deletion confirmation view
            <>
              <div className="flex items-center gap-3 p-4 bg-ruby-500/10 rounded-lg border border-ruby-500/20">
                <AlertTriangle className="w-6 h-6 text-ruby-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-white">
                    This will immediately and permanently delete this item, bypassing the grace period.
                  </p>
                  {confirmDeleteNow && (
                    <p className="text-sm text-ruby-400 mt-1">
                      "{confirmDeleteNow.title}" ({formatBytes(confirmDeleteNow.size)})
                    </p>
                  )}
                </div>
              </div>

              {confirmDeleteNow && (
                <div className="text-sm text-surface-400 space-y-1">
                  <p><span className="text-surface-300">Action:</span> {confirmDeleteNow.deletionActionLabel}</p>
                  {confirmDeleteNow.resetOverseerr && (
                    <p className="text-violet-400">Will reset in Overseerr for re-request</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="secondary" onClick={() => setConfirmDeleteNow(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={handleConfirmDeleteNow}>
                  Delete Now
                </Button>
              </div>
            </>
          ) : (
            // Deletion progress view
            <div className="space-y-4">
              {/* Current stage indicator */}
              <div className="flex items-center gap-3">
                {deletionProgress?.stage === 'complete' ? (
                  <div className="p-2 rounded-full bg-emerald-500/20">
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  </div>
                ) : deletionProgress?.stage === 'error' ? (
                  <div className="p-2 rounded-full bg-ruby-500/20">
                    <X className="w-6 h-6 text-ruby-400" />
                  </div>
                ) : (
                  <div className="p-2 rounded-full bg-accent-500/20">
                    <Loader2 className="w-6 h-6 text-accent-400 animate-spin" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-white font-medium">
                    {deletionProgress?.message || 'Initializing...'}
                  </p>
                  {deletionProgress?.fileProgress && (
                    <p className="text-sm text-surface-400">
                      File {deletionProgress.fileProgress.current} of {deletionProgress.fileProgress.total}
                    </p>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {deletionProgress?.fileProgress && (
                <div className="space-y-2">
                  <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent-500 transition-all duration-300 ease-out"
                      style={{
                        width: `${(deletionProgress.fileProgress.current / deletionProgress.fileProgress.total) * 100}%`
                      }}
                    />
                  </div>
                </div>
              )}

              {/* File list */}
              {(deletedFiles.length > 0 || deletionProgress?.fileProgress?.status === 'deleting') && (
                <div ref={fileListRef} className="max-h-72 overflow-y-auto space-y-1 bg-surface-800/50 rounded-lg p-3">
                  {deletedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      {file.status === 'deleted' ? (
                        <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <X className="w-4 h-4 text-ruby-400 flex-shrink-0" />
                      )}
                      <FileVideo className="w-4 h-4 text-surface-500 flex-shrink-0" />
                      <span className="text-surface-300 truncate" title={file.name}>
                        {file.name.split('/').pop()}
                      </span>
                    </div>
                  ))}
                  {/* Show current file being deleted */}
                  {deletionProgress?.fileProgress?.status === 'deleting' && (
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="w-4 h-4 text-accent-400 animate-spin flex-shrink-0" />
                      <FileVideo className="w-4 h-4 text-surface-500 flex-shrink-0" />
                      <span className="text-accent-400 truncate" title={deletionProgress.fileProgress.fileName}>
                        {deletionProgress.fileProgress.fileName.split('/').pop()}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Completion result */}
              {deletionProgress?.stage === 'complete' && deletionProgress.result && (
                <div className="p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <p className="text-emerald-400 font-medium">Deletion complete!</p>
                  <p className="text-sm text-surface-400 mt-1">
                    Freed {formatBytes(deletionProgress.result.fileSizeFreed || 0)}
                    {deletionProgress.result.overseerrReset && ' • Reset in Overseerr'}
                  </p>
                </div>
              )}

              {/* Error state */}
              {deletionProgress?.stage === 'error' && (
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="secondary" onClick={() => {
                    setConfirmDeleteNow(null);
                    setIsDeleting(false);
                    setDeletionProgress(null);
                    setDeletedFiles([]);
                  }}>
                    Close
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

interface QueueItemRowProps {
  item: QueueItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onProtect: () => void;
  onDeleteNow: () => void;
  overseerrUrl?: string;
}

function QueueItemRow({ item, selected, onSelect, onRemove, onProtect, onDeleteNow, overseerrUrl }: QueueItemRowProps) {
  const daysLeft = item.daysRemaining ?? getDaysUntil(item.deleteAt);
  const isReady = daysLeft <= 0;
  const TypeIcon = item.type === 'movie' ? Film : Tv;

  // Build Overseerr link if available
  const overseerrLink = overseerrUrl && item.tmdbId
    ? `${overseerrUrl}/${item.type === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`
    : null;

  return (
    <div className={`p-4 hover:bg-surface-800/30 transition-colors ${isReady ? 'bg-ruby-500/5' : ''}`}>
      <div className="flex items-center gap-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="w-4 h-4 rounded border-surface-600 bg-surface-700 text-accent-500 focus:ring-accent-500"
        />

        {/* Poster/Icon */}
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt=""
            className="w-12 h-16 object-cover rounded"
          />
        ) : (
          <div className="w-12 h-16 bg-surface-800 rounded flex items-center justify-center">
            <TypeIcon className="w-6 h-6 text-surface-600" />
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-white truncate">{item.title}</h3>
            <Badge variant={item.type}>{item.type}</Badge>
          </div>
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-surface-400">
            <span>{formatBytes(item.size)}</span>
            <span>Queued {formatRelativeTime(item.queuedAt)}</span>
            {item.matchedRule && (
              <span className="text-accent-400">Rule: {item.matchedRule}</span>
            )}
          </div>
          {/* Deletion action and Overseerr info */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2">
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-surface-800 text-surface-300" title={item.deletionActionLabel}>
              <Info className="w-3 h-3" />
              {item.deletionActionLabel || item.deletionAction}
            </span>
            {item.resetOverseerr && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-400">
                <RefreshCw className="w-3 h-3" />
                Will reset in Overseerr
              </span>
            )}
            {item.overseerrResetAt && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                <CheckCircle className="w-3 h-3" />
                Reset in Overseerr
              </span>
            )}
            {item.requestedBy && (
              <span className="text-xs text-surface-500">
                Requested by: {item.requestedBy}
              </span>
            )}
          </div>
        </div>

        {/* Grace Period */}
        <div className="text-right min-w-[120px]">
          {isReady ? (
            <Badge variant="danger" className="mb-1">Ready to Delete</Badge>
          ) : (
            <div className="flex items-center justify-end gap-1 text-warning-400">
              <Clock className="w-4 h-4" />
              <span className="text-sm font-medium">{daysLeft} days left</span>
            </div>
          )}
          <p className="text-xs text-surface-400 mt-1">
            Deletes {formatDate(item.deleteAt)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {overseerrLink && (
            <a
              href={overseerrLink}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded hover:bg-surface-700 transition-colors"
              title="View in Overseerr"
            >
              <ExternalLink className="w-4 h-4 text-violet-400" />
            </a>
          )}
          <Button variant="danger" size="sm" onClick={onDeleteNow} title="Delete now">
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onProtect} title="Protect">
            <Shield className="w-4 h-4 text-accent-400" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove} title="Remove from queue">
            <Undo2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
