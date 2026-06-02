import i18n from '@/i18n';

// The Unraid array state arrives as a raw English string from the Unraid API
// ('Started' | 'Stopped' | 'Syncing' | anything else). Colour/palette logic
// still keys off the raw value; this only localises the displayed text.
// Literal keys so i18next-cli can extract them.
export function arrayStateLabel(state: string): string {
  switch (state) {
    case 'Started':
      return i18n.t('common:unraid.arrayState.started', 'Started');
    case 'Stopped':
      return i18n.t('common:unraid.arrayState.stopped', 'Stopped');
    case 'Syncing':
      return i18n.t('common:unraid.arrayState.syncing', 'Syncing');
    default:
      return i18n.t('common:unraid.arrayState.unknown', 'Unknown');
  }
}
