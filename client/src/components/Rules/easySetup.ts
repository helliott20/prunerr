import type { ConditionGroupNode, ConditionLeaf, ConditionNode } from '@/types';

/*
 * Easy Setup: a rule written as one sentence — "Mark for deletion <subject>
 * that <condition> and <condition>…". Conditions it has wording for read as
 * part of the sentence; any other condition is carried as-is and edited with
 * the Custom Builder's inputs. So any flat list of conditions joined by AND
 * or OR fits. Converting a rule back can still fail (NONE, or groups); when it
 * does, the reason says what Easy Setup can't show.
 */

export const SENTENCE_SUBJECTS = [
  { value: 'all', label: 'movies and shows' },
  { value: 'movie', label: 'movies' },
  { value: 'show', label: 'TV shows' },
];

export interface SentenceConditionDef {
  id: string;
  label: string;
  field: string;
  operator: string;
  value?: number | string;
  hasInput?: boolean;
  inputSuffix?: string;
  defaultValue?: number | string;
}

export const SENTENCE_CONDITIONS: SentenceConditionDef[] = [
  { id: 'never_watched', label: 'have never been watched', field: 'play_count', operator: 'equals', value: 0 },
  { id: 'watched_once', label: 'have been watched exactly once', field: 'play_count', operator: 'equals', value: 1 },
  { id: 'watched_few_times', label: 'have been watched fewer than', field: 'play_count', operator: 'less_than', hasInput: true, inputSuffix: 'times', defaultValue: 3 },
  { id: 'not_watched_recently', label: "haven't been watched in", field: 'days_since_watched', operator: 'greater_than', hasInput: true, inputSuffix: 'days', defaultValue: 90 },
  { id: 'added_long_ago', label: 'were added more than', field: 'days_since_added', operator: 'greater_than', hasInput: true, inputSuffix: 'days ago', defaultValue: 60 },
  { id: 'large_files', label: 'are larger than', field: 'size_gb', operator: 'greater_than', hasInput: true, inputSuffix: 'GB', defaultValue: 10 },
  { id: 'small_files', label: 'are smaller than', field: 'size_gb', operator: 'less_than', hasInput: true, inputSuffix: 'GB', defaultValue: 1 },
  { id: 'low_resolution', label: 'have a resolution lower than', field: 'resolution_number', operator: 'less_than', hasInput: true, inputSuffix: 'p', defaultValue: 1080 },
  { id: 'old_codec', label: 'use codec', field: 'codec', operator: 'contains', hasInput: true, inputSuffix: '', defaultValue: 'h264' },
  { id: 'released_before', label: 'were released before', field: 'year', operator: 'less_than', hasInput: true, inputSuffix: '', defaultValue: 2015 },
  { id: 'no_watchers', label: 'have been watched by fewer than', field: 'watched_by_count', operator: 'less_than', hasInput: true, inputSuffix: 'users', defaultValue: 2 },
];

export interface ActiveSentenceCondition {
  /** A SENTENCE_CONDITIONS id, or `other:<n>` for a condition without wording. */
  defId: string;
  value: number | string;
  /** Set for a condition without wording: the condition itself. */
  leaf?: ConditionLeaf;
}

let otherCounter = 0;

/** A condition Easy Setup has no wording for, kept as the Custom Builder has it. */
export function otherCondition(leaf: ConditionLeaf): ActiveSentenceCondition {
  otherCounter += 1;
  return { defId: `other:${otherCounter}`, value: '', leaf };
}

export function isOtherCondition(c: ActiveSentenceCondition): c is ActiveSentenceCondition & { leaf: ConditionLeaf } {
  return c.leaf !== undefined;
}

/** How the sentence's conditions combine: all of them, or any one. */
export type SentenceLogic = 'AND' | 'OR';

/** Convert Easy Setup sentence conditions into a v2 condition tree. */
export function sentenceToTree(
  conditions: ActiveSentenceCondition[],
  logic: SentenceLogic = 'AND'
): ConditionGroupNode {
  const leaves: ConditionLeaf[] = conditions.map((ac) => {
    if (isOtherCondition(ac)) return ac.leaf;
    const def = SENTENCE_CONDITIONS.find((d) => d.id === ac.defId)!;
    return { kind: 'condition', field: def.field, operator: def.operator, value: ac.value };
  });
  return { kind: 'group', logic, children: leaves };
}

/** Why a rule can't be shown in Easy Setup. */
export type EasySetupBlocker =
  | { kind: 'not' }
  | { kind: 'nested' };

export type TreeToSentenceResult =
  | { ok: true; conditions: ActiveSentenceCondition[]; logic: SentenceLogic }
  | { ok: false; blocker: EasySetupBlocker };

/** The Easy Setup condition a leaf is, if any. */
function matchLeaf(leaf: ConditionLeaf): { def: SentenceConditionDef; value: number | string } | null {
  if (leaf.params && Object.keys(leaf.params).length > 0) return null;
  for (const def of SENTENCE_CONDITIONS) {
    if (def.field !== leaf.field || def.operator !== leaf.operator) continue;
    if (!def.hasInput) {
      if (leaf.value === def.value) return { def, value: def.value ?? 0 };
      continue;
    }
    // The input keeps the type of its default: a number box can't hold text.
    const wantsNumber = typeof def.defaultValue === 'number';
    if (wantsNumber && typeof leaf.value === 'number' && Number.isFinite(leaf.value)) return { def, value: leaf.value };
    if (!wantsNumber && typeof leaf.value === 'string') return { def, value: leaf.value };
  }
  return null;
}

/** Turn a rule back into Easy Setup's sentence, or say why it can't be. */
export function treeToSentence(root: ConditionNode): TreeToSentenceResult {
  const group: ConditionGroupNode =
    root.kind === 'group' ? root : { kind: 'group', logic: 'AND', children: [root] };
  if (group.logic === 'NOT') return { ok: false, blocker: { kind: 'not' } };

  const conditions: ActiveSentenceCondition[] = [];
  for (const child of group.children) {
    if (child.kind !== 'condition') return { ok: false, blocker: { kind: 'nested' } };
    const match = matchLeaf(child);
    // Wording is used once; a repeat, or a condition without wording, is
    // kept as it is.
    if (match && !conditions.some((c) => c.defId === match.def.id)) {
      conditions.push({ defId: match.def.id, value: match.value });
    } else {
      conditions.push(otherCondition(child));
    }
  }
  return { ok: true, conditions, logic: group.logic === 'OR' ? 'OR' : 'AND' };
}
