import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, Shield, Trash2 } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { cn, formatBytes } from '@/lib/utils';
import { deletionActionLabel } from '@/lib/deletionActions';
import type { EpisodeDeletionAction } from '@/types';

export interface EpisodeDeletionOptions {
  deletionAction: EpisodeDeletionAction;
  gracePeriodDays: number;
}

interface EpisodeDeletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: EpisodeDeletionOptions) => void;
  /** 'now' skips the grace period and deletes straight away. */
  mode: 'queue' | 'now';
  episodeCount: number;
  totalSize: number;
  isLoading?: boolean;
}

// Full removal is series-wide, so it is not on offer for single episodes.
const EPISODE_ACTIONS: EpisodeDeletionAction[] = [
  'unmonitor_only',
  'delete_files_only',
  'unmonitor_and_delete',
];

const ACTION_ICONS: Record<EpisodeDeletionAction, React.ReactNode> = {
  unmonitor_only: <Shield className="w-4 h-4" />,
  delete_files_only: <Trash2 className="w-4 h-4" />,
  unmonitor_and_delete: <Trash2 className="w-4 h-4" />,
};

const ACTION_VARIANTS: Record<EpisodeDeletionAction, string> = {
  unmonitor_only: 'border-surface-600 hover:border-accent-500/50 hover:bg-accent-500/5',
  delete_files_only: 'border-surface-600 hover:border-amber-500/50 hover:bg-amber-500/5',
  unmonitor_and_delete: 'border-surface-600 hover:border-ruby-500/50 hover:bg-ruby-500/5',
};

const ACTION_SELECTED_VARIANTS: Record<EpisodeDeletionAction, string> = {
  unmonitor_only: 'border-accent-500 bg-accent-500/10',
  delete_files_only: 'border-amber-500 bg-amber-500/10',
  unmonitor_and_delete: 'border-ruby-500 bg-ruby-500/10',
};

const ACTION_ICON_COLORS: Record<EpisodeDeletionAction, string> = {
  unmonitor_only: 'text-accent-text',
  delete_files_only: 'text-amber-400',
  unmonitor_and_delete: 'text-ruby-400',
};

/**
 * Deletion options for a selection of episodes or whole seasons — the
 * episode-level counterpart to DeletionOptionsModal.
 */
/** Episode-scoped wording; the shared descriptions talk about whole items. */
function useActionDescriptions(): Record<EpisodeDeletionAction, string> {
  const { t } = useTranslation('library');
  return {
    unmonitor_only: t('episodeDeletion.actions.unmonitorOnly', 'Stop Sonarr monitoring these episodes but keep the files on disk'),
    delete_files_only: t('episodeDeletion.actions.deleteFilesOnly', 'Delete the episode files; Sonarr keeps monitoring and may grab them again'),
    unmonitor_and_delete: t('episodeDeletion.actions.unmonitorAndDelete', 'Delete the episode files and stop Sonarr grabbing them again'),
  };
}

export function EpisodeDeletionModal({
  isOpen,
  onClose,
  onConfirm,
  mode,
  episodeCount,
  totalSize,
  isLoading = false,
}: EpisodeDeletionModalProps) {
  const { t } = useTranslation('library');
  const actionDescriptions = useActionDescriptions();
  const [gracePeriodDays, setGracePeriodDays] = useState(7);
  const [deletionAction, setDeletionAction] = useState<EpisodeDeletionAction>('unmonitor_and_delete');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        mode === 'now'
          ? t('episodeDeletion.titleNow', 'Delete {{count}} episodes now', { count: episodeCount })
          : t('episodeDeletion.titleQueue', 'Queue {{count}} episodes for deletion', { count: episodeCount })
      }
      description={t('episodeDeletion.description', 'Sonarr handles the selected episodes; the rest of the series is untouched.')}
      size="lg"
    >
      <div className="space-y-6">
        {/* Selection summary */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-surface-800/40 border border-surface-700/40">
          <span className="text-sm text-surface-300">
            {t('episodeDeletion.selected', '{{count}} episodes selected', { count: episodeCount })}
          </span>
          <span className="text-sm text-surface-400 tabular-nums">{formatBytes(totalSize)}</span>
        </div>

        {mode === 'now' ? (
          <div className="flex items-start gap-3 p-4 bg-ruby-500/10 rounded-lg border border-ruby-500/20">
            <AlertTriangle className="w-5 h-5 text-ruby-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-surface-50">
                {t('episodeDeletion.immediateTitle', 'This runs immediately')}
              </p>
              <p className="text-xs text-surface-400 mt-1">
                {t('episodeDeletion.immediateDesc', 'The selected episodes are handled in Sonarr right away, with no grace period to cancel within.')}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-surface-200 mb-3">
              <Clock className="w-4 h-4 text-surface-400" />
              {t('deletionModal.gracePeriod', 'Grace Period')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={365}
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-20 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-surface-50 text-center focus:outline-none focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500"
              />
              <span className="text-surface-400">{t('deletionModal.daysBeforeDeletion', 'days before deletion')}</span>
            </div>
            <p className="text-xs text-surface-500 mt-2">
              {gracePeriodDays === 0
                ? t('episodeDeletion.graceHelpImmediate', 'Episodes will be deleted the next time the queue is processed.')
                : t('episodeDeletion.graceHelpDelayed', 'Episodes stay on disk for {{count}} days and can be taken back out of the queue at any point.', { count: gracePeriodDays })}
            </p>
          </div>
        )}

        {/* Deletion action */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-surface-200 mb-3">
            <Trash2 className="w-4 h-4 text-surface-400" />
            {t('deletionModal.deletionAction', 'Deletion Action')}
          </label>
          <div className="space-y-2">
            {EPISODE_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => setDeletionAction(action)}
                className={cn(
                  'w-full p-3 rounded-lg border text-left transition-all duration-200',
                  deletionAction === action ? ACTION_SELECTED_VARIANTS[action] : ACTION_VARIANTS[action]
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'mt-0.5',
                      deletionAction === action ? ACTION_ICON_COLORS[action] : 'text-surface-400'
                    )}
                  >
                    {ACTION_ICONS[action]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'font-medium',
                          deletionAction === action ? 'text-surface-50' : 'text-surface-200'
                        )}
                      >
                        {deletionActionLabel(action)}
                      </span>
                      {deletionAction === action && <div className="w-2 h-2 rounded-full bg-accent-500" />}
                    </div>
                    <p className="text-xs text-surface-400 mt-0.5">{actionDescriptions[action]}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-surface-700/50">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold rounded-xl',
              'bg-surface-700/80 hover:bg-surface-600/80 border border-surface-600/50 hover:border-surface-500/50',
              'text-surface-200 hover:text-surface-50',
              'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-surface-500/30 focus:ring-offset-2 focus:ring-offset-surface-900'
            )}
          >
            {t('deletionModal.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({ deletionAction, gracePeriodDays: mode === 'now' ? 0 : gracePeriodDays })
            }
            disabled={isLoading}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold rounded-xl border',
              'bg-ruby-500/20 hover:bg-ruby-500/30 border-ruby-500/30 hover:border-ruby-500/50 text-ruby-400 hover:text-ruby-300',
              'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ruby-500/30 focus:ring-offset-2 focus:ring-offset-surface-900',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isLoading
              ? t('deletionModal.processing', 'Processing...')
              : mode === 'now'
                ? t('episodeDeletion.confirmNow', 'Delete now')
                : t('episodeDeletion.confirmQueue', 'Queue for deletion')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default EpisodeDeletionModal;
