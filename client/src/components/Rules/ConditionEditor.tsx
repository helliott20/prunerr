import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Layers } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { collectionsApi, usersApi } from '@/services/api';
import type { ConditionGroupNode, ConditionLeaf, ConditionNode, GroupLogic } from '@/types';
import {
  FIELD_CATALOG,
  FIELD_GROUPS,
  OPERATOR_LABELS,
  getField,
  operatorNeedsValue,
  type FieldDef,
  type Operator,
} from './FieldCatalog';
import { MAX_DEPTH, buildDefaultLeaf, emptyGroup } from './treeOps';

interface ConditionEditorProps {
  node: ConditionNode;
  /** Path from the root group to this node. Root = []. */
  path: number[];
  depth: number;
  onUpdate: (path: number[], updater: (n: ConditionNode) => ConditionNode) => void;
  onAppend: (path: number[], child: ConditionNode) => void;
  onRemove: (path: number[]) => void;
}

const LOGIC_LABELS: Record<GroupLogic, { label: string; hint: string }> = {
  AND: { label: 'ALL', hint: 'every condition must match' },
  OR: { label: 'ANY', hint: 'at least one condition must match' },
  NOT: { label: 'NONE', hint: 'no condition may match' },
};

const LOGIC_ORDER: GroupLogic[] = ['AND', 'OR', 'NOT'];

export function ConditionEditor(props: ConditionEditorProps) {
  if (props.node.kind === 'group') {
    return <GroupEditor {...props} node={props.node} />;
  }
  return <LeafEditor {...props} leaf={props.node} />;
}

// ────────────────────── Group Editor ──────────────────────

function GroupEditor({
  node,
  path,
  depth,
  onUpdate,
  onAppend,
  onRemove,
}: ConditionEditorProps & { node: ConditionGroupNode }) {
  const isRoot = depth === 0;
  const canNest = depth < MAX_DEPTH;

  const setLogic = (logic: GroupLogic) =>
    onUpdate(path, (n) => (n.kind === 'group' ? { ...n, logic } : n));

  const addCondition = () => {
    // pick a sensible default — first field in basics
    const firstField = FIELD_CATALOG[0]!.id;
    onAppend(path, buildDefaultLeaf(firstField));
  };

  const addGroup = () => {
    onAppend(path, emptyGroup('AND'));
  };

  return (
    <div
      className={`rounded-lg border p-3 space-y-3 ${
        isRoot
          ? 'border-surface-600 bg-surface-800/60'
          : 'border-accent-500/30 bg-surface-800/40'
      }`}
    >
      {/* Group header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-accent-400" />
          <span className="text-xs text-surface-400 uppercase tracking-wide">
            {isRoot ? 'Match' : 'Group'}
          </span>
          <div className="inline-flex rounded-lg border border-surface-600 overflow-hidden">
            {LOGIC_ORDER.map((logic) => (
              <button
                key={logic}
                type="button"
                onClick={() => setLogic(logic)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  node.logic === logic
                    ? 'bg-accent-500 text-surface-950'
                    : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
                title={LOGIC_LABELS[logic].hint}
              >
                {LOGIC_LABELS[logic].label}
              </button>
            ))}
          </div>
          <span className="text-xs text-surface-500">{LOGIC_LABELS[node.logic].hint}</span>
        </div>
        {!isRoot && (
          <button
            type="button"
            onClick={() => onRemove(path)}
            className="p-1 text-surface-500 hover:text-ruby-400 transition-colors"
            title="Remove group"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Children */}
      {node.children.length === 0 ? (
        <p className="text-sm text-surface-500 italic px-2 py-1">
          No conditions yet — add one below.
        </p>
      ) : (
        <div className="space-y-2">
          {node.children.map((child, idx) => (
            <ConditionEditor
              key={child._uiId ?? `fallback-${idx}`}
              node={child}
              path={[...path, idx]}
              depth={depth + 1}
              onUpdate={onUpdate}
              onAppend={onAppend}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}

      {/* Add buttons */}
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={addCondition}>
          <Plus className="w-3.5 h-3.5" />
          Add condition
        </Button>
        {canNest && (
          <Button type="button" variant="ghost" size="sm" onClick={addGroup}>
            <Plus className="w-3.5 h-3.5" />
            Add group
          </Button>
        )}
      </div>
    </div>
  );
}

// ────────────────────── Leaf Editor ──────────────────────

function LeafEditor({
  leaf,
  path,
  onUpdate,
  onRemove,
}: ConditionEditorProps & { leaf: ConditionLeaf }) {
  const field = getField(leaf.field);

  const updateLeafField = (fieldId: string) => {
    onUpdate(path, () => buildDefaultLeaf(fieldId));
  };

  const updateOperator = (op: string) => {
    onUpdate(path, (n) => {
      if (n.kind !== 'condition') return n;
      // Reset params/value shape when switching operator semantics
      const nextValue = operatorNeedsValue(op) ? n.value : null;
      return { ...n, operator: op, value: nextValue };
    });
  };

  const updateValue = (value: unknown) => {
    onUpdate(path, (n) => (n.kind === 'condition' ? { ...n, value } : n));
  };

  const updateParams = (params: Record<string, unknown>) => {
    onUpdate(path, (n) => (n.kind === 'condition' ? { ...n, params } : n));
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-surface-900/60 border border-surface-700/60">
      {/* Field selector */}
      <select
        value={leaf.field}
        onChange={(e) => updateLeafField(e.target.value)}
        className="px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500 min-w-[180px]"
      >
        {FIELD_GROUPS.map((g) => {
          const fields = FIELD_CATALOG.filter((f) => f.group === g.id);
          if (fields.length === 0) return null;
          return (
            <optgroup key={g.id} label={g.label}>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>

      {/* Operator selector */}
      <select
        value={leaf.operator}
        onChange={(e) => updateOperator(e.target.value)}
        className="px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500 min-w-[140px]"
      >
        {(field?.operators ?? []).map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op as Operator] ?? op}
          </option>
        ))}
      </select>

      {/* Value widget */}
      {field && operatorNeedsValue(leaf.operator) && (
        <ValueWidget
          field={field}
          operator={leaf.operator}
          value={leaf.value}
          params={leaf.params}
          onChange={updateValue}
          onParamsChange={updateParams}
        />
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(path)}
        className="ml-auto p-1 text-surface-500 hover:text-ruby-400 transition-colors"
        title="Remove condition"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// ────────────────────── Value Widgets ──────────────────────

interface ValueWidgetProps {
  field: FieldDef;
  operator: string;
  value: unknown;
  params?: Record<string, unknown>;
  onChange: (v: unknown) => void;
  onParamsChange: (p: Record<string, unknown>) => void;
}

function ValueWidget({
  field,
  operator,
  value,
  params,
  onChange,
  onParamsChange,
}: ValueWidgetProps) {
  // 'between' → two numeric inputs
  if (operator === 'between' && field.valueType === 'number') {
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={numOrEmpty(arr[0])}
          onChange={(e) => onChange([toNumOrStr(e.target.value), arr[1] ?? ''])}
          className={numInputClass}
          placeholder="min"
        />
        <span className="text-surface-500 text-xs">and</span>
        <input
          type="number"
          value={numOrEmpty(arr[1])}
          onChange={(e) => onChange([arr[0] ?? '', toNumOrStr(e.target.value)])}
          className={numInputClass}
          placeholder="max"
        />
        {field.unit && <span className="text-xs text-surface-400">{field.unit}</span>}
      </div>
    );
  }

  // 'in' / 'not_in' → comma-separated list input
  if (operator === 'in' || operator === 'not_in') {
    const asString = Array.isArray(value) ? (value as string[]).join(', ') : String(value ?? '');
    return (
      <input
        type="text"
        value={asString}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
        className={textInputClass}
        placeholder="value1, value2, ..."
      />
    );
  }

  switch (field.valueType) {
    case 'number':
      return (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={numOrEmpty(value)}
            onChange={(e) => onChange(toNumOrStr(e.target.value))}
            className={numInputClass}
          />
          {field.unit && <span className="text-xs text-surface-400">{field.unit}</span>}
        </div>
      );
    case 'string':
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={textInputClass}
          placeholder={field.placeholder}
        />
      );
    case 'enum':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={selectClass}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'list':
      return (
        <ListChipInput
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={textInputClass}
        />
      );
    case 'user':
      return (
        <UserOperatorWidget
          operator={operator}
          value={value}
          params={params}
          onChange={onChange}
          onParamsChange={onParamsChange}
        />
      );
    case 'collection':
      return (
        <CollectionWidget
          operator={operator}
          value={value}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}

// ────────────────────── Specialised widgets ──────────────────────

function ListChipInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1 bg-surface-800 border border-surface-600 rounded min-w-[200px]">
      {value.map((chip, i) => (
        <span
          key={`${chip}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent-500/20 text-accent-300 text-xs"
        >
          {chip}
          <button
            type="button"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="text-accent-400 hover:text-ruby-400"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        placeholder="add..."
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const next = (e.currentTarget.value || '').trim();
            if (next && !value.includes(next)) onChange([...value, next]);
            e.currentTarget.value = '';
          } else if (e.key === 'Backspace' && !e.currentTarget.value && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        className="flex-1 min-w-[80px] bg-transparent text-sm text-surface-100 focus:outline-none"
      />
    </div>
  );
}

function UserOperatorWidget({
  operator,
  params,
  onParamsChange,
}: {
  operator: string;
  value: unknown;
  params?: Record<string, unknown>;
  onChange: (v: unknown) => void;
  onParamsChange: (p: Record<string, unknown>) => void;
}) {
  const { data: users = [] } = useQuery({
    queryKey: ['plexUsers'],
    queryFn: usersApi.list,
    staleTime: 5 * 60 * 1000,
  });

  const username = (params?.['username'] as string) ?? '';
  const days = (params?.['days'] as number) ?? 90;
  const needsDays = operator === 'watched_since' || operator === 'not_watched_since';

  return (
    <div className="flex items-center gap-2">
      <select
        value={username}
        onChange={(e) => onParamsChange({ ...params, username: e.target.value })}
        className={selectClass}
      >
        <option value="">Select user…</option>
        {users.map((u) => (
          <option key={u.id} value={u.username}>
            {u.username}
            {u.isOwner ? ' (owner)' : ''}
          </option>
        ))}
      </select>
      {needsDays && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={days}
            onChange={(e) => onParamsChange({ ...params, days: Number(e.target.value) })}
            className={numInputClass}
          />
          <span className="text-xs text-surface-400">days</span>
        </div>
      )}
    </div>
  );
}

function CollectionWidget({
  operator,
  value,
  onChange,
}: {
  operator: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const needsPicker = operator === 'in_collection_id';
  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => collectionsApi.list(),
    staleTime: 5 * 60 * 1000,
    enabled: needsPicker,
  });

  if (!needsPicker) {
    return <span className="text-xs text-surface-500 px-2">(no value needed)</span>;
  }

  return (
    <select
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      className={selectClass}
    >
      <option value="">Select collection…</option>
      {collections.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
          {c.isProtected ? ' (protected)' : ''}
        </option>
      ))}
    </select>
  );
}

// ────────────────────── Style tokens ──────────────────────

const baseInputClass =
  'px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500';
const numInputClass = `${baseInputClass} w-24`;
const textInputClass = `${baseInputClass} min-w-[160px]`;
const selectClass = `${baseInputClass} min-w-[140px]`;

// ────────────────────── Small helpers ──────────────────────

function numOrEmpty(v: unknown): number | string {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '') return v;
  return '';
}

function toNumOrStr(raw: string): number | string {
  if (raw === '') return '';
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}
