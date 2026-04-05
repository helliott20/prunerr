import { describe, it, expect } from 'vitest';
import type { ConditionGroupNode, ConditionLeaf, ConditionNode } from '@/types';
import {
  emptyRoot,
  appendChild,
  removeNode,
  updateNode,
  setGroupLogic,
  updateLeaf,
  buildDefaultLeaf,
  depthOf,
  getNode,
  MAX_DEPTH,
} from '../treeOps';

const leaf = (field: string, value: unknown = 1): ConditionLeaf => ({
  kind: 'condition',
  field,
  operator: 'equals',
  value,
});

describe('treeOps', () => {
  describe('emptyRoot', () => {
    it('returns a group AND node with no children', () => {
      const r = emptyRoot();
      expect(r.kind).toBe('group');
      expect(r.logic).toBe('AND');
      expect(r.children).toHaveLength(0);
    });
  });

  describe('appendChild', () => {
    it('appends a child to the root group immutably', () => {
      const root = emptyRoot();
      const next = appendChild(root, [], leaf('size_gb', 10));
      expect(root.children).toHaveLength(0); // original untouched
      expect((next as ConditionGroupNode).children).toHaveLength(1);
    });

    it('appends nested within a group at depth', () => {
      const root: ConditionGroupNode = {
        kind: 'group',
        logic: 'AND',
        children: [{ kind: 'group', logic: 'OR', children: [] }],
      };
      const next = appendChild(root, [0], leaf('title', 'x'));
      const inner = (next as ConditionGroupNode).children[0] as ConditionGroupNode;
      expect(inner.children).toHaveLength(1);
    });
  });

  describe('removeNode', () => {
    it('removes a child by path', () => {
      const root: ConditionGroupNode = {
        kind: 'group',
        logic: 'AND',
        children: [leaf('a'), leaf('b'), leaf('c')],
      };
      const next = removeNode(root, [1]) as ConditionGroupNode;
      expect(next.children.map((c) => (c as ConditionLeaf).field)).toEqual(['a', 'c']);
    });

    it('leaves root intact for empty path', () => {
      const root = emptyRoot();
      expect(removeNode(root, [])).toBe(root);
    });
  });

  describe('setGroupLogic', () => {
    it('changes logic of root immutably', () => {
      const root = emptyRoot();
      const next = setGroupLogic(root, [], 'OR') as ConditionGroupNode;
      expect(next.logic).toBe('OR');
      expect(root.logic).toBe('AND');
    });

    it('switches to NOT', () => {
      const root = emptyRoot();
      expect((setGroupLogic(root, [], 'NOT') as ConditionGroupNode).logic).toBe('NOT');
    });
  });

  describe('updateLeaf', () => {
    it('patches a leaf field/operator/value', () => {
      const root: ConditionGroupNode = {
        kind: 'group',
        logic: 'AND',
        children: [leaf('a', 1)],
      };
      const next = updateLeaf(root, [0], { operator: 'greater_than', value: 5 });
      const l = (next as ConditionGroupNode).children[0] as ConditionLeaf;
      expect(l.operator).toBe('greater_than');
      expect(l.value).toBe(5);
    });
  });

  describe('updateNode', () => {
    it('replaces the root when path is empty', () => {
      const r1 = emptyRoot();
      const r2: ConditionNode = leaf('x');
      expect(updateNode(r1, [], () => r2)).toBe(r2);
    });
  });

  describe('getNode', () => {
    it('walks a nested tree', () => {
      const root: ConditionGroupNode = {
        kind: 'group',
        logic: 'AND',
        children: [
          { kind: 'group', logic: 'OR', children: [leaf('inner')] },
        ],
      };
      const got = getNode(root, [0, 0]) as ConditionLeaf;
      expect(got.field).toBe('inner');
    });

    it('returns undefined for invalid path', () => {
      expect(getNode(emptyRoot(), [5, 2])).toBeUndefined();
    });
  });

  describe('depthOf', () => {
    it('is 0 for a single leaf', () => {
      expect(depthOf(leaf('x'))).toBe(0);
    });

    it('counts nested groups', () => {
      const root: ConditionGroupNode = {
        kind: 'group',
        logic: 'AND',
        children: [
          {
            kind: 'group',
            logic: 'OR',
            children: [leaf('y')],
          },
        ],
      };
      expect(depthOf(root)).toBe(2);
    });
  });

  describe('buildDefaultLeaf', () => {
    it('creates a leaf with catalog defaults for a known field', () => {
      const l = buildDefaultLeaf('size_gb');
      expect(l.kind).toBe('condition');
      expect(l.field).toBe('size_gb');
      expect(l.operator).toBe('greater_than');
      expect(l.value).toBe(10);
    });

    it('falls back gracefully for unknown field', () => {
      const l = buildDefaultLeaf('definitely_not_a_field');
      expect(l.kind).toBe('condition');
      expect(l.field).toBe('definitely_not_a_field');
    });
  });

  it('MAX_DEPTH is 2', () => {
    expect(MAX_DEPTH).toBe(2);
  });
});
