import { describe, it, expect } from 'vitest';
import { sentenceToTree, treeToSentence } from '../easySetup';
import type { ConditionNode } from '@/types';

const leaf = (field: string, operator: string, value: unknown, params?: Record<string, unknown>): ConditionNode => ({
  kind: 'condition',
  field,
  operator,
  value,
  ...(params ? { params } : {}),
});
const and = (...children: ConditionNode[]): ConditionNode => ({ kind: 'group', logic: 'AND', children });

describe('treeToSentence', () => {
  it('round-trips what Easy Setup builds', () => {
    const conditions = [
      { defId: 'never_watched', value: 0 },
      { defId: 'added_long_ago', value: 120 },
      { defId: 'old_codec', value: 'mpeg4' },
    ];
    expect(treeToSentence(sentenceToTree(conditions))).toEqual({ ok: true, conditions });
  });

  it('tells fixed-value conditions apart', () => {
    const result = treeToSentence(and(leaf('play_count', 'equals', 1), leaf('play_count', 'less_than', 5)));
    expect(result).toEqual({
      ok: true,
      conditions: [
        { defId: 'watched_once', value: 1 },
        { defId: 'watched_few_times', value: 5 },
      ],
    });
  });

  it('accepts a lone condition with any group logic except NONE', () => {
    expect(treeToSentence({ kind: 'group', logic: 'OR', children: [leaf('size_gb', 'greater_than', 20)] }).ok).toBe(true);
    expect(treeToSentence({ kind: 'group', logic: 'NOT', children: [leaf('size_gb', 'greater_than', 20)] })).toEqual({
      ok: false,
      blocker: { kind: 'logic', logic: 'NOT' },
    });
  });

  it('says why a rule can’t be shown', () => {
    expect(
      treeToSentence({ kind: 'group', logic: 'OR', children: [leaf('size_gb', 'greater_than', 20), leaf('year', 'less_than', 2000)] })
    ).toEqual({ ok: false, blocker: { kind: 'logic', logic: 'OR' } });
    expect(treeToSentence(and(and(leaf('size_gb', 'greater_than', 20))))).toEqual({ ok: false, blocker: { kind: 'nested' } });
    expect(treeToSentence(and(leaf('watch_progress', 'not_equals', 'in_progress')))).toEqual({
      ok: false,
      blocker: { kind: 'condition', field: 'watch_progress' },
    });
    // A supported field with an operator Easy Setup doesn't offer.
    expect(treeToSentence(and(leaf('size_gb', 'equals', 20)))).toEqual({
      ok: false,
      blocker: { kind: 'condition', field: 'size_gb' },
    });
    expect(treeToSentence(and(leaf('size_gb', 'greater_than', 20), leaf('size_gb', 'greater_than', 30)))).toEqual({
      ok: false,
      blocker: { kind: 'duplicate', field: 'size_gb' },
    });
    expect(treeToSentence(and(leaf('size_gb', 'greater_than', 20)), ['3'])).toEqual({
      ok: false,
      blocker: { kind: 'libraries' },
    });
  });

  it('rejects values its inputs can’t hold, and conditions with extra parameters', () => {
    expect(treeToSentence(and(leaf('size_gb', 'greater_than', 'big'))).ok).toBe(false);
    expect(treeToSentence(and(leaf('days_since_watched', 'greater_than', 30, { username: 'dan' }))).ok).toBe(false);
  });
});
