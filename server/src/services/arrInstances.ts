import config from '../config';
import settingsRepo from '../db/repositories/settings';
import logger from '../utils/logger';
import { ARR_TYPES, PRIMARY_INSTANCE_ID, type ArrType } from './arrInstanceIds';

export {
  ARR_TYPES,
  PRIMARY_INSTANCE_ID,
  arrTypeForItem,
  instanceIdForItem,
  isPrimaryInstanceId,
  type ArrType,
} from './arrInstanceIds';

/**
 * Sonarr and Radarr instances.
 *
 * The first (primary) instance of each app keeps living in the settings keys
 * it always has (`sonarr_url`, `sonarr_apiKey`, plus an optional
 * `sonarr_name`), so environment variables, settings export/import and older
 * clients keep working untouched. Any further instances are stored as one JSON
 * array under `sonarr_instances` / `radarr_instances`.
 *
 * An item records the instance its `sonarr_id`/`radarr_id` came from in
 * `media_items.arr_instance`. Null there means the primary instance: every
 * item linked before multiple instances existed belongs to it.
 */

const DEFAULT_NAME: Record<ArrType, string> = { sonarr: 'Sonarr', radarr: 'Radarr' };

/** An additional instance as stored in `<type>_instances`. */
export interface StoredArrInstance {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  enabled?: boolean;
}

/** A usable instance: configured, enabled, primary or additional. */
export interface ArrInstanceConfig {
  id: string;
  type: ArrType;
  name: string;
  url: string;
  apiKey: string;
  primary: boolean;
}

export function instancesSettingKey(type: ArrType): string {
  return `${type}_instances`;
}

const ID_SUFFIX = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

/** An additional instance's id must be `<type>-<suffix>`, so ids never collide across apps. */
export function isValidAdditionalId(type: ArrType, id: unknown): id is string {
  if (typeof id !== 'string' || !id.startsWith(`${type}-`)) return false;
  return ID_SUFFIX.test(id.slice(type.length + 1));
}

/**
 * Parse and clean a stored (or submitted) list of additional instances. Bad
 * entries are dropped rather than failing the whole list; duplicate ids keep
 * the first.
 */
export function parseAdditionalInstances(raw: unknown, type: ArrType): StoredArrInstance[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      list = JSON.parse(raw);
    } catch {
      logger.warn(`Ignoring unreadable ${instancesSettingKey(type)} setting`);
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: StoredArrInstance[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!isValidAdditionalId(type, e['id']) || seen.has(e['id'])) continue;
    seen.add(e['id']);
    out.push({
      id: e['id'],
      name: typeof e['name'] === 'string' ? e['name'].trim().slice(0, 64) : '',
      url: typeof e['url'] === 'string' ? e['url'].trim() : '',
      apiKey: typeof e['apiKey'] === 'string' ? e['apiKey'].trim() : '',
      ...(e['enabled'] === false ? { enabled: false } : {}),
    });
  }
  return out;
}

export function getStoredAdditionalInstances(type: ArrType): StoredArrInstance[] {
  return parseAdditionalInstances(settingsRepo.getValue(instancesSettingKey(type)), type);
}

function primaryConfig(type: ArrType): ArrInstanceConfig | null {
  // Same fallback the scanner always had: settings first, then the env config.
  const url = settingsRepo.getValue(`${type}_url`) || config[type].url;
  const apiKey = settingsRepo.getValue(`${type}_apiKey`) || config[type].apiKey;
  if (!url || !apiKey) return null;
  const name = settingsRepo.getValue(`${type}_name`)?.trim() || DEFAULT_NAME[type];
  return { id: PRIMARY_INSTANCE_ID[type], type, name, url, apiKey, primary: true };
}

/**
 * The instances Prunerr should talk to, primary first, then the additional
 * ones in the order the user listed them. Unconfigured (no URL or key) and
 * disabled instances are left out.
 */
export function getArrInstanceConfigs(type: ArrType): ArrInstanceConfig[] {
  const list: ArrInstanceConfig[] = [];
  const primary = primaryConfig(type);
  if (primary) list.push(primary);
  getStoredAdditionalInstances(type).forEach((stored, index) => {
    if (stored.enabled === false || !stored.url || !stored.apiKey) return;
    list.push({
      id: stored.id,
      type,
      name: stored.name || `${DEFAULT_NAME[type]} ${index + 2}`,
      url: stored.url,
      apiKey: stored.apiKey,
      primary: false,
    });
  });
  return list;
}

/**
 * Ids of every instance that still exists: the primary ones that have a URL
 * and key, plus every stored additional one, enabled or not. An item linked
 * to anything else belongs to an instance that was removed.
 */
export function getKnownInstanceIds(): string[] {
  const ids: string[] = [];
  for (const type of ARR_TYPES) {
    if (primaryConfig(type)) ids.push(PRIMARY_INSTANCE_ID[type]);
    ids.push(...getStoredAdditionalInstances(type).map((i) => i.id));
  }
  return ids;
}

/** Display names for every known instance id, configured or not. */
export function getArrInstanceNames(): Record<string, string> {
  const names: Record<string, string> = {};
  for (const type of ARR_TYPES) {
    names[PRIMARY_INSTANCE_ID[type]] =
      settingsRepo.getValue(`${type}_name`)?.trim() || DEFAULT_NAME[type];
    getStoredAdditionalInstances(type).forEach((stored, index) => {
      names[stored.id] = stored.name || `${DEFAULT_NAME[type]} ${index + 2}`;
    });
  }
  return names;
}

/**
 * Ids of additional instances that were in `before` but are not in `after`:
 * instances the user removed. Their items need unlinking.
 */
export function removedInstanceIds(before: StoredArrInstance[], after: StoredArrInstance[]): string[] {
  const kept = new Set(after.map((i) => i.id));
  return before.filter((i) => !kept.has(i.id)).map((i) => i.id);
}
