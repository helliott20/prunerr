import { Bell, Clock, KeyRound, Palette, Plug, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { CategoryId } from './types';

/** Minimal translate signature, so this stays independent of the i18n namespace. */
export type TranslateFn = (key: string, fallback: string) => string;

export interface NavSubItem {
  /** Anchor id — must match the `id` given to the panel's `PanelSection`. */
  id: string;
  labelKey: string;
  /** Default copy, so a missing translation still renders something sensible. */
  fallback: string;
}

export interface NavCategory {
  id: CategoryId;
  labelKey: string;
  fallback: string;
  icon: LucideIcon;
  subItems: NavSubItem[];
  /**
   * Extra search terms beyond the label and sub-item names, so searching for
   * what a setting *does* finds the category that holds it.
   */
  keywords: string;
}

export const SETTINGS_NAV: NavCategory[] = [
  {
    id: 'connections',
    labelKey: 'nav.connections',
    fallback: 'Connections',
    icon: Plug,
    subItems: [
      { id: 'media-server', labelKey: 'nav.sub.mediaServer', fallback: 'Media server' },
      { id: 'sonarr-radarr', labelKey: 'nav.sub.sonarrRadarr', fallback: 'Sonarr & Radarr' },
      { id: 'watch-history', labelKey: 'nav.sub.watchHistory', fallback: 'Watch history' },
      { id: 'overseerr', labelKey: 'nav.sub.overseerr', fallback: 'Overseerr' },
      { id: 'unraid', labelKey: 'nav.sub.unraid', fallback: 'Unraid' },
    ],
    keywords: 'plex jellyfin emby token api key url server tautulli tracearr connect test',
  },
  {
    id: 'automation',
    labelKey: 'nav.automation',
    fallback: 'Automation',
    icon: Clock,
    subItems: [
      { id: 'library-sync', labelKey: 'nav.sub.librarySync', fallback: 'Library sync' },
      { id: 'scan-schedule', labelKey: 'nav.sub.scanSchedule', fallback: 'Scan schedule' },
      { id: 'disk-pressure', labelKey: 'nav.sub.diskPressure', fallback: 'Disk pressure' },
    ],
    keywords: 'schedule cron scan sync grace reclaim observe queue interval disk space threshold',
  },
  {
    id: 'safety',
    labelKey: 'nav.safety',
    fallback: 'Safety',
    icon: ShieldCheck,
    subItems: [
      { id: 'library-exclusions', labelKey: 'nav.sub.libraryExclusions', fallback: 'Library exclusions' },
      { id: 'exclusion-patterns', labelKey: 'nav.sub.exclusionPatterns', fallback: 'Exclusion patterns' },
    ],
    keywords: 'exclude protect skip ignore pattern library never delete shield',
  },
  {
    id: 'alerts',
    labelKey: 'nav.alerts',
    fallback: 'Alerts',
    icon: Bell,
    subItems: [
      { id: 'discord', labelKey: 'nav.sub.discord', fallback: 'Discord' },
      { id: 'webhooks', labelKey: 'nav.sub.webhooks', fallback: 'Outbound webhooks' },
      { id: 'notification-language', labelKey: 'nav.sub.notificationLanguage', fallback: 'Notification language' },
    ],
    keywords: 'discord webhook notify notification alert event language message',
  },
  {
    id: 'interface',
    labelKey: 'nav.interface',
    fallback: 'Interface',
    icon: Palette,
    subItems: [
      { id: 'display-preferences', labelKey: 'nav.sub.displayPreferences', fallback: 'Display preferences' },
      { id: 'haptics', labelKey: 'nav.sub.haptics', fallback: 'Haptic feedback' },
    ],
    keywords: 'date time format size unit relative absolute iso haptic vibration theme',
  },
  {
    id: 'system',
    labelKey: 'nav.system',
    fallback: 'System',
    icon: KeyRound,
    subItems: [
      { id: 'api-key', labelKey: 'nav.sub.apiKey', fallback: 'API key' },
      { id: 'backup-restore', labelKey: 'nav.sub.backupRestore', fallback: 'Backup & restore' },
    ],
    keywords: 'api key token regenerate export import backup restore version',
  },
];

/**
 * Case-insensitive match over the category label, its sub-item labels and its
 * keyword list. An empty query matches everything.
 */
export function matchesQuery(category: NavCategory, query: string, t: TranslateFn): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    t(category.labelKey, category.fallback),
    ...category.subItems.map((item) => t(item.labelKey, item.fallback)),
    category.keywords,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}
