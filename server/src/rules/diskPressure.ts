import type { MediaItem, Rule } from '../types';
import type { ConditionNode } from './types';
import { upgradeToV2 } from './migration';

/**
 * The "Disk pressure" rule condition. A rule that uses it doesn't run in the
 * nightly scan: the disk-pressure monitor runs it when free space drops below
 * target, picks from its matches, and only removes enough to recover.
 */
export const DISK_PRESSURE_FIELD = 'disk_pressure';

export type PressureSeverity = 'soft' | 'critical';

/**
 * What the condition reads. Only the disk-pressure monitor sets it for real;
 * the rule preview sets it as if space were critically low, so it can show
 * what the rule would pick from. Without it the condition never matches.
 */
export interface DiskPressureState {
  severity: PressureSeverity;
  /** Whether the item is stored on the drive that's low. */
  isOnDrive: (item: MediaItem) => boolean;
}

export function nodeUsesDiskPressure(node: ConditionNode): boolean {
  if (node.kind === 'condition') return node.field === DISK_PRESSURE_FIELD;
  return node.children.some(nodeUsesDiskPressure);
}

/** Whether a saved rule's conditions use disk pressure anywhere in the tree. */
export function ruleUsesDiskPressure(rule: Pick<Rule, 'conditions'>): boolean {
  try {
    return nodeUsesDiskPressure(upgradeToV2(JSON.parse(rule.conditions)).root);
  } catch {
    return false;
  }
}

/**
 * `low` matches soft or critical pressure, `critical` only critical. The item
 * must be on the drive that's low, so a library on a healthy drive is left alone.
 */
export function evaluateDiskPressure(
  operator: string,
  value: unknown,
  item: MediaItem,
  state: DiskPressureState | undefined
): boolean {
  if (!state || operator !== 'equals') return false;
  if (!state.isOnDrive(item)) return false;
  return value === 'critical' ? state.severity === 'critical' : true;
}
