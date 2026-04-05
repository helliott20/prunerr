/**
 * Immutable tree operations for the v2 condition builder. Paths are arrays of
 * child indices; the root is `[]`.
 */
import type { ConditionNode, ConditionGroupNode, ConditionLeaf, GroupLogic } from '@/types';
import { getField, type FieldDef } from './FieldCatalog';

export const MAX_DEPTH = 2; // root group = depth 0; deepest allowed group = depth 2

/** Generate a short unique id for React keys. */
function uid(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyRoot(): ConditionGroupNode {
  return { kind: 'group', logic: 'AND', children: [], _uiId: uid() };
}

export function emptyGroup(logic: GroupLogic = 'AND'): ConditionGroupNode {
  return { kind: 'group', logic, children: [], _uiId: uid() };
}

/**
 * Recursively assign stable `_uiId` to any node (and its descendants) that is
 * missing one. Used when loading a rule from the server so React keys stay
 * stable through edits. Returns a NEW tree — does not mutate the input.
 */
export function ensureUiIds(node: ConditionNode): ConditionNode {
  if (node.kind === 'condition') {
    return node._uiId ? node : { ...node, _uiId: uid() };
  }
  const children = node.children.map(ensureUiIds);
  return { ...node, _uiId: node._uiId ?? uid(), children };
}

/**
 * Recursively strip `_uiId` fields before serialising to the server.
 * Returns a NEW tree.
 */
export function stripUiIds(node: ConditionNode): ConditionNode {
  if (node.kind === 'condition') {
    const { _uiId, ...rest } = node;
    void _uiId;
    return rest;
  }
  const { _uiId, ...rest } = node;
  void _uiId;
  return { ...rest, children: node.children.map(stripUiIds) };
}

/** Depth of the deepest group node in the tree (root counts as 0). */
export function depthOf(node: ConditionNode, current = 0): number {
  if (node.kind === 'condition') return current;
  return node.children.reduce(
    (max, child) => Math.max(max, depthOf(child, current + 1)),
    current
  );
}

/** Return the node at the given path, or undefined if not found. */
export function getNode(root: ConditionNode, path: number[]): ConditionNode | undefined {
  let current: ConditionNode = root;
  for (const idx of path) {
    if (current.kind !== 'group') return undefined;
    const next = current.children[idx];
    if (!next) return undefined;
    current = next;
  }
  return current;
}

/**
 * Replace the node at `path` using the updater function, returning a new tree.
 * No mutation of the input tree.
 */
export function updateNode(
  root: ConditionNode,
  path: number[],
  updater: (n: ConditionNode) => ConditionNode
): ConditionNode {
  if (path.length === 0) return updater(root);
  if (root.kind !== 'group') return root;
  const [head, ...rest] = path;
  const newChildren = root.children.map((child, i) =>
    i === head ? updateNode(child, rest, updater) : child
  );
  return { ...root, children: newChildren };
}

/** Append a child to the group at `path`. No-op if path does not point to a group. */
export function appendChild(
  root: ConditionNode,
  path: number[],
  child: ConditionNode
): ConditionNode {
  return updateNode(root, path, (n) => {
    if (n.kind !== 'group') return n;
    return { ...n, children: [...n.children, child] };
  });
}

/** Remove the child at `childPath` (path to the child to remove). */
export function removeNode(root: ConditionNode, childPath: number[]): ConditionNode {
  if (childPath.length === 0) return root; // can't remove root
  const parentPath = childPath.slice(0, -1);
  const idx = childPath[childPath.length - 1]!;
  return updateNode(root, parentPath, (n) => {
    if (n.kind !== 'group') return n;
    return { ...n, children: n.children.filter((_, i) => i !== idx) };
  });
}

/** Change the logic of a group node at `path`. */
export function setGroupLogic(
  root: ConditionNode,
  path: number[],
  logic: GroupLogic
): ConditionNode {
  return updateNode(root, path, (n) => {
    if (n.kind !== 'group') return n;
    return { ...n, logic };
  });
}

/** Replace a leaf at `path` with new field/operator/value. */
export function updateLeaf(
  root: ConditionNode,
  path: number[],
  patch: Partial<ConditionLeaf>
): ConditionNode {
  return updateNode(root, path, (n) => {
    if (n.kind !== 'condition') return n;
    return { ...n, ...patch, kind: 'condition' };
  });
}

/** Build a default leaf for the given field id using the catalog defaults. */
export function buildDefaultLeaf(fieldId: string): ConditionLeaf {
  const def: FieldDef | undefined = getField(fieldId);
  const operator = def?.defaultOperator ?? def?.operators[0] ?? 'equals';
  const value = def?.defaultValue ?? '';
  return {
    kind: 'condition',
    field: fieldId,
    operator,
    value,
    _uiId: uid(),
  };
}
