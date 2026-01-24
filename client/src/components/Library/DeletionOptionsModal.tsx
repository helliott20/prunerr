import { useState } from 'react';
import { Trash2, Shield, RotateCcw, AlertCircle, Clock } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { cn } from '@/lib/utils';
import type { DeletionAction, MediaItem } from '@/types';
import { DELETION_ACTION_LABELS, DELETION_ACTION_DESCRIPTIONS } from '@/types';

export interface DeletionOptions {
  gracePeriodDays: number;
  deletionAction: DeletionAction;
  resetOverseerr: boolean;
}

interface DeletionOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: DeletionOptions) => void;
  item?: MediaItem | null;
  itemCount?: number;
  isLoading?: boolean;
  showOverseerr?: boolean;
}

const DELETION_ACTIONS: DeletionAction[] = [
  'unmonitor_only',
  'delete_files_only',
  'unmonitor_and_delete',
  'full_removal',
];

const ACTION_ICONS: Record<DeletionAction, React.ReactNode> = {
  unmonitor_only: <Shield className="w-4 h-4" />,
  delete_files_only: <Trash2 className="w-4 h-4" />,
  unmonitor_and_delete: <Trash2 className="w-4 h-4" />,
  full_removal: <AlertCircle className="w-4 h-4" />,
};

const ACTION_VARIANTS: Record<DeletionAction, string> = {
  unmonitor_only: 'border-surface-600 hover:border-accent-500/50 hover:bg-accent-500/5',
  delete_files_only: 'border-surface-600 hover:border-amber-500/50 hover:bg-amber-500/5',
  unmonitor_and_delete: 'border-surface-600 hover:border-ruby-500/50 hover:bg-ruby-500/5',
  full_removal: 'border-surface-600 hover:border-ruby-500/50 hover:bg-ruby-500/5',
};

const ACTION_SELECTED_VARIANTS: Record<DeletionAction, string> = {
  unmonitor_only: 'border-accent-500 bg-accent-500/10',
  delete_files_only: 'border-amber-500 bg-amber-500/10',
  unmonitor_and_delete: 'border-ruby-500 bg-ruby-500/10',
  full_removal: 'border-ruby-500 bg-ruby-500/10',
};

export function DeletionOptionsModal({
  isOpen,
  onClose,
  onConfirm,
  item,
  itemCount = 1,
  isLoading = false,
  showOverseerr = true,
}: DeletionOptionsModalProps) {
  const [gracePeriodDays, setGracePeriodDays] = useState(7);
  const [deletionAction, setDeletionAction] = useState<DeletionAction>('unmonitor_and_delete');
  const [resetOverseerr, setResetOverseerr] = useState(false);

  const handleConfirm = () => {
    onConfirm({
      gracePeriodDays,
      deletionAction,
      resetOverseerr,
    });
  };

  const title = item
    ? `Mark "${item.title}" for Deletion`
    : `Mark ${itemCount} Item${itemCount > 1 ? 's' : ''} for Deletion`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description="Configure how this content should be handled when the grace period expires."
      size="lg"
    >
      <div className="space-y-6">
        {/* Grace Period */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-surface-200 mb-3">
            <Clock className="w-4 h-4 text-surface-400" />
            Grace Period
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={365}
              value={gracePeriodDays}
              onChange={(e) => setGracePeriodDays(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-20 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-center focus:outline-none focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500"
            />
            <span className="text-surface-400">days before deletion</span>
          </div>
          <p className="text-xs text-surface-500 mt-2">
            {gracePeriodDays === 0
              ? 'Item will be eligible for immediate deletion when the queue is processed.'
              : `Item will be deleted after ${gracePeriodDays} day${gracePeriodDays > 1 ? 's' : ''}.`}
          </p>
        </div>

        {/* Deletion Action */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-surface-200 mb-3">
            <Trash2 className="w-4 h-4 text-surface-400" />
            Deletion Action
          </label>
          <div className="space-y-2">
            {DELETION_ACTIONS.map((action) => (
              <button
                key={action}
                onClick={() => setDeletionAction(action)}
                className={cn(
                  'w-full p-3 rounded-lg border text-left transition-all duration-200',
                  deletionAction === action
                    ? ACTION_SELECTED_VARIANTS[action]
                    : ACTION_VARIANTS[action]
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'mt-0.5',
                      deletionAction === action
                        ? action === 'unmonitor_only'
                          ? 'text-accent-400'
                          : action === 'delete_files_only'
                          ? 'text-amber-400'
                          : 'text-ruby-400'
                        : 'text-surface-400'
                    )}
                  >
                    {ACTION_ICONS[action]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'font-medium',
                          deletionAction === action ? 'text-white' : 'text-surface-200'
                        )}
                      >
                        {DELETION_ACTION_LABELS[action]}
                      </span>
                      {deletionAction === action && (
                        <div className="w-2 h-2 rounded-full bg-accent-500" />
                      )}
                    </div>
                    <p className="text-xs text-surface-400 mt-0.5">
                      {DELETION_ACTION_DESCRIPTIONS[action]}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Overseerr Reset */}
        {showOverseerr && (
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-surface-200 mb-3">
              <RotateCcw className="w-4 h-4 text-surface-400" />
              Overseerr
            </label>
            <button
              onClick={() => setResetOverseerr(!resetOverseerr)}
              className={cn(
                'w-full p-3 rounded-lg border text-left transition-all duration-200',
                resetOverseerr
                  ? 'border-violet-500 bg-violet-500/10'
                  : 'border-surface-600 hover:border-violet-500/50 hover:bg-violet-500/5'
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    resetOverseerr
                      ? 'bg-violet-500 border-violet-500'
                      : 'border-surface-500'
                  )}
                >
                  {resetOverseerr && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className={cn('font-medium', resetOverseerr ? 'text-white' : 'text-surface-200')}>
                    Reset in Overseerr
                  </span>
                  <p className="text-xs text-surface-400 mt-0.5">
                    Allow this content to be re-requested in Overseerr after deletion
                  </p>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-surface-700/50">
          <button
            onClick={onClose}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold rounded-xl',
              'bg-surface-700/80 hover:bg-surface-600/80 border border-surface-600/50 hover:border-surface-500/50',
              'text-surface-200 hover:text-white',
              'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-surface-500/30 focus:ring-offset-2 focus:ring-offset-surface-900'
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold rounded-xl border',
              'bg-ruby-500/20 hover:bg-ruby-500/30 border-ruby-500/30 hover:border-ruby-500/50 text-ruby-400 hover:text-ruby-300',
              'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ruby-500/30 focus:ring-offset-2 focus:ring-offset-surface-900',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing...
              </span>
            ) : (
              `Mark for Deletion`
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
