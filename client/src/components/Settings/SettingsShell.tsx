import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import {
  useHealthStatus,
  useSaveSettings,
  useSettings,
  useTestConnection,
  useUnraidStats,
} from '@/hooks/useApi';
import { useToast } from '@/components/common/Toast';
import { Button } from '@/components/common/Button';
import { cn } from '@/lib/utils';
import type { MediaServerType, Settings as SettingsType } from '@/types';

import { SETTINGS_NAV, matchesQuery, type NavCategory } from './settingsNav';
import { useSettingsDraft } from './useSettingsDraft';
import type { ActiveMediaServer, CategoryId, PanelProps, ServiceKeyType, TestResult } from './types';
import { StatusDot, type StatusDotState } from './components/StatusDot';

const MEDIA_SERVER_NAMES: Record<MediaServerType, string> = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
};

/** Jellyfin and Emby share one settings namespace; Plex has its own. */
function configKeyFor(type: MediaServerType): 'plex' | 'jellyfin' {
  return type === 'plex' ? 'plex' : 'jellyfin';
}

function isConfigured(service: { url?: string; apiKey?: string; token?: string } | undefined): boolean {
  if (!service?.url) return false;
  return Boolean(service.token || service.apiKey);
}

/**
 * Whether the desktop rail layout applies. Used to mount exactly one panel
 * tree: rendering both and hiding one with a breakpoint class would register
 * every section, saver and data fetch twice, and the hidden copy — which has no
 * layout — would win the section registry.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export interface SettingsPanelRegistry {
  render: (id: CategoryId, props: PanelProps) => React.ReactNode;
}

export function SettingsShell({ panels }: { panels: SettingsPanelRegistry }) {
  const { t } = useTranslation('settings');
  const { addToast } = useToast();
  const reduceMotion = useReducedMotion();
  const isDesktop = useIsDesktop();

  const { data: saved, refetch } = useSettings();
  const saveMutation = useSaveSettings();
  const testMutation = useTestConnection();

  const { data: health } = useHealthStatus();
  const { data: unraid } = useUnraidStats();

  const { draft, dirtyCount, set, setService, discard, markSaved } = useSettingsDraft(saved);

  // --- navigation -----------------------------------------------------------

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const sectionParam = searchParams.get('section') as CategoryId | null;
  const validSection = sectionParam && SETTINGS_NAV.some((c) => c.id === sectionParam) ? sectionParam : null;
  const activeCategory: CategoryId = validSection ?? 'connections';

  const [query, setQuery] = useState('');
  // Mobile master/detail is driven by the URL rather than local state, so the
  // browser's back gesture leaves a category exactly like the on-screen arrow
  // does. A link to /settings?section=alerts still lands on that section.
  const mobileDetail: CategoryId | null = validSection;
  const searchRef = useRef<HTMLInputElement>(null);
  // Both panels can be mounted at once (the other hidden by a breakpoint class),
  // so they get their own refs and the visible one wins.
  const desktopPanelRef = useRef<HTMLDivElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const sectionNodes = useRef<Map<string, HTMLElement>>(new Map());
  /** Timestamp until which scroll events must not override an explicit click. */
  const suppressSpyUntil = useRef(0);

  const getPanel = useCallback((): HTMLDivElement | null => {
    const desktop = desktopPanelRef.current;
    if (desktop && desktop.clientHeight > 0) return desktop;
    const mobile = mobilePanelRef.current;
    if (mobile && mobile.clientHeight > 0) return mobile;
    return desktop ?? mobile;
  }, []);

  const setActiveCategory = useCallback(
    (id: CategoryId, { push = false }: { push?: boolean } = {}) => {
      // Desktop replaces: the rail is always visible, so every category click
      // would otherwise pile up a history entry that goes nowhere visible.
      // Mobile pushes, because opening a category is a real navigation — and
      // the marker on that entry is how the back arrow knows it can pop.
      setSearchParams(
        { section: id },
        push ? { state: { fromSettingsList: true } } : { replace: true }
      );
      // Category switch is instant and lands at the top of the new panel.
      const panel = getPanel();
      if (panel) panel.scrollTop = 0;
    },
    [getPanel, setSearchParams]
  );

  /**
   * Leave a mobile category. Pops the history entry we pushed on the way in so
   * the back arrow and the hardware back button do the same thing; when the
   * category was deep-linked there is no entry of ours to pop, so the param is
   * dropped in place instead of throwing the user out of the app.
   */
  const closeMobileDetail = useCallback(() => {
    const pushedByUs = (location.state as { fromSettingsList?: boolean } | null)?.fromSettingsList;
    if (pushedByUs) navigate(-1);
    else setSearchParams({}, { replace: true });
  }, [location.state, navigate, setSearchParams]);

  // Bumped whenever a panel mounts or unmounts its sections, so the scrollspy
  // and any pending jump re-run against the new set of nodes.
  const [sectionVersion, setSectionVersion] = useState(0);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<CategoryId | null>(null);

  const registerSection = useCallback((id: string, node: HTMLElement | null) => {
    if (node) sectionNodes.current.set(id, node);
    else sectionNodes.current.delete(id);
    setSectionVersion((v) => v + 1);
  }, []);

  const scrollToSection = useCallback(
    (id: string) => {
      const node = sectionNodes.current.get(id);
      const panel = getPanel();
      if (!node || !panel) return false;

      // Deliberately not scrollIntoView: that scrolls the whole page, not the panel.
      suppressSpyUntil.current = Date.now() + (reduceMotion ? 100 : 700);
      panel.scrollTo({ top: node.offsetTop - 16, behavior: reduceMotion ? 'auto' : 'smooth' });
      setActiveSection(id);

      // If the section was already on screen the scroll is a no-op, so flash it
      // — otherwise clicking a visible sub-item looks like nothing happened.
      node.classList.remove('settings-section-flash');
      // Force a reflow so re-adding the class restarts the animation.
      void node.offsetWidth;
      node.classList.add('settings-section-flash');
      window.setTimeout(() => node.classList.remove('settings-section-flash'), 1200);

      return true;
    },
    [getPanel, reduceMotion]
  );

  /**
   * Jump to a sub-section, switching category first when it belongs to another
   * one. The target panel has not mounted yet at that point, so the scroll is
   * deferred until its sections register.
   */
  const goToSection = useCallback(
    (categoryId: CategoryId, sectionId: string) => {
      if (categoryId === activeCategory) {
        scrollToSection(sectionId);
        return;
      }
      setActiveCategory(categoryId);
      setPendingSection(sectionId);
    },
    [activeCategory, scrollToSection, setActiveCategory]
  );

  useEffect(() => {
    if (!pendingSection) return;
    if (scrollToSection(pendingSection)) setPendingSection(null);
  }, [pendingSection, scrollToSection, sectionVersion]);

  // Opening a category starts you at its first sub-section, so the rail always
  // marks something rather than nothing.
  useEffect(() => {
    if (pendingSection) return;
    const first = SETTINGS_NAV.find((c) => c.id === activeCategory)?.subItems[0]?.id;
    if (first) setActiveSection(first);
  }, [activeCategory, pendingSection]);

  /**
   * Scrollspy: whichever section's top has most recently passed the top of the
   * panel is the one you are reading, so that is the one the rail highlights.
   */
  useEffect(() => {
    const panel = getPanel();
    if (!panel) return;

    let frame = 0;

    const update = () => {
      frame = 0;

      // A click is an explicit statement of where you are. Smooth scrolling
      // would otherwise drag the highlight through every section on the way.
      if (Date.now() < suppressSpyUntil.current) return;

      const nodes = [...sectionNodes.current.entries()].sort(
        (a, b) => a[1].offsetTop - b[1].offsetTop
      );
      if (nodes.length === 0) return;

      // Before layout settles every offsetTop reads 0, which would make the
      // loop below fall through to the last section.
      if (nodes.length > 1 && nodes.every(([, node]) => node.offsetTop === 0)) return;

      // When the panel barely scrolls, most sections are on screen at once and
      // no probe can single one out — it would just flip between the first and
      // last. Leave the highlight where the user last put it.
      const maxScroll = panel.scrollHeight - panel.clientHeight;
      if (maxScroll < 80) return;

      // Probe a band a third of the way down rather than the very top edge.
      // Probing the edge makes short panels — where the whole scroll range is
      // less than one screen — read as nothing but the first or last section.
      const probe = panel.scrollTop + panel.clientHeight * 0.3;

      let current = nodes[0]![0];
      for (const [id, node] of nodes) {
        if (node.offsetTop <= probe) current = id;
      }

      // At the very bottom, pin to the last section: a short trailing section
      // can sit entirely below the probe and would never be reachable.
      if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) {
        current = nodes[nodes.length - 1]![0];
      }

      setActiveSection(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    panel.addEventListener('scroll', onScroll, { passive: true });
    update();

    return () => {
      panel.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [activeCategory, getPanel, sectionVersion, mobileDetail]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const translate = useCallback((key: string, fallback: string) => t(key, fallback), [t]);

  const visibleCategories = useMemo(
    () => SETTINGS_NAV.filter((category) => matchesQuery(category, query, translate)),
    [query, translate]
  );

  // --- panel-owned save steps ----------------------------------------------

  const savers = useRef<Map<string, () => Promise<void>>>(new Map());
  const [externalDirty, setExternalDirtyState] = useState<Record<string, boolean>>({});

  const registerSaver = useCallback((id: string, save: (() => Promise<void>) | null) => {
    if (save) savers.current.set(id, save);
    else savers.current.delete(id);
  }, []);

  const setExternalDirty = useCallback((id: string, dirty: boolean) => {
    setExternalDirtyState((current) => {
      if (Boolean(current[id]) === dirty) return current;
      return { ...current, [id]: dirty };
    });
  }, []);

  const externalDirtyCount = useMemo(
    () => Object.values(externalDirty).filter(Boolean).length,
    [externalDirty]
  );
  const totalDirty = dirtyCount + externalDirtyCount;

  // --- media server + first run --------------------------------------------

  const mediaServer: ActiveMediaServer = useMemo(() => {
    const type: MediaServerType = draft.mediaServerType ?? 'plex';
    return { type, name: MEDIA_SERVER_NAMES[type], configKey: configKeyFor(type) };
  }, [draft.mediaServerType]);

  const fresh = useMemo(() => {
    const services = draft.services ?? {};
    return !Object.values(services).some((service) => isConfigured(service));
  }, [draft.services]);

  // --- connection testing ---------------------------------------------------

  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const runTest = useCallback(
    async (service: ServiceKeyType) => {
      setTestResults((prev) => ({ ...prev, [service]: { status: 'loading' } }));
      const config = draft.services?.[service];

      if (!config) {
        setTestResults((prev) => ({
          ...prev,
          [service]: { status: 'error', message: t('services.test.noConfig', 'No configuration found') },
        }));
        return;
      }

      // Jellyfin and Emby share a namespace but speak different dialects, so the
      // server is told which one to test as.
      const testAs = service === 'jellyfin' ? mediaServer.type : service;

      try {
        await testMutation.mutateAsync({ service: testAs, config });
        setTestResults((prev) => ({
          ...prev,
          [service]: { status: 'success', message: t('services.test.connectedSuccess', 'Connected successfully') },
        }));
      } catch (error) {
        setTestResults((prev) => ({
          ...prev,
          [service]: {
            status: 'error',
            message: error instanceof Error ? error.message : t('services.test.connectionFailed', 'Connection failed'),
          },
        }));
      }
    },
    [draft.services, mediaServer.type, t, testMutation]
  );

  // --- saving ---------------------------------------------------------------

  const handleSave = useCallback(async () => {
    try {
      // Panel-owned endpoints first, so a failure there does not leave the main
      // payload saved and the rest silently dropped.
      for (const save of savers.current.values()) {
        await save();
      }

      await saveMutation.mutateAsync(draft as SettingsType);

      markSaved();
      setExternalDirtyState({});
      await refetch();

      addToast({
        type: 'success',
        title: t('toasts.savedTitle', 'Settings saved'),
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: t('toasts.failedSaveTitle', 'Failed to save'),
        message: error instanceof Error ? error.message : undefined,
      });
    }
  }, [addToast, draft, markSaved, refetch, saveMutation, t]);

  const handleDiscard = useCallback(() => {
    discard();
    setExternalDirtyState({});
  }, [discard]);

  // --- status chips ---------------------------------------------------------

  const servicesUp = health?.services?.filter((s) => s.connected).length ?? 0;
  const servicesConfigured = health?.services?.filter((s) => s.configured).length ?? 0;
  const allUp = servicesConfigured > 0 && servicesUp === servicesConfigured;
  const freePercent =
    unraid?.configured && unraid.usedPercent !== undefined ? 100 - unraid.usedPercent : undefined;
  const nextScan = health?.scheduler?.nextRun;

  const panelProps: PanelProps = {
    draft,
    onChange: set,
    onServiceChange: setService,
    fresh,
    mediaServer,
    testResults,
    runTest,
    registerSection,
    registerSaver,
    setExternalDirty,
  };

  const categoryDotState = useCallback(
    (category: NavCategory): StatusDotState => {
      if (fresh) return category.id === 'connections' ? 'required-unset' : 'optional-unset';
      if (category.id === 'connections' && servicesConfigured > servicesUp) return 'failed';
      return 'healthy';
    },
    [fresh, servicesConfigured, servicesUp]
  );

  const activeNav = SETTINGS_NAV.find((c) => c.id === activeCategory) ?? SETTINGS_NAV[0]!;

  /** One-line state under each mobile category row, from real data. */
  const categorySummary = useCallback(
    (id: CategoryId): string => {
      switch (id) {
        case 'connections':
          return fresh
            ? t('summary.connectionsFresh', '{{name}} not connected', { name: mediaServer.name })
            : t('summary.connections', '{{up}} of {{total}} connected', {
                up: servicesUp,
                total: servicesConfigured,
              });
        case 'automation':
          return draft.schedule?.enabled
            ? t('summary.automationOn', 'Daily scan at {{time}}', { time: draft.schedule.time ?? '03:00' })
            : t('summary.automationOff', 'Scanning off');
        case 'safety':
          return t('summary.safety', '{{count}} libraries excluded', {
            count: draft.excludedLibraryKeys?.length ?? 0,
          });
        case 'alerts':
          return draft.notifications?.discordEnabled
            ? t('summary.alertsOn', 'Discord enabled')
            : t('summary.alertsOff', 'No alerts configured');
        case 'interface':
          return t('summary.interface', 'Dates, times and units');
        case 'system':
          return t('summary.system', 'API key and backups');
      }
    },
    [draft, fresh, mediaServer.name, servicesConfigured, servicesUp, t]
  );

  return (
    // Layout renders /settings full-bleed with overflow-hidden, so h-full gives
    // a definite height here. That is what makes the panel — not the window —
    // the scroll container, keeping the rail in place and making the sub-item
    // jump (panel.scrollTop) meaningful.
    <div className="flex h-full flex-col">
      {/* ---------------- header ---------------- */}
      {/* Inside a mobile category the detail bar below carries the title, so the
          page header would be a second heading eating a third of the viewport. */}
      {(isDesktop || mobileDetail === null) && (
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-surface-700/60 px-4 pb-3.5 pt-4 lg:px-8 lg:pb-4 lg:pt-6">
        <div>
          <p className="mb-1 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-text lg:mb-1.5">
            {t('header.eyebrow', 'Configuration')}
          </p>
          <h1 className="font-display text-[23px] font-bold tracking-[-0.02em] text-surface-50 lg:text-[27px]">
            {t('header.title', 'Settings')}
          </h1>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <StatusChip
            tone={fresh ? 'amber' : allUp ? 'emerald' : 'ruby'}
            dot={fresh || !allUp}
            label={
              fresh
                ? t('chips.noServices', 'No services connected')
                : t('chips.servicesUp', '{{up}} of {{total}} services up', {
                    up: servicesUp,
                    total: servicesConfigured,
                  })
            }
          />
          <StatusChip
            tone="neutral"
            label={
              nextScan
                ? t('chips.nextScan', 'Next scan {{when}}', { when: formatRelative(nextScan) })
                : t('chips.scanningOff', 'Scanning off')
            }
          />
          <StatusChip
            tone={freePercent === undefined ? 'neutral' : 'amber'}
            label={
              freePercent === undefined
                ? t('chips.freeUnknown', 'Free space unknown')
                : t('chips.freeSpace', 'Free space {{percent}}%', { percent: Math.round(freePercent) })
            }
          />
        </div>
      </header>
      )}

      {/* ---------------- desktop: rail + panel ---------------- */}
      {isDesktop && (
      <div className="relative flex min-h-0 flex-1">
        <nav
          aria-label={t('nav.ariaLabel', 'Settings categories')}
          className="flex w-[244px] shrink-0 flex-col gap-3.5 border-r border-surface-700/60 px-3.5 py-4"
        >
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-500"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('search.placeholder', 'Search settings…')}
              aria-label={t('search.placeholder', 'Search settings…')}
              className={cn(
                'w-full rounded-[11px] border border-surface-600/60 bg-surface-800/70 py-2.5 pl-8 pr-11',
                'font-sans text-[13px] text-surface-100 placeholder:text-surface-500',
                'focus:border-accent-500/50 focus:bg-surface-800/95 focus:outline-none'
              )}
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-[5px] border border-surface-600/70 px-1 font-mono text-[10px] text-surface-500">
              ⌘K
            </kbd>
          </div>

          <div className="flex flex-col gap-0.5">
            {visibleCategories.map((category) => {
              const isActive = category.id === activeCategory;
              const isPeeking = !isActive && hoveredCategory === category.id;
              // The active category keeps its list open; hovering a collapsed one
              // peeks at what is inside without navigating away.
              const showSubItems = isActive || isPeeking;

              return (
                <div
                  key={category.id}
                  className="relative"
                  onMouseEnter={() => setHoveredCategory(category.id)}
                  onMouseLeave={() =>
                    setHoveredCategory((current) => (current === category.id ? null : current))
                  }
                  // Keyboard users get the same peek when they tab onto the category.
                  onFocusCapture={() => setHoveredCategory(category.id)}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setHoveredCategory((current) => (current === category.id ? null : current));
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setActiveCategory(category.id)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-expanded={showSubItems}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[11px] border px-3 py-2.5',
                      'font-sans text-[13.5px] font-medium transition-colors',
                      isActive
                        ? 'border-accent-500/[0.22] bg-accent-500/10 text-accent-text'
                        : 'border-transparent text-surface-400 hover:bg-surface-800/70 hover:text-surface-200'
                    )}
                  >
                    <StatusDot state={categoryDotState(category)} />
                    <span className="flex-1 text-left">{t(category.labelKey, category.fallback)}</span>
                    {!isActive && (
                      <span
                        className={cn(
                          'font-mono text-[11px] transition-colors',
                          isPeeking ? 'text-accent-text/70' : 'text-surface-500'
                        )}
                      >
                        {category.subItems.length}
                      </span>
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {showSubItems && (
                      <motion.ul
                        // The active category's list is inline and expected. A hover
                        // peek floats beside the rail instead: expanding in place
                        // would push the categories below it out from under the
                        // cursor you were about to click with.
                        initial={
                          reduceMotion
                            ? false
                            : isPeeking
                              ? { opacity: 0, x: -4 }
                              : { height: 0, opacity: 0 }
                        }
                        animate={isPeeking ? { opacity: 1, x: 0 } : { height: 'auto', opacity: 1 }}
                        exit={
                          reduceMotion
                            ? { opacity: 0 }
                            : isPeeking
                              ? { opacity: 0, x: -4 }
                              : { height: 0, opacity: 0 }
                        }
                        transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
                        className={cn(
                          'flex flex-col gap-0.5',
                          isPeeking
                            ? // Floats over the panel, so it needs its own surface.
                              // The ::before bridge spans the gap back to the rail so
                              // the pointer can cross without the peek closing.
                              cn(
                                'absolute left-full top-0 z-30 ml-2 w-[210px] rounded-xl p-1.5',
                                'border border-surface-700 bg-surface-900/95 backdrop-blur-sm',
                                'shadow-[0_10px_30px_rgba(0,0,0,0.45)]',
                                'before:absolute before:-left-2 before:top-0 before:h-full before:w-2 before:content-[""]'
                              )
                            : 'relative ml-[19px] mt-1 overflow-hidden pl-[11px]'
                        )}
                      >
                        {category.subItems.map((item) => {
                          const isCurrent = isActive && activeSection === item.id;

                          return (
                            <li
                              key={item.id}
                              className={cn(
                                // The connector is drawn per row and stops at the
                                // first and last row's own centre, so it stays
                                // aligned even when a long label wraps to two
                                // lines and the rows are no longer uniform.
                                !isPeeking && [
                                  'relative before:absolute before:left-[-11px] before:w-px',
                                  'before:bg-surface-600/60 before:content-[""]',
                                  'before:top-0 before:bottom-0',
                                  'first:before:top-1/2 last:before:bottom-1/2',
                                ]
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => goToSection(category.id, item.id)}
                                aria-current={isCurrent ? 'true' : undefined}
                                className={cn(
                                  'relative w-full rounded-lg px-2 py-1.5 text-left font-sans text-[12.5px]',
                                  'transition-colors duration-150',
                                  isCurrent
                                    ? 'bg-accent-500/[0.14] font-semibold text-accent-text'
                                    : 'text-surface-400 hover:bg-surface-800/60 hover:text-surface-200',
                                  // A peeked list is a preview, so it sits back visually.
                                  isPeeking && 'text-surface-500'
                                )}
                              >
                                {isCurrent && (
                                  // Statically positioned, and centred on the 1px
                                  // connector at -11px: a layout-animated marker
                                  // settles a couple of pixels off the line, which
                                  // reads as a jog in the rail.
                                  <span
                                    className="absolute -left-[12px] top-1/2 h-[18px] w-[3px] -translate-y-1/2 rounded-full bg-accent-500"
                                    aria-hidden
                                  />
                                )}
                                {t(item.labelKey, item.fallback)}
                              </button>
                            </li>
                          );
                        })}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {visibleCategories.length === 0 && (
              <p className="px-1 py-2 text-xs text-surface-400">
                {t('search.noResults', 'Nothing matches “{{query}}”. Try “webhook”, “grace”, “api key”.', {
                  query,
                })}
              </p>
            )}
          </div>

          <p className="mt-auto rounded-xl border border-surface-700/80 bg-surface-800/50 px-3.5 py-3 text-[11.5px] text-surface-300">
            {t('footnote.staged', 'Edits are staged locally — nothing is written until you save.')}
          </p>
        </nav>

        <motion.div
          key={activeCategory}
          ref={desktopPanelRef}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-8 pb-[92px] pt-[22px]"
        >
          {panels.render(activeCategory, panelProps)}
        </motion.div>

        {totalDirty > 0 && (
          <SavePill
            count={totalDirty}
            saving={saveMutation.isPending}
            onSave={handleSave}
            onDiscard={handleDiscard}
          />
        )}
      </div>
      )}

      {/* ---------------- mobile: list → detail ---------------- */}
      {!isDesktop && (
      <div className="flex min-h-0 flex-1 flex-col">
        {mobileDetail === null ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('search.placeholder', 'Search settings…')}
                aria-label={t('search.placeholder', 'Search settings…')}
                className="min-h-[46px] w-full rounded-xl border border-surface-600/60 bg-surface-800/70 pl-9 pr-3 text-[15px] text-surface-100 placeholder:text-surface-500 focus:border-accent-500/50 focus:outline-none"
              />
            </div>

            {visibleCategories.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(category.id, { push: true })}
                  className="flex min-h-[64px] items-center gap-3 rounded-[14px] border border-surface-700/90 bg-surface-900/90 px-4 py-3.5 text-left active:bg-surface-700/70"
                >
                  <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent-500/10">
                    <Icon className="h-4 w-4 text-accent-text" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[15px] font-semibold text-surface-50">
                      {t(category.labelKey, category.fallback)}
                    </span>
                    <span className="block text-xs leading-snug text-surface-400">
                      {categorySummary(category.id)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-surface-500" aria-hidden />
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b border-surface-700/70 px-2 py-2">
              <button
                type="button"
                onClick={closeMobileDetail}
                aria-label={t('common.back', 'Back')}
                className="-ml-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-accent-text active:bg-surface-800"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <div className="min-w-0 flex-1">
                <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-500">
                  {t('header.title', 'Settings')}
                </p>
                <h2 className="truncate font-display text-[19px] font-bold leading-tight text-surface-50">
                  {t(activeNav.labelKey, activeNav.fallback)}
                </h2>
              </div>
            </div>

            <div
              ref={mobilePanelRef}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
            >
              {panels.render(activeCategory, panelProps)}
            </div>
          </>
        )}

        {/* Matches the desktop pill: the bar appears only once there is
            something to save, instead of parking a dead button on top of the
            panel on every screen. It sits outside the list/detail switch
            because the draft survives going back to the list, and unsaved
            edits should not be reachable only from the category you made
            them in. */}
        {totalDirty > 0 && (
          <div className="flex gap-2.5 border-t border-surface-700/70 bg-surface-900/95 px-4 pb-4 pt-3">
            <Button
              variant="secondary"
              className="min-h-[48px] flex-1 text-[15px]"
              onClick={handleDiscard}
            >
              {t('savePill.discard', 'Discard')}
            </Button>
            <Button
              className="min-h-[48px] flex-[1.4] text-[15px]"
              onClick={handleSave}
              isLoading={saveMutation.isPending}
            >
              {t('savePill.saveCount', 'Save {{count}} changes', { count: totalDirty })}
            </Button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function StatusChip({
  label,
  tone,
  dot = false,
}: {
  label: string;
  tone: 'emerald' | 'ruby' | 'amber' | 'neutral';
  dot?: boolean;
}) {
  const tones = {
    emerald: 'bg-emerald-500/[0.08] border-emerald-500/[0.22] text-emerald-400',
    ruby: 'bg-ruby-500/[0.08] border-ruby-500/[0.22] text-ruby-400',
    amber: 'bg-accent-500/[0.08] border-accent-500/[0.22] text-accent-text',
    neutral: 'bg-surface-700/50 border-surface-600/60 text-surface-300',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-[7px] text-xs',
        tones[tone]
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {label}
    </span>
  );
}

function SavePill({
  count,
  saving,
  onSave,
  onDiscard,
}: {
  count: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation('settings');

  return (
    <div className="absolute bottom-[22px] right-7 flex items-center gap-3 rounded-[14px] border border-surface-600/80 bg-surface-950/95 py-2.5 pl-[18px] pr-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
      <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
      <span className="text-[12.5px] text-surface-300">
        {t('savePill.unsaved', '{{count}} unsaved changes', { count })}
      </span>
      <button
        type="button"
        onClick={onDiscard}
        className="rounded-[10px] px-2.5 py-1.5 text-[12.5px] font-semibold text-surface-300 transition-colors hover:text-surface-50"
      >
        {t('savePill.discard', 'Discard')}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-[10px] bg-gradient-to-r from-accent-500 to-accent-600 px-3.5 py-1.5 text-[12.5px] font-bold text-amber-950 disabled:opacity-70"
      >
        {saving ? t('savePill.saving', 'Saving…') : t('savePill.save', 'Save changes')}
      </button>
    </div>
  );
}

/** Compact "in 4h 12m" style relative time for the next-scan chip. */
function formatRelative(iso: string): string {
  const target = new Date(iso).getTime();
  const diffMinutes = Math.max(0, Math.round((target - Date.now()) / 60000));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
}
