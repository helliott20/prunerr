import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  Layers,
  ChevronDown,
  Info,
  Monitor,
  Star,
  Eye,
  Tag,
  Inbox,
  Sparkles,
  Search,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { collectionsApi, usersApi, requestersApi } from '@/services/api';
import type { ConditionGroupNode, ConditionLeaf, ConditionNode, GroupLogic } from '@/types';
import {
  FIELD_CATALOG,
  FIELD_GROUPS,
  FEATURED_FIELD_IDS,
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
  const { t } = useTranslation('rules');
  const isRoot = depth === 0;
  const canNest = depth < MAX_DEPTH;

  const logicLabels: Record<GroupLogic, { label: string; hint: string }> = {
    AND: { label: t('logic.allLabel', 'ALL'), hint: t('logic.allHint', 'every condition must match') },
    OR: { label: t('logic.anyLabel', 'ANY'), hint: t('logic.anyHint', 'at least one condition must match') },
    NOT: { label: t('logic.noneLabel', 'NONE'), hint: t('logic.noneHint', 'no condition may match') },
  };

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
          <Layers className="w-4 h-4 text-accent-text" />
          <span className="text-xs text-surface-400 uppercase tracking-wide">
            {isRoot ? t('group.match', 'Match') : t('group.group', 'Group')}
          </span>
          <div className="inline-flex rounded-lg border border-surface-600 overflow-hidden">
            {LOGIC_ORDER.map((logic) => (
              <button
                key={logic}
                type="button"
                onClick={() => setLogic(logic)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  node.logic === logic
                    ? 'bg-accent-500/20 text-surface-50 ring-1 ring-inset ring-accent-500/50'
                    : 'bg-surface-700 text-surface-300 hover:bg-surface-600'
                }`}
                title={logicLabels[logic].hint}
              >
                {logicLabels[logic].label}
              </button>
            ))}
          </div>
          <span className="text-xs text-surface-500 hidden sm:inline">{logicLabels[node.logic].hint}</span>
        </div>
        {!isRoot && (
          <button
            type="button"
            onClick={() => onRemove(path)}
            className="inline-flex items-center justify-center w-8 h-8 rounded text-surface-500 hover:text-ruby-400 hover:bg-ruby-500/10 active:bg-ruby-500/15 transition-colors"
            title={t('group.removeGroup', 'Remove group')}
            aria-label={t('group.removeGroup', 'Remove group')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Children */}
      {node.children.length === 0 ? (
        <p className="text-sm text-surface-500 italic px-2 py-1">
          {t('group.noConditions', 'No conditions yet — add one below.')}
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
          {t('group.addCondition', 'Add condition')}
        </Button>
        {canNest && (
          <Button type="button" variant="ghost" size="sm" onClick={addGroup}>
            <Plus className="w-3.5 h-3.5" />
            {t('group.addGroup', 'Add group')}
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
  const { t } = useTranslation('rules');
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
      {/* Field selector — rich dropdown */}
      <FieldPicker
        value={leaf.field}
        onChange={updateLeafField}
      />

      {/* Operator selector */}
      <select
        value={leaf.operator}
        onChange={(e) => updateOperator(e.target.value)}
        className="px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500 min-w-[100px] sm:min-w-[140px]"
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
        className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded text-surface-500 hover:text-ruby-400 hover:bg-ruby-500/10 active:bg-ruby-500/15 transition-colors"
        title={t('leaf.removeCondition', 'Remove condition')}
        aria-label={t('leaf.removeCondition', 'Remove condition')}
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
  const { t } = useTranslation('rules');
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
          placeholder={t('value.min', 'min')}
        />
        <span className="text-surface-500 text-xs">{t('value.and', 'and')}</span>
        <input
          type="number"
          value={numOrEmpty(arr[1])}
          onChange={(e) => onChange([arr[0] ?? '', toNumOrStr(e.target.value)])}
          className={numInputClass}
          placeholder={t('value.max', 'max')}
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
        placeholder={t('value.csvPlaceholder', 'value1, value2, ...')}
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
    case 'requester':
      return <RequesterWidget value={value} onChange={onChange} />;
    case 'plexUser':
      return <PlexUserWidget value={value} onChange={onChange} />;
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
  const { t } = useTranslation('rules');
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1 bg-surface-800 border border-surface-600 rounded min-w-[140px] sm:min-w-[200px]">
      {value.map((chip, i) => (
        <span
          key={`${chip}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent-500/20 text-surface-50 ring-1 ring-inset ring-accent-500/40 text-xs"
        >
          {chip}
          <button
            type="button"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="text-surface-200 hover:text-ruby-400"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        placeholder={t('value.addPlaceholder', 'add...')}
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
  const { t } = useTranslation('rules');
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['plexUsers'],
    queryFn: usersApi.list,
    staleTime: 5 * 60 * 1000,
  });

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await usersApi.sync();
      await queryClient.invalidateQueries({ queryKey: ['plexUsers'] });
    } catch {
      // Silently fail — the user list will remain empty
    } finally {
      setSyncing(false);
    }
  }, [queryClient]);

  const username = (params?.['username'] as string) ?? '';
  const days = (params?.['days'] as number) ?? 90;
  const needsDays = operator === 'watched_since' || operator === 'not_watched_since';

  const [userSearch, setUserSearch] = useState(username);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  // Keep search in sync with external value
  useEffect(() => { setUserSearch(username); }, [username]);

  // Close on click outside
  useEffect(() => {
    if (!userOpen) return;
    const handler = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserOpen(false);
        // If they typed something not in the list, accept it as-is
        if (userSearch && userSearch !== username) {
          onParamsChange({ ...params, username: userSearch });
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userOpen, userSearch, username, params, onParamsChange]);

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(userSearch.toLowerCase())
  );

  const selectUser = (name: string) => {
    setUserSearch(name);
    onParamsChange({ ...params, username: name });
    setUserOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <div ref={userRef} className="relative">
        <input
          type="text"
          value={userSearch}
          onChange={(e) => {
            setUserSearch(e.target.value);
            setUserOpen(true);
          }}
          onFocus={() => setUserOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (userSearch) onParamsChange({ ...params, username: userSearch });
              setUserOpen(false);
            } else if (e.key === 'Escape') {
              setUserOpen(false);
            }
          }}
          placeholder={t('user.typeOrSelect', 'Type or select user…')}
          className={`${baseInputClass} min-w-[140px] sm:min-w-[180px]`}
        />
        {userOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 w-full max-h-48 overflow-y-auto bg-surface-800 border border-surface-600 rounded-lg shadow-xl shadow-black/15">
            {filteredUsers.length > 0 ? (
              filteredUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => selectUser(u.username)}
                  className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                    u.username === username
                      ? 'bg-accent-500/15 text-surface-50'
                      : 'text-surface-200 hover:bg-surface-700/60'
                  }`}
                >
                  {u.username}
                  {u.isOwner && (
                    <span className="ml-1.5 text-2xs text-surface-500">{t('user.owner', '(owner)')}</span>
                  )}
                </button>
              ))
            ) : users.length === 0 ? (
              <div className="px-3 py-2 text-xs text-surface-500">
                {t('user.noneSynced', 'No users synced.')}
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  className="ml-1 text-accent-text hover:text-accent-300 disabled:opacity-50"
                >
                  {syncing ? t('user.syncing', 'Syncing…') : t('user.syncNow', 'Sync now')}
                </button>
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-surface-500">
                {t('user.noMatchesEnter', 'No matches — press Enter to use "{{query}}"', { query: userSearch })}
              </div>
            )}
          </div>
        )}
      </div>
      {needsDays && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={days}
            onChange={(e) => onParamsChange({ ...params, days: Number(e.target.value) })}
            className={numInputClass}
          />
          <span className="text-xs text-surface-400">{t('user.days', 'days')}</span>
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
  const { t } = useTranslation('rules');
  const needsPicker = operator === 'in_collection_id';
  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionsApi.list,
    staleTime: 5 * 60 * 1000,
    enabled: needsPicker,
  });

  if (!needsPicker) {
    return <span className="text-xs text-surface-500 px-2">{t('collection.noValueNeeded', '(no value needed)')}</span>;
  }

  return (
    <select
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      className={selectClass}
    >
      <option value="">{t('collection.select', 'Select collection…')}</option>
      {collections.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
          {c.isProtected ? t('collection.protectedSuffix', ' (protected)') : ''}
        </option>
      ))}
    </select>
  );
}

function RequesterWidget({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation('rules');
  const current = String(value ?? '');
  const { data: requesters = [] } = useQuery({
    queryKey: ['requesters'],
    queryFn: requestersApi.list,
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState(current);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Keep the input in sync when the condition value changes elsewhere.
  useEffect(() => { setSearch(current); }, [current]);

  // Close on click outside, committing any free-typed text.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        if (search !== current) onChange(search);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, search, current, onChange]);

  const matches = requesters.filter((r) =>
    r.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onChange(search);
            setOpen(false);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={t('requester.typeOrSelect', 'Type or select requester…')}
        className={`${baseInputClass} min-w-[140px] sm:min-w-[180px]`}
      />
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-full max-h-48 overflow-y-auto bg-surface-800 border border-surface-600 rounded-lg shadow-xl shadow-black/15">
          {matches.length > 0 ? (
            matches.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => { setSearch(r); onChange(r); setOpen(false); }}
                className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                  r === current
                    ? 'bg-accent-500/15 text-surface-50'
                    : 'text-surface-200 hover:bg-surface-700/60'
                }`}
              >
                {r}
              </button>
            ))
          ) : requesters.length === 0 ? (
            <div className="px-3 py-2 text-xs text-surface-500">
              {t('requester.noData', 'No requester data yet — run a library sync with Overseerr/Jellyseerr connected.')}
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-surface-500">
              {t('user.noMatchesEnter', 'No matches — press Enter to use "{{query}}"', { query: search })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlexUserWidget({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation('rules');
  const current = String(value ?? '');
  const { data: users = [] } = useQuery({
    queryKey: ['plexUsers'],
    queryFn: usersApi.list,
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState(current);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setSearch(current); }, [current]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        if (search !== current) onChange(search);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, search, current, onChange]);

  const matches = users.filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onChange(search);
            setOpen(false);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={t('plexUser.typeOrSelect', 'Type or select Plex user…')}
        className={`${baseInputClass} min-w-[140px] sm:min-w-[180px]`}
      />
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-full max-h-48 overflow-y-auto bg-surface-800 border border-surface-600 rounded-lg shadow-xl shadow-black/15">
          {matches.length > 0 ? (
            matches.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { setSearch(u.username); onChange(u.username); setOpen(false); }}
                className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                  u.username === current
                    ? 'bg-accent-500/15 text-surface-50'
                    : 'text-surface-200 hover:bg-surface-700/60'
                }`}
              >
                {u.username}
                {u.isOwner && (
                  <span className="ml-1.5 text-2xs text-surface-500">{t('user.owner', '(owner)')}</span>
                )}
              </button>
            ))
          ) : users.length === 0 ? (
            <div className="px-3 py-2 text-xs text-surface-500">
              {t('plexUser.noneSynced', 'No Plex users synced yet — connect Tautulli or Tracearr and run a sync.')}
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-surface-500">
              {t('user.noMatchesEnter', 'No matches — press Enter to use "{{query}}"', { query: search })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────── Style tokens ──────────────────────

const baseInputClass =
  'px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-accent-500';
const numInputClass = `${baseInputClass} w-20 sm:w-24`;
const textInputClass = `${baseInputClass} min-w-[120px] sm:min-w-[160px]`;
const selectClass = `${baseInputClass} min-w-[100px] sm:min-w-[140px]`;

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

// ────────────────────── Rich Field Picker ──────────────────────

const GROUP_ICONS: Record<string, React.ElementType> = {
  info: Info,
  monitor: Monitor,
  star: Star,
  eye: Eye,
  layers: Layers,
  tag: Tag,
  inbox: Inbox,
};

/** Visible section in the field picker: either the synthesised "Common"
 *  pinned section or one of the configured FIELD_GROUPS. */
interface PickerSection {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  fields: FieldDef[];
}

function FieldPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (fieldId: string) => void;
}) {
  const { t } = useTranslation('rules');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const currentField = getField(value);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
      setSearch('');
      setActiveIndex(0);
    }
  }, [open]);

  const currentGroup = FIELD_GROUPS.find((g) => g.id === currentField?.group);
  const GroupIcon = currentGroup ? GROUP_ICONS[currentGroup.icon] ?? Info : Info;

  const lowerSearch = search.toLowerCase().trim();
  const hasSearch = lowerSearch.length > 0;

  const matchesSearch = (f: FieldDef, groupLabel: string): boolean => {
    if (!hasSearch) return true;
    return (
      f.label.toLowerCase().includes(lowerSearch) ||
      f.id.toLowerCase().includes(lowerSearch) ||
      (f.unit ? f.unit.toLowerCase().includes(lowerSearch) : false) ||
      groupLabel.toLowerCase().includes(lowerSearch)
    );
  };

  // Build the visible section list. Without search we pin a "Common" section
  // at the top with the featured fields; with a search the user is hunting
  // by name so we just show every matching field grouped normally.
  const sections: PickerSection[] = [];
  if (!hasSearch) {
    const featured = FEATURED_FIELD_IDS
      .map((id) => FIELD_CATALOG.find((f) => f.id === id))
      .filter((f): f is FieldDef => Boolean(f));
    if (featured.length > 0) {
      sections.push({
        id: '__featured__',
        label: t('fieldPicker.common', 'Common'),
        description: t('fieldPicker.commonDesc', 'Most-used fields'),
        icon: Sparkles,
        fields: featured,
      });
    }
  }
  for (const group of FIELD_GROUPS) {
    const fields = FIELD_CATALOG.filter(
      (f) => f.group === group.id && matchesSearch(f, group.label)
    );
    if (fields.length === 0) continue;
    sections.push({
      id: group.id,
      label: group.label,
      description: group.description,
      icon: GROUP_ICONS[group.icon] ?? Info,
      fields,
    });
  }

  // Flatten for keyboard navigation. The same field may appear in both the
  // "Common" pin and its real group — we deliberately keep both rows so
  // arrow-key indexing matches what the user sees.
  const flatFields: FieldDef[] = sections.flatMap((s) => s.fields);
  const hasResults = flatFields.length > 0;
  const safeActiveIndex = hasResults
    ? Math.min(activeIndex, flatFields.length - 1)
    : 0;
  const activeField = hasResults ? flatFields[safeActiveIndex] : undefined;

  // Reset active index whenever the visible list changes shape
  useEffect(() => {
    setActiveIndex(0);
  }, [lowerSearch]);

  // Keep the active row scrolled into view
  useEffect(() => {
    if (!open || !hasResults) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-field-index="${safeActiveIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, safeActiveIndex, hasResults]);

  const select = (fieldId: string) => {
    onChange(fieldId);
    setOpen(false);
    setSearch('');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!hasResults) return;
      setActiveIndex((i) => (i + 1) % flatFields.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hasResults) return;
      setActiveIndex((i) => (i - 1 + flatFields.length) % flatFields.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeField) select(activeField.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setSearch('');
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (hasResults) setActiveIndex(flatFields.length - 1);
    }
  };

  let runningIndex = -1;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-800 border border-surface-600 rounded text-sm text-surface-100 hover:border-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-500 min-w-[140px] sm:min-w-[200px] transition-colors"
      >
        <GroupIcon className="w-3.5 h-3.5 text-surface-400 shrink-0" />
        <span className="flex-1 text-left truncate">{currentField?.label ?? value}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-activedescendant={activeField ? `field-opt-${activeField.id}` : undefined}
          className="absolute top-full left-0 mt-1 z-50 w-72 sm:w-80 max-w-[calc(100vw-2rem)] bg-surface-800 border border-surface-600 rounded-lg shadow-xl shadow-black/20 flex flex-col max-h-96"
        >
          {/* Search input */}
          <div className="p-2 border-b border-surface-700/50 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('fieldPicker.searchPlaceholder', 'Search fields…')}
                aria-label={t('fieldPicker.searchAria', 'Search fields')}
                className="w-full pl-8 pr-2.5 py-1.5 bg-surface-900/60 border border-surface-600 rounded text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
            </div>
          </div>

          {/* Field list */}
          <div ref={listRef} className="overflow-y-auto flex-1 min-h-0">
            {sections.map((section) => {
              const SIcon = section.icon;
              return (
                <div key={section.id}>
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-700/50 bg-surface-800 sticky top-0 z-10">
                    <SIcon className="w-3.5 h-3.5 text-accent-text" />
                    <span className="text-2xs font-semibold text-surface-300 uppercase tracking-wider">
                      {section.label}
                    </span>
                    {!hasSearch && section.description && (
                      <span className="text-2xs text-surface-500 ml-auto truncate">
                        {section.description}
                      </span>
                    )}
                  </div>
                  {section.fields.map((f) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const isSelected = f.id === value;
                    const isActive = idx === safeActiveIndex;
                    return (
                      <button
                        key={`${section.id}-${f.id}`}
                        id={isActive ? `field-opt-${f.id}` : undefined}
                        data-field-index={idx}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => select(f.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                          isActive
                            ? 'bg-surface-700/80 text-surface-50'
                            : isSelected
                              ? 'bg-accent-500/15 text-surface-50'
                              : 'text-surface-200 hover:bg-surface-700/60'
                        }`}
                      >
                        {isSelected && (
                          <span className="w-1 h-4 -ml-1 mr-0.5 rounded-full bg-accent-500" aria-hidden />
                        )}
                        <span className="flex-1 truncate">{f.label}</span>
                        {f.unit && (
                          <span className="text-2xs text-surface-500 px-1.5 py-0.5 bg-surface-700/60 rounded shrink-0">
                            {f.unit}
                          </span>
                        )}
                        {f.valueType === 'list' && (
                          <span className="text-2xs text-surface-500 px-1.5 py-0.5 bg-surface-700/60 rounded shrink-0">
                            {t('fieldPicker.listBadge', 'list')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {!hasResults && (
              <div className="px-3 py-6 text-xs text-surface-500 text-center">
                {t('fieldPicker.noFields', 'No fields matching "{{query}}"', { query: search })}
              </div>
            )}
          </div>

          {/* Footer: hint + active-field detail */}
          <div className="px-3 py-1.5 border-t border-surface-700/60 bg-surface-900/40 text-2xs text-surface-500 flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline">
              <kbd className="px-1 py-0.5 bg-surface-700/60 rounded text-surface-400 mr-0.5">↑↓</kbd>
              {t('fieldPicker.navigate', 'navigate')}
            </span>
            <span className="hidden sm:inline">
              <kbd className="px-1 py-0.5 bg-surface-700/60 rounded text-surface-400 mr-0.5">↵</kbd>
              {t('fieldPicker.select', 'select')}
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface-700/60 rounded text-surface-400 mr-0.5">esc</kbd>
              {t('fieldPicker.close', 'close')}
            </span>
            {activeField && (
              <span className="ml-auto truncate text-surface-400">
                {(FIELD_GROUPS.find((g) => g.id === activeField.group)?.label) ?? activeField.group}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
