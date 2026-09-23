import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { TypewriterLabel } from './TypewriterLabel';
import { prefersReducedMotion, useFloatingMenu } from './useFloatingMenu';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Second line under the label (e.g. deletion action explanations). */
  description?: string;
  /** Small emerald pill on the right (e.g. "Protected"). */
  badge?: string;
  /** Short mono code on the left (e.g. language "EN"). */
  code?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface DropdownProps<T extends string> {
  value: T | null;
  options: Array<DropdownOption<T>>;
  onChange: (value: T) => void;
  /** Trigger id, for an external `<label htmlFor>`. Generated when omitted. */
  id?: string;
  /** Visible label above the trigger (Settings / form style). */
  label?: string;
  /** Required when there is no visible label. */
  ariaLabel?: string;
  placeholder?: string;
  /**
   * 'input'   — page filter bars; matches `.input` / `.select` (44px, rounded-xl, 16px).
   * 'control' — Settings + Rules; matches `controlClass` (11px radius, 13px, 44px → 38px at lg).
   */
  size?: 'input' | 'control';
  /** Search box at the top of the menu. Use for long / dynamic lists. */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Which trigger edge the menu lines up with. */
  align?: 'start' | 'end';
  /** Menu exactly as wide as the trigger (form fields). Default: at least trigger width, grows to content. */
  matchWidth?: boolean;
  /** Mono font for trigger + rows (enum values like 720p). */
  mono?: boolean;
  icon?: ReactNode;
  error?: string;
  disabled?: boolean;
  /** Applied to the trigger. Use for width (e.g. `w-full`, `w-[200px]`). */
  className?: string;
  menuClassName?: string;
  /** Applied to the outer wrapper (label + trigger + error). E.g. `inline-flex` inside a sentence. */
  wrapperClassName?: string;
}

const COMMIT_MS = 160; // lets the check draw before the menu closes

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  id: idProp,
  label,
  ariaLabel,
  placeholder: placeholderProp,
  size = 'control',
  searchable = false,
  searchPlaceholder: searchPlaceholderProp,
  emptyText: emptyTextProp,
  align = 'start',
  matchWidth = false,
  mono = false,
  icon,
  error,
  disabled,
  className,
  menuClassName,
  wrapperClassName,
}: DropdownProps<T>) {
  const { t } = useTranslation('common');
  const placeholder = placeholderProp ?? t('dropdown.placeholder', 'Select…');
  const searchPlaceholder = searchPlaceholderProp ?? t('dropdown.search', 'Search…');
  const emptyText = emptyTextProp ?? t('dropdown.noMatches', 'No matches');
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const listboxId = `${id}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout>>();
  const typeahead = useRef<{ text: string; timer?: ReturnType<typeof setTimeout> }>({ text: '' });

  const menu = useFloatingMenu({ triggerRef, menuRef, align });
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState('');
  // The trigger label lags behind `value` until the menu closes, then types in.
  const [shown, setShown] = useState<T | null>(value);
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (menu.phase === 'closed') setShown(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? options.filter(
            (o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q)
          )
        : options,
    [options, q]
  );

  const shownOption = options.find((o) => o.value === shown) ?? null;
  const reserve = useMemo(() => [placeholder, ...options.map((o) => o.label)], [options, placeholder]);

  const step = (from: number, dir: 1 | -1) => {
    const n = visible.length;
    for (let i = 1; i <= n; i++) {
      const idx = (from + dir * i + n) % n;
      if (!visible[idx].disabled) return idx;
    }
    return from;
  };

  const openMenu = () => {
    if (disabled) return;
    setQuery('');
    const sel = options.findIndex((o) => o.value === value);
    setActive(sel >= 0 ? sel : step(-1, 1));
    haptic();
    menu.open();
  };

  const commit = (opt: DropdownOption<T> | undefined) => {
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    haptic();
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(
      () => {
        menu.close();
        setShown(opt.value);
        setPlayKey((k) => k + 1);
      },
      prefersReducedMotion() ? 0 : COMMIT_MS
    );
  };

  // Focus the search box on open so arrow keys work immediately.
  useEffect(() => {
    if (menu.isOpen && searchable) searchRef.current?.focus({ preventScroll: true });
  }, [menu.isOpen, searchable]);

  // Re-place when filtering changes the menu height (flip logic depends on it).
  useEffect(() => {
    if (menu.mounted) menu.place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length]);

  // Keep the active row in view.
  useEffect(() => {
    if (!menu.isOpen || active < 0) return;
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !el) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - 5;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 5;
  }, [active, menu.isOpen]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const fromSearch = e.currentTarget === searchRef.current;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!menu.isOpen) return openMenu();
        if (visible.length) setActive((a) => step(a, e.key === 'ArrowDown' ? 1 : -1));
        return;
      case 'Home':
      case 'End':
        if (!menu.isOpen || fromSearch) return;
        e.preventDefault();
        setActive(e.key === 'Home' ? step(-1, 1) : step(visible.length, -1));
        return;
      case 'Enter':
        e.preventDefault();
        if (menu.isOpen) commit(visible[active]);
        else openMenu();
        return;
      case ' ':
        if (fromSearch) return;
        e.preventDefault();
        if (menu.isOpen) commit(visible[active]);
        else openMenu();
        return;
      case 'Escape':
        if (menu.isOpen) {
          e.preventDefault();
          e.stopPropagation(); // don't also close a parent modal
          menu.close();
        }
        return;
      case 'Tab':
        if (menu.isOpen) menu.close(false);
        return;
      default:
        if (searchable || fromSearch) return;
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const ta = typeahead.current;
          clearTimeout(ta.timer);
          ta.text += e.key.toLowerCase();
          ta.timer = setTimeout(() => (ta.text = ''), 500);
          const start = menu.isOpen ? active : options.findIndex((o) => o.value === value);
          const n = visible.length;
          for (let i = 1; i <= n; i++) {
            const idx = (start + i + n) % n;
            const o = visible[idx];
            if (!o.disabled && o.label.toLowerCase().startsWith(ta.text)) {
              if (menu.isOpen) setActive(idx);
              else commit(o);
              break;
            }
          }
        }
    }
  };

  const isInput = size === 'input';
  const hasDescriptions = options.some((o) => o.description);

  return (
    <div className={cn('flex flex-col', label && 'gap-1.5', wrapperClassName)}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-surface-200">
          {label}
        </label>
      )}

      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={menu.isOpen}
        aria-controls={menu.mounted ? listboxId : undefined}
        aria-activedescendant={menu.isOpen && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={!!error || undefined}
        disabled={disabled}
        onClick={() => (menu.isOpen ? menu.close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'inline-flex max-w-full items-center gap-2.5 border text-left text-surface-100',
          'transition-[border-color,box-shadow,background-color,transform] duration-150 active:scale-[0.98]',
          'focus:outline-none focus-visible:border-accent-500/50 focus-visible:ring-[3px] focus-visible:ring-accent-500/[0.12]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          isInput
            ? 'min-h-[44px] rounded-xl bg-surface-800/60 pl-4 pr-3 text-base'
            : 'min-h-[44px] rounded-[11px] bg-surface-800/70 pl-3 pr-2.5 text-[13px] lg:min-h-[38px]',
          mono && 'font-mono text-[12.5px]',
          menu.isOpen
            ? 'border-accent-500/50 bg-surface-800/80 ring-[3px] ring-accent-500/[0.12]'
            : error
              ? 'border-ruby-500/50'
              : isInput
                ? 'border-surface-600/50 hover:border-surface-500/60'
                : 'border-surface-600/60 hover:border-surface-500/60',
          className
        )}
      >
        {icon && <span className="flex-shrink-0 text-surface-400">{icon}</span>}
        <span className={cn('min-w-0 flex-1', !shownOption && 'text-surface-500')}>
          <TypewriterLabel text={shownOption?.label ?? placeholder} reserve={reserve} playKey={playKey} />
        </span>
        <ChevronDown
          aria-hidden
          className={cn('dd-chevron h-[17px] w-[17px] flex-shrink-0 text-surface-400', menu.isOpen && 'rotate-180')}
        />
      </button>

      {menu.mounted &&
        createPortal(
          <div
            ref={menuRef}
            // Keeps focus on the trigger / search box when clicking rows, so the
            // keyboard keeps working after mouse use.
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
            }}
            style={{
              position: 'fixed',
              top: pos(menu.pos).top,
              left: pos(menu.pos).left,
              minWidth: menu.pos?.minWidth,
              width: matchWidth || hasDescriptions ? menu.pos?.minWidth : undefined,
              visibility: menu.pos ? 'visible' : 'hidden',
            }}
            className={cn(
              'dd-menu z-[60] flex max-w-[min(360px,calc(100vw-16px))] flex-col overflow-hidden rounded-[14px]',
              'border border-surface-700 bg-surface-900',
              'shadow-[0_18px_40px_-12px_rgba(15,23,42,0.25)] dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.75),0_0_0_1px_rgba(0,0,0,0.2)]',
              menu.phase === 'closing' && 'dd-menu-out',
              menu.pos?.up ? 'origin-bottom' : 'origin-top',
              menuClassName
            )}
          >
            {searchable && (
              <div className="flex h-[38px] flex-shrink-0 items-center gap-2 border-b border-surface-700 px-3 text-surface-500">
                <Search className="h-3.5 w-3.5" aria-hidden />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  aria-controls={listboxId}
                  className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-surface-50 placeholder:text-surface-500 focus:outline-none focus:ring-0"
                />
              </div>
            )}

            <div ref={listRef} id={listboxId} role="listbox" aria-labelledby={id} className="max-h-72 overflow-y-auto p-[5px]">
              {visible.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === active && !isSelected;
                return (
                  <div
                    key={opt.value}
                    id={`${id}-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled || undefined}
                    onMouseEnter={() => !opt.disabled && setActive(i)}
                    onClick={() => commit(opt)}
                    style={{ animationDelay: `${40 + Math.min(i, 8) * 22}ms` }}
                    className={cn(
                      'dd-row relative flex cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-2.5',
                      'transition-colors duration-200',
                      opt.description ? 'py-[9px]' : isInput ? 'h-[38px]' : 'h-[34px]',
                      isSelected ? 'bg-accent-500/[0.14] text-accent-text' : isActive ? 'text-surface-50' : 'text-surface-200',
                      opt.disabled && 'cursor-not-allowed opacity-40'
                    )}
                  >
                    {/* 3b hover marker — the text never moves */}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute bottom-[9px] left-0 top-[9px] w-[2px] rounded-sm bg-accent-500',
                        'transition-transform duration-150 ease-[cubic-bezier(.2,.8,.2,1)]',
                        isActive ? 'scale-y-100' : 'scale-y-0'
                      )}
                    />
                    {opt.code && (
                      <span className="w-[22px] flex-shrink-0 font-mono text-[10px] tracking-[0.04em] text-surface-500">
                        {opt.code}
                      </span>
                    )}
                    {opt.icon && <span className="flex-shrink-0">{opt.icon}</span>}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          'truncate font-medium',
                          mono ? 'font-mono text-[12.5px]' : isInput ? 'text-sm' : 'text-[13px]'
                        )}
                      >
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="text-[11.5px] leading-snug text-surface-400">{opt.description}</span>
                      )}
                    </span>
                    {opt.badge && (
                      <span className="flex-shrink-0 rounded-md border border-emerald-500/20 bg-emerald-500/15 px-[7px] py-0.5 text-[10.5px] font-medium text-emerald-text">
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && <DrawnCheck />}
                  </div>
                );
              })}
              {visible.length === 0 && (
                <div className="px-2.5 py-3.5 text-center text-[12.5px] text-surface-400">{emptyText}</div>
              )}
            </div>
          </div>,
          document.body
        )}

      {error && <p className="text-sm text-ruby-text">{error}</p>}
    </div>
  );
}

function pos(p: { top: number; left: number } | null) {
  return p ?? { top: -9999, left: -9999 };
}

/** Checkmark that draws itself on mount (stroke-dashoffset 24 → 0). */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-[15px] w-[15px] flex-shrink-0', className)}
    >
      <path d="M20 6 9 17l-5-5" className="dd-check" />
    </svg>
  );
}
