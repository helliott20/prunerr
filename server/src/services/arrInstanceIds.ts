/**
 * Instance ids and the item-to-instance mapping, with no settings or database
 * access, so the rules engine can use them. See arrInstances.ts.
 */

export type ArrType = 'sonarr' | 'radarr';

export const ARR_TYPES: readonly ArrType[] = ['sonarr', 'radarr'];

/** Ids of the primary instances. Additional ones are `<type>-<suffix>`. */
export const PRIMARY_INSTANCE_ID: Record<ArrType, string> = {
  sonarr: 'sonarr',
  radarr: 'radarr',
};

export function isPrimaryInstanceId(id: string | null | undefined): boolean {
  return id === PRIMARY_INSTANCE_ID.sonarr || id === PRIMARY_INSTANCE_ID.radarr;
}

type ArrLinkedItem = {
  type: string;
  sonarr_id?: number | null;
  radarr_id?: number | null;
  arr_instance?: string | null;
};

/** Which app an item is managed by, from its type. */
export function arrTypeForItem(item: { type: string }): ArrType {
  return item.type === 'movie' ? 'radarr' : 'sonarr';
}

/**
 * The instance an item is linked to, or null when it isn't linked to any.
 * Items without `arr_instance` were linked through the primary instance.
 */
export function instanceIdForItem(item: ArrLinkedItem): string | null {
  const type = arrTypeForItem(item);
  const linked = type === 'radarr' ? item.radarr_id : item.sonarr_id;
  if (!linked) return null;
  return item.arr_instance || PRIMARY_INSTANCE_ID[type];
}
