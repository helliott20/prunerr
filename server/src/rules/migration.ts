import type {
  ConditionLeaf,
  ConditionNode,
  LegacyCondition,
  RuleConditions,
} from './types';

/**
 * Upgrades any raw rule-conditions payload to the v2 schema.
 *
 * Accepts:
 *   - v2 payloads: `{ version: 2, root: ConditionNode }` — returned unchanged
 *   - v1 payloads: `{ version: 1, conditions, logic }` — wrapped into a root group
 *   - Untagged objects: `{ conditions, logic? }` — treated as v1
 *   - Untagged arrays: `LegacyCondition[]` — treated as v1 with AND logic
 *   - Untagged objects with a `root` node but no `version` — treated as v2
 *
 * Idempotent: calling twice returns an equivalent structure.
 */
export function upgradeToV2(raw: unknown): RuleConditions & { version: 2 } {
  if (raw === null || raw === undefined) {
    return { version: 2, root: emptyRoot() };
  }

  // Array shape → legacy conditions with AND logic
  if (Array.isArray(raw)) {
    return {
      version: 2,
      root: wrapLegacy(raw as LegacyCondition[], 'AND'),
    };
  }

  if (typeof raw !== 'object') {
    return { version: 2, root: emptyRoot() };
  }

  const obj = raw as Record<string, unknown>;

  // Already v2
  if (obj['version'] === 2 && obj['root']) {
    return { version: 2, root: obj['root'] as ConditionNode };
  }

  // v2 without version tag
  if (!('version' in obj) && 'root' in obj && isConditionNode(obj['root'])) {
    return { version: 2, root: obj['root'] as ConditionNode };
  }

  // Treat as v1
  const conditions = Array.isArray(obj['conditions'])
    ? (obj['conditions'] as LegacyCondition[])
    : [];
  const logic = obj['logic'] === 'OR' ? 'OR' : 'AND';

  return {
    version: 2,
    root: wrapLegacy(conditions, logic),
  };
}

function emptyRoot(): ConditionNode {
  return { kind: 'group', logic: 'AND', children: [] };
}

function wrapLegacy(
  conditions: LegacyCondition[],
  logic: 'AND' | 'OR'
): ConditionNode {
  const children: ConditionLeaf[] = conditions.map((c) => ({
    kind: 'condition',
    field: String(c.field),
    operator: String(c.operator),
    value: c.value,
  }));
  return { kind: 'group', logic, children };
}

function isConditionNode(value: unknown): value is ConditionNode {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v['kind'] === 'condition' || v['kind'] === 'group';
}
