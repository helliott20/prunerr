import { describe, it, expect } from 'vitest';
import { evaluateNode } from '../conditions';
import { nodeUsesDiskPressure, ruleUsesDiskPressure, type DiskPressureState } from '../diskPressure';
import type { ConditionNode } from '../types';
import type { MediaItem } from '../../types';

const item = { id: 1, type: 'movie', title: 'Movie', play_count: 0 } as MediaItem;

const low: ConditionNode = { kind: 'condition', field: 'disk_pressure', operator: 'equals', value: 'low' };
const critical: ConditionNode = { kind: 'condition', field: 'disk_pressure', operator: 'equals', value: 'critical' };

const state = (severity: DiskPressureState['severity'], onDrive = true): DiskPressureState => ({
  severity,
  isOnDrive: () => onDrive,
});

describe('disk pressure condition', () => {
  it('never matches outside the disk pressure monitor', () => {
    expect(evaluateNode(low, item, {})).toBe(false);
  });

  it('"low" matches soft and critical pressure', () => {
    expect(evaluateNode(low, item, { diskPressure: state('soft') })).toBe(true);
    expect(evaluateNode(low, item, { diskPressure: state('critical') })).toBe(true);
  });

  it('"critical" only matches critical pressure', () => {
    expect(evaluateNode(critical, item, { diskPressure: state('soft') })).toBe(false);
    expect(evaluateNode(critical, item, { diskPressure: state('critical') })).toBe(true);
  });

  it('does not match items on another drive', () => {
    expect(evaluateNode(low, item, { diskPressure: state('critical', false) })).toBe(false);
  });

  it('finds the condition anywhere in a rule', () => {
    const nested: ConditionNode = {
      kind: 'group',
      logic: 'AND',
      children: [
        { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
        { kind: 'group', logic: 'OR', children: [low] },
      ],
    };
    expect(nodeUsesDiskPressure(nested)).toBe(true);
    expect(ruleUsesDiskPressure({ conditions: JSON.stringify({ version: 2, root: nested }) })).toBe(true);
    expect(ruleUsesDiskPressure({ conditions: JSON.stringify([{ field: 'play_count', operator: 'equals', value: 0 }]) })).toBe(false);
    expect(ruleUsesDiskPressure({ conditions: 'not json' })).toBe(false);
  });
});
