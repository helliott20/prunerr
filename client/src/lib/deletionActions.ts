import i18n from '@/i18n';
import type { DeletionAction } from '@/types';

// Canonical display order for the four deletion actions. Iterate this instead
// of Object.keys so the dropdown/option order is stable and intentional.
export const DELETION_ACTIONS: DeletionAction[] = [
  'unmonitor_only',
  'delete_files_only',
  'unmonitor_and_delete',
  'full_removal',
];

// Localised label for a deletion action. Uses the i18n singleton (not a hook)
// so it can be called from non-component modules (e.g. activityFormatter); the
// keys are written as literal strings so i18next-cli can extract them.
export function deletionActionLabel(action: DeletionAction): string {
  switch (action) {
    case 'unmonitor_only':
      return i18n.t('rules:deletionActions.unmonitor_only.label', 'Unmonitor Only (keep files)');
    case 'delete_files_only':
      return i18n.t('rules:deletionActions.delete_files_only.label', 'Delete Files Only');
    case 'unmonitor_and_delete':
      return i18n.t('rules:deletionActions.unmonitor_and_delete.label', 'Unmonitor & Delete Files');
    case 'full_removal':
      return i18n.t('rules:deletionActions.full_removal.label', 'Full Removal (delete everything)');
  }
}

export function deletionActionDescription(action: DeletionAction): string {
  switch (action) {
    case 'unmonitor_only':
      return i18n.t('rules:deletionActions.unmonitor_only.description', 'Stop monitoring the item but keep all files and metadata intact');
    case 'delete_files_only':
      return i18n.t('rules:deletionActions.delete_files_only.description', 'Delete the media files but keep the item in Sonarr/Radarr for re-download');
    case 'unmonitor_and_delete':
      return i18n.t('rules:deletionActions.unmonitor_and_delete.description', 'Unmonitor and delete files, but keep metadata in Sonarr/Radarr');
    case 'full_removal':
      return i18n.t('rules:deletionActions.full_removal.description', 'Completely remove from Sonarr/Radarr including all metadata');
  }
}
