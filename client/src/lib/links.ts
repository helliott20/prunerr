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
  // Additional Sonarr/Radarr instances report under their own id.
  const extra = [...(settings?.arrInstances?.sonarr ?? []), ...(settings?.arrInstances?.radarr ?? [])].find(
    (instance) => instance.id === service
  );
  const raw =
    service === 'plex'
      ? services.plex?.url || services.jellyfin?.url
      : extra
        ? extra.url
        : services[key]?.url;
  if (!raw) return null;

  const base = raw.replace(/\/$/, '');
  // Plex's root serves the API; its web app lives one level down.
  const isPlexProper = service === 'plex' && Boolean(services.plex?.url);
  return isPlexProper ? `${base}/web` : base;
}

/** Id of the primary Sonarr/Radarr instance, which lives in `services.<type>`. */
export const PRIMARY_ARR_INSTANCE = { sonarr: 'sonarr', radarr: 'radarr' } as const;

/**
 * Every Sonarr/Radarr instance of one type the settings know about, primary
 * first: `{ id, name, url }`. Unconfigured ones (no URL) are left out.
 */
export function arrInstancesOf(
  settings: Settings | null | undefined,
  type: 'sonarr' | 'radarr'
): Array<{ id: string; name: string; url: string; primary: boolean }> {
  const fallback = type === 'sonarr' ? 'Sonarr' : 'Radarr';
  const out: Array<{ id: string; name: string; url: string; primary: boolean }> = [];
  const primary = settings?.services?.[type];
  if (primary?.url) {
    out.push({ id: PRIMARY_ARR_INSTANCE[type], name: primary.name?.trim() || fallback, url: primary.url, primary: true });
  }
  (settings?.arrInstances?.[type] ?? []).forEach((instance, index) => {
    if (!instance.url) return;
    out.push({ id: instance.id, name: instance.name?.trim() || `${fallback} ${index + 2}`, url: instance.url, primary: false });
  });
  return out;
}

/**
 * The "open in Sonarr/Radarr" link for an item, using the instance it belongs
 * to. Null when the item isn't linked or its instance has no URL.
 */
export function arrLinkFor(
  item: { type: 'movie' | 'tv'; sonarrId?: number | null; radarrId?: number | null; arrInstance?: string | null },
  settings: Settings | null | undefined
): { name: string; url: string } | null {
  const type = item.type === 'movie' ? 'radarr' : 'sonarr';
  const id = type === 'radarr' ? item.radarrId : item.sonarrId;
  if (!id) return null;
  const instanceId = item.arrInstance || PRIMARY_ARR_INSTANCE[type];
  const instances = arrInstancesOf(settings, type);
  const instance = instances.find((i) => i.id === instanceId);
  if (!instance) return null;
  const base = instance.url.replace(/\/$/, '');
  // Only one instance: keep the plain "Sonarr"/"Radarr" label.
  const name = instances.length > 1 ? instance.name : type === 'sonarr' ? 'Sonarr' : 'Radarr';
  return { name, url: `${base}/${type === 'sonarr' ? 'series' : 'movie'}/${id}` };
}

/** Whether any Sonarr or Radarr instance is set up, so deleting is possible. */
export function hasArrService(settings: Settings | null | undefined): boolean {
  return arrInstancesOf(settings, 'sonarr').length > 0 || arrInstancesOf(settings, 'radarr').length > 0;
}
