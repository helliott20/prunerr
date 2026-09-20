import type { Settings } from '@/types';

/**
 * Central place for the in-app hrefs that list rows link to.
 *
 * Every list in the app (queue, history, activity, dashboard, collections,
 * recommendations, rule previews) shows a media title, and every one of them
 * should take you to that item's detail page. Building the paths here keeps
 * them consistent and means a route change only has to be made once.
 */

/** Detail page for a media item, or null when the id is missing. */
export function libraryItemPath(id: string | number | null | undefined): string | null {
  if (id === null || id === undefined || id === '') return null;
  return `/library/${id}`;
}

/** Detail page for a collection, or null when the id is missing. */
export function collectionPath(id: string | number | null | undefined): string | null {
  if (id === null || id === undefined || id === '') return null;
  return `/collections/${id}`;
}

/**
 * Rules page, scrolled to and expanded on a specific rule. The Rules page
 * reads the `rule` query param on mount.
 */
export function rulePath(id: string | number | null | undefined): string | null {
  if (id === null || id === undefined || id === '') return null;
  return `/rules?rule=${encodeURIComponent(String(id))}`;
}

/**
 * Href for an activity log entry's target. Activity rows carry a bare
 * `targetId` whose meaning depends on `targetType` — only the types that have
 * a detail page are linkable, so a scan entry (whose id is a scan run, not a
 * media item) renders as plain text instead of a link to the wrong page.
 */
export function activityTargetPath(
  targetType: string | null | undefined,
  targetId: string | number | null | undefined
): string | null {
  if (targetId === null || targetId === undefined || targetId === '') return null;
  switch (targetType) {
    case 'media_item':
      return libraryItemPath(targetId);
    case 'collection':
      return collectionPath(targetId);
    default:
      return null;
  }
}

/** Settings → Connections, where every service is configured. */
export const CONNECTIONS_SETTINGS_PATH = '/settings?section=connections';

/**
 * The web UI of a configured service, for the dashboard's status widget.
 *
 * Health reports the media server as `plex` whatever backend is in use, so the
 * lookup falls back to the Jellyfin/Emby connection when that is the
 * configured one. Returns null when the service has no URL stored, which is
 * the case for anything that hasn't been set up yet.
 */
export function serviceHomeUrl(
  settings: Settings | null | undefined,
  service: string
): string | null {
  const services = settings?.services;
  if (!services) return null;

  const key = service as keyof typeof services;
  const raw =
    service === 'plex'
      ? services.plex?.url || services.jellyfin?.url
      : services[key]?.url;
  if (!raw) return null;

  const base = raw.replace(/\/$/, '');
  // Plex's root serves the API; its web app lives one level down.
  const isPlexProper = service === 'plex' && Boolean(services.plex?.url);
  return isPlexProper ? `${base}/web` : base;
}
