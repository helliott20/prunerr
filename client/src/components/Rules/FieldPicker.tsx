import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Eye, Inbox, Info, Layers, Monitor, Search, Sparkles, Star, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { DrawnCheck, TypewriterLabel, prefersReducedMotion, useFloatingMenu } from '@/components/common/dropdown';
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

/**
 * Two-pane field picker for the condition row. Replaces the `FieldPicker`
 * function at the bottom of ConditionEditor.tsx.
 *
 * Left rail: Common + the 7 FIELD_GROUPS with counts (match counts while
 * searching). Right: the selected group's fields, or every match grouped when
 * a query is typed. Footer: "Reads as" preview of the highlighted field using
 * its defaultOperator/defaultValue, plus key hints.
 *
 * Keys: ↓/↑/Enter/Space on the trigger open it and focus search. In the menu:
 * ↑↓ move, ←→ switch group (when not searching), Enter selects, Esc closes.
 */

const GROUP_ICONS: Record<string, React.ElementType> = {
  info: Info, monitor: Monitor, star: Star, eye: Eye, layers: Layers, tag: Tag, inbox: Inbox,
};
const FEATURED = '__featured__';
const COMMIT_MS = 160;

interface Section {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  fields: FieldDef[];
}

const VALUE_TYPE_LABEL: Record<string, string> = {
  number: 'number', string: 'text', enum: 'one of a set', list: 'list', date: 'date',
  user: 'per-user', plexUser: 'user name', collection: 'collection', requester: 'requester',
};

function previewValue(f: FieldDef): string {
  const op = f.defaultOperator ?? f.operators[0];
  if (!operatorNeedsValue(op)) return '';
  const v = f.defaultValue;
  if (f.valueType === 'user') return `any user · ${v} days`;
  if (Array.isArray(v) || v === '' || v == null) return '…';
  return `${v}${f.unit && f.unit !== 'kbps' ? ` ${f.unit}` : ''}`;
}

export function FieldPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (fieldId: string) => void;
}) {
  const { t } = useTranslation('rules');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout>>();

  const menu = useFloatingMenu({ triggerRef, menuRef, align: 'start' });
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>(FEATURED);
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(value);
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (menu.phase === 'closed') setShown(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const current = getField(value);
  const shownField = getField(shown);
  const q = query.trim().toLowerCase();

  const matches = (f: FieldDef, groupLabel: string) =>
    !q ||
    f.label.toLowerCase().includes(q) ||
    f.id.toLowerCase().includes(q) ||
    (f.unit?.toLowerCase().includes(q) ?? false) ||
    groupLabel.toLowerCase().includes(q);

  const featuredFields = useMemo(
    () => FEATURED_FIELD_IDS.map((id) => FIELD_CATALOG.find((f) => f.id === id)).filter((f): f is FieldDef => !!f),
    []
  );

  const rail = useMemo(() => {
    const items = [
      { id: FEATURED, label: t('fieldPicker.common', 'Common'), icon: Sparkles, fields: featuredFields, groupLabel: '' },
      ...FIELD_GROUPS.map((g) => ({
        id: g.id,
        label: g.label,
        icon: GROUP_ICONS[g.icon] ?? Info,
        fields: FIELD_CATALOG.filter((f) => f.group === g.id),
        groupLabel: g.label,
      })),
    ];
    return items.map((it) => ({ ...it, count: it.fields.filter((f) => matches(f, it.groupLabel)).length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, featuredFields, t]);

  const sections: Section[] = useMemo(() => {
    if (!q) {
      if (group === FEATURED) {
        return [{ id: FEATURED, label: t('fieldPicker.common', 'Common'), description: t('fieldPicker.commonDesc', 'Most-used fields'), icon: Sparkles, fields: featuredFields }];
      }
      const g = FIELD_GROUPS.find((x) => x.id === group)!;
      return [{ id: g.id, label: g.label, description: g.description, icon: GROUP_ICONS[g.icon] ?? Info, fields: FIELD_CATALOG.filter((f) => f.group === g.id) }];
    }
    return FIELD_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      icon: GROUP_ICONS[g.icon] ?? Info,
      fields: FIELD_CATALOG.filter((f) => f.group === g.id && matches(f, g.label)),
    })).filter((s) => s.fields.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, group, featuredFields, t]);

  const flat = sections.flatMap((s) => s.fields);
  const safeActive = flat.length ? Math.min(active, flat.length - 1) : -1;
  const activeField = safeActive >= 0 ? flat[safeActive] : current;

  const openMenu = () => {
    const f = getField(value);
    const startGroup = f && FEATURED_FIELD_IDS.includes(f.id) ? FEATURED : f?.group ?? FEATURED;
    const list = startGroup === FEATURED ? featuredFields : FIELD_CATALOG.filter((x) => x.group === startGroup);
    setQuery('');
    setGroup(startGroup);
    setActive(Math.max(0, list.findIndex((x) => x.id === value)));
    haptic();
    menu.open();
  };

  const commit = (f: FieldDef | undefined) => {
    if (!f) return;
    onChange(f.id);
    haptic();
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(
      () => {
        menu.close();
        setShown(f.id);
        setPlayKey((k) => k + 1);
      },
      prefersReducedMotion() ? 0 : COMMIT_MS
    );
  };

  useEffect(() => {
    if (menu.isOpen) searchRef.current?.focus({ preventScroll: true });
  }, [menu.isOpen]);

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    if (!menu.isOpen || safeActive < 0) return;
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-field-index="${safeActive}"]`);
    if (!list || !el) return;
    if (el.offsetTop < list.scrollTop + 32) list.scrollTop = el.offsetTop - 32;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 5;
  }, [safeActive, menu.isOpen]);

  const railIds = rail.map((r) => r.id);

  const onMenuKey = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!flat.length) return;
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setActive((a) => (Math.min(a, flat.length - 1) + d + flat.length) % flat.length);
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (q) return; // let the caret move inside the search text
        e.preventDefault();
        const i = railIds.indexOf(group);
        const d = e.key === 'ArrowRight' ? 1 : -1;
        setGroup(railIds[(i + d + railIds.length) % railIds.length]);
        setActive(0);
        return;
      }
      case 'Home':
      case 'End':
        if (q) return;
        e.preventDefault();
        setActive(e.key === 'Home' ? 0 : Math.max(0, flat.length - 1));
        return;
      case 'Enter':
        e.preventDefault();
        commit(activeField);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // the rule builder is a modal
        menu.close();
        return;
      case 'Tab':
        menu.close(false);
    }
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!menu.isOpen && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  };

  const ShownIcon = shownField ? GROUP_ICONS[FIELD_GROUPS.find((g) => g.id === shownField.group)?.icon ?? 'info'] ?? Info : Info;
  const activeOp = (activeField?.defaultOperator ?? activeField?.operators[0]) as Operator | undefined;
  let runningIndex = -1;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={menu.isOpen}
        onClick={() => (menu.isOpen ? menu.close() : openMenu())}
        onKeyDown={onTriggerKey}
        className={cn(
          'flex h-[38px] w-full items-center gap-[9px] rounded-[11px] border pl-[11px] pr-2.5 sm:w-[228px]',
          'bg-surface-800/70 text-[13px] font-medium text-surface-50',
          'transition-[border-color,box-shadow,transform] duration-150 active:scale-[0.98]',
          'focus:outline-none focus-visible:border-accent-500/50 focus-visible:ring-[3px] focus-visible:ring-accent-500/[0.12]',
          menu.isOpen ? 'border-accent-500/50 ring-[3px] ring-accent-500/[0.12]' : 'border-surface-600/60 hover:border-surface-500/60'
        )}
      >
        <span className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-md bg-accent-500/[0.12]">
          <ShownIcon className="h-[13px] w-[13px] text-accent-text" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <TypewriterLabel text={shownField?.label ?? shown} playKey={playKey} />
        </span>
        <ChevronDown aria-hidden className={cn('dd-chevron h-4 w-4 flex-shrink-0 text-surface-400', menu.isOpen && 'rotate-180')} />
      </button>

      {menu.mounted &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={t('fieldPicker.searchAria', 'Search fields')}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
            }}
            onKeyDown={onMenuKey}
            style={{
              position: 'fixed',
              top: menu.pos?.top ?? -9999,
              left: menu.pos?.left ?? -9999,
              visibility: menu.pos ? 'visible' : 'hidden',
            }}
            className={cn(
              'dd-menu z-[60] flex h-[430px] max-h-[calc(100vh-16px)] w-[500px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[14px]',
              'border border-surface-700 bg-surface-900',
              'shadow-[0_18px_40px_-12px_rgba(15,23,42,0.25)] dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.75),0_0_0_1px_rgba(0,0,0,0.2)]',
              menu.phase === 'closing' && 'dd-menu-out',
              menu.pos?.up ? 'origin-bottom' : 'origin-top'
            )}
          >
            {/* Search */}
            <div className="flex h-[42px] flex-shrink-0 items-center gap-2 border-b border-surface-700 px-3 text-surface-500">
              <Search className="h-[15px] w-[15px]" aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('fieldPicker.searchPlaceholder', 'Search fields…')}
                aria-label={t('fieldPicker.searchAria', 'Search fields')}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-surface-50 placeholder:text-surface-500 focus:outline-none focus:ring-0"
              />
              <span className="font-mono text-[10px] text-surface-500">
                {q ? `${flat.length} of ${FIELD_CATALOG.length}` : `${FIELD_CATALOG.length} fields`}
              </span>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Group rail — hidden on narrow screens, where search + grouped list is enough */}
              <div className="hidden w-[164px] flex-shrink-0 flex-col gap-px overflow-y-auto border-r border-surface-700 p-1.5 sm:flex">
                {rail.map((g) => {
                  const on = !q && group === g.id;
                  const Icon = g.icon;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        setQuery('');
                        setGroup(g.id);
                        setActive(0);
                      }}
                      className={cn(
                        'flex h-8 items-center gap-[9px] rounded-lg px-[9px] text-left text-[12.5px] font-medium transition-colors',
                        on ? 'bg-accent-500/[0.12] text-accent-text' : 'text-surface-200 hover:bg-surface-700/50',
                        q && g.count === 0 && 'opacity-35'
                      )}
                    >
                      <Icon className={cn('h-[13px] w-[13px] flex-shrink-0', on ? 'text-accent-text' : 'text-surface-400')} aria-hidden />
                      <span className="flex-1">{g.label}</span>
                      <span className="font-mono text-[10px] text-surface-500">{g.count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Fields */}
              <div ref={listRef} role="listbox" className="min-w-0 flex-1 overflow-y-auto px-[5px] pb-[5px]">
                {sections.map((s) => {
                  const SIcon = s.icon;
                  return (
                    <div key={s.id}>
                      <div className="sticky top-0 z-[1] flex items-center gap-2 bg-surface-900 px-[7px] pb-1.5 pt-2.5">
                        <SIcon className="h-3 w-3 text-accent-text" aria-hidden />
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-surface-300">{s.label}</span>
                        {s.description && <span className="ml-auto truncate text-[11px] text-surface-500">{s.description}</span>}
                      </div>
                      {s.fields.map((f) => {
                        runningIndex += 1;
                        const idx = runningIndex;
                        const isSelected = f.id === value;
                        const isActive = idx === safeActive && !isSelected;
                        const at = q ? f.label.toLowerCase().indexOf(q) : -1;
                        const chip = f.unit ?? (f.valueType === 'list' ? t('fieldPicker.listBadge', 'list') : '');
                        return (
                          <div
                            key={`${s.id}-${f.id}`}
                            data-field-index={idx}
                            role="option"
                            aria-selected={isSelected}
                            onMouseEnter={() => setActive(idx)}
                            onClick={() => commit(f)}
                            style={{ animationDelay: `${40 + Math.min(idx, 8) * 18}ms` }}
                            className={cn(
                              'dd-row relative flex h-[34px] cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors duration-200',
                              isSelected ? 'bg-accent-500/[0.14] text-accent-text' : isActive ? 'bg-surface-700/35 text-surface-50' : 'text-surface-200'
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                'absolute bottom-2 left-0 top-2 w-[2px] rounded-sm bg-accent-500 transition-transform duration-150 ease-[cubic-bezier(.2,.8,.2,1)]',
                                isActive ? 'scale-y-100' : 'scale-y-0'
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {at >= 0 ? (
                                <>
                                  {f.label.slice(0, at)}
                                  <mark className="rounded-[3px] bg-accent-500/[0.14] text-accent-text">{f.label.slice(at, at + q.length)}</mark>
                                  {f.label.slice(at + q.length)}
                                </>
                              ) : (
                                f.label
                              )}
                            </span>
                            {chip && (
                              <span className="flex-shrink-0 rounded-[5px] border border-surface-700 px-1.5 py-0.5 font-mono text-[10px] text-surface-400">
                                {chip}
                              </span>
                            )}
                            {isSelected && <DrawnCheck className="h-3.5 w-3.5" />}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {flat.length === 0 && (
                  <div className="px-2.5 py-7 text-center text-[12.5px] text-surface-400">
                    {t('fieldPicker.noFields', 'No fields matching "{{query}}"', { query })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer: preview + hints */}
            <div className="flex flex-shrink-0 flex-col gap-1.5 border-t border-surface-700 bg-surface-800/50 px-3 py-[9px]">
              {activeField && activeOp && (
                <div className="flex flex-wrap items-baseline gap-1.5 text-[12.5px] text-surface-300">
                  <span className="mr-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-surface-500">
                    {t('fieldPicker.readsAs', 'Reads as')}
                  </span>
                  <span className="font-medium text-surface-50">{activeField.label}</span>
                  <span className="text-accent-text">{OPERATOR_LABELS[activeOp]}</span>
                  <span className="font-mono text-xs text-surface-100">{previewValue(activeField)}</span>
                </div>
              )}
              <div className="hidden gap-3 font-mono text-[10.5px] text-surface-500 sm:flex">
                <span>↑↓ {t('fieldPicker.navigate', 'navigate')}</span>
                <span>←→ {t('fieldPicker.group', 'group')}</span>
                <span>↵ {t('fieldPicker.select', 'select')}</span>
                <span>esc {t('fieldPicker.close', 'close')}</span>
                {activeField && (
                  <span className="ml-auto">
                    {FIELD_GROUPS.find((g) => g.id === activeField.group)?.label} · {VALUE_TYPE_LABEL[activeField.valueType]}
                  </span>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
