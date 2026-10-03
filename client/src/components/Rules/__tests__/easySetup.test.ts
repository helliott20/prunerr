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
    expect(treeToSentence(sentenceToTree(conditions))).toEqual({ ok: true, conditions, logic: 'AND' });
    expect(treeToSentence(sentenceToTree(conditions, 'OR'))).toEqual({ ok: true, conditions, logic: 'OR' });
  });

  it('tells fixed-value conditions apart', () => {
    const result = treeToSentence(and(leaf('play_count', 'equals', 1), leaf('play_count', 'less_than', 5)));
    expect(result).toEqual({
      ok: true,
      logic: 'AND',
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
      blocker: { kind: 'not' },
    });
  });

  it('reads a rule that matches any condition', () => {
    const result = treeToSentence({
      kind: 'group',
      logic: 'OR',
      children: [leaf('size_gb', 'greater_than', 20), leaf('year', 'less_than', 2000)],
    });
    expect(result).toEqual({
      ok: true,
      logic: 'OR',
      conditions: [
        { defId: 'large_files', value: 20 },
        { defId: 'released_before', value: 2000 },
      ],
    });
  });

  it('says why a rule can’t be shown', () => {
    expect(treeToSentence(and(and(leaf('size_gb', 'greater_than', 20))))).toEqual({ ok: false, blocker: { kind: 'nested' } });
  });

  it('keeps conditions without wording, and repeats, as they are', () => {
    const title = leaf('title', 'contains', 'Christmas');
    const exactSize = leaf('size_gb', 'equals', 20); // a field it words, with another operator
    const bigger = leaf('size_gb', 'greater_than', 30);
    const result = treeToSentence(and(leaf('size_gb', 'greater_than', 20), title, exactSize, bigger));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conditions[0]).toEqual({ defId: 'large_files', value: 20 });
    expect(result.conditions.slice(1).map((c) => c.leaf)).toEqual([title, exactSize, bigger]);
    // And they come back out unchanged, in order.
    expect(sentenceToTree(result.conditions).children).toEqual([leaf('size_gb', 'greater_than', 20), title, exactSize, bigger]);
  });

  it('keeps values its inputs can’t hold, and conditions with parameters, as they are', () => {
    const text = leaf('size_gb', 'greater_than', 'big');
    const byUser = leaf('watched_by_user', 'not_watched_since', null, { username: 'dan', days: 30 });
    const result = treeToSentence(and(text, byUser));
    expect(result.ok && result.conditions.map((c) => c.leaf)).toEqual([text, byUser]);
  });
});
