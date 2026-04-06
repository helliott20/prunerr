import { describe, it, expect } from 'vitest';
import { upgradeToV2 } from '../migration';

describe('upgradeToV2', () => {
  it('wraps an empty legacy array as an AND group', () => {
    const result = upgradeToV2([]);
    expect(result.version).toBe(2);
    expect(result.root).toEqual({ kind: 'group', logic: 'AND', children: [] });
  });

  it('wraps a legacy array of conditions with AND logic', () => {
    const raw = [
      { field: 'play_count', operator: 'equals', value: 0 },
      { field: 'days_since_added', operator: 'greater_than', value: 30 },
    ];
    const result = upgradeToV2(raw);
    expect(result.root).toEqual({
      kind: 'group',
      logic: 'AND',
      children: [
        { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
        { kind: 'condition', field: 'days_since_added', operator: 'greater_than', value: 30 },
      ],
    });
  });

  it('preserves OR logic from a v1 object payload', () => {
    const raw = {
      version: 1,
      logic: 'OR',
      conditions: [
        { field: 'year', operator: 'less_than', value: 2000 },
        { field: 'play_count', operator: 'equals', value: 0 },
      ],
    };
    const result = upgradeToV2(raw);
    expect(result.root).toMatchObject({ kind: 'group', logic: 'OR' });
    expect((result.root as any).children).toHaveLength(2);
  });

  it('treats untagged object with conditions as v1 (AND default)', () => {
    const raw = {
      conditions: [{ field: 'size_gb', operator: 'greater_than', value: 10 }],
    };
    const result = upgradeToV2(raw);
    expect(result.root).toMatchObject({ kind: 'group', logic: 'AND' });
  });

  it('passes v2 payloads through unchanged', () => {
    const v2 = {
      version: 2 as const,
      root: {
        kind: 'group' as const,
        logic: 'OR' as const,
        children: [
          {
            kind: 'condition' as const,
            field: 'year',
            operator: 'less_than',
            value: 1990,
          },
        ],
      },
    };
    const result = upgradeToV2(v2);
    expect(result.root).toBe(v2.root);
  });

  it('is idempotent — calling twice yields equivalent output', () => {
    const raw = [{ field: 'play_count', operator: 'equals', value: 0 }];
    const once = upgradeToV2(raw);
    const twice = upgradeToV2(once);
    expect(twice).toEqual(once);
  });

  it('returns empty group for null/undefined/non-object input', () => {
    expect(upgradeToV2(null).root).toEqual({ kind: 'group', logic: 'AND', children: [] });
    expect(upgradeToV2(undefined).root).toEqual({ kind: 'group', logic: 'AND', children: [] });
    expect(upgradeToV2(42).root).toEqual({ kind: 'group', logic: 'AND', children: [] });
  });
});
