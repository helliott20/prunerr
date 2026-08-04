import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

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

export interface SettingsPanelRegistry {
  render: (id: CategoryId, props: PanelProps) => React.ReactNode;
}

export function SettingsShell({ panels }: { panels: SettingsPanelRegistry }) {
  const { t } = useTranslation('settings');
  const { addToast } = useToast();
  const reduceMotion = useReducedMotion();

  const { data: saved, refetch } = useSettings();
  const saveMutation = useSaveSettings();
  const testMutation = useTestConnection();

  const { data: health } = useHealthStatus();
  const { data: unraid } = useUnraidStats();

  const { draft, dirtyCount, set, setService, discard, markSaved } = useSettingsDraft(saved);

  // --- navigation -----------------------------------------------------------

  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section') as CategoryId | null;
  const activeCategory: CategoryId =
    sectionParam && SETTINGS_NAV.some((c) => c.id === sectionParam) ? sectionParam : 'connections';

  const [query, setQuery] = useState('');
  const [mobileDetail, setMobileDetail] = useState<CategoryId | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sectionNodes = useRef<Map<string, HTMLElement>>(new Map());

  const setActiveCategory = useCallback(
    (id: CategoryId) => {
      setSearchParams({ section: id }, { replace: true });
      // Category switch is instant and lands at the top of the new panel.
      if (panelRef.current) panelRef.current.scrollTop = 0;
    },
    [setSearchParams]
  );

  const registerSection = useCallback((id: string, node: HTMLElement | null) => {
    if (node) sectionNodes.current.set(id, node);
    else sectionNodes.current.delete(id);
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const node = sectionNodes.current.get(id);
    const panel = panelRef.current;
    if (!node || !panel) return;
    // Deliberately not scrollIntoView: that scrolls the whole page, not the panel.
    panel.scrollTop = node.offsetTop - 16;
  }, []);

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
    <div className="flex h-full flex-col">
      {/* ---------------- header ---------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-surface-700/60 px-4 pb-4 pt-6 lg:px-8">
        <div>
          <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-text">
            {t('header.eyebrow', 'Configuration')}
          </p>
          <h1 className="font-display text-[27px] font-bold tracking-[-0.02em] text-surface-50">
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

      {/* ---------------- desktop: rail + panel ---------------- */}
      <div className="relative hidden min-h-0 flex-1 lg:flex">
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

              return (
                <div key={category.id}>
                  <button
                    type="button"
                    onClick={() => setActiveCategory(category.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[11px] border px-3 py-2.5',
                      'font-sans text-[13.5px] font-medium transition-colors',
                      isActive
                        ? 'border-accent-500/[0.22] bg-accent-500/10 text-accent-text'
                        : 'border-transparent text-surface-400 hover:bg-surface-800/70'
                    )}
                  >
                    <StatusDot state={categoryDotState(category)} />
                    <span className="flex-1 text-left">{t(category.labelKey, category.fallback)}</span>
                    {!isActive && (
                      <span className="font-mono text-[11px] text-surface-500">{category.subItems.length}</span>
                    )}
                  </button>

                  {isActive && (
                    <ul className="ml-[19px] mt-1 flex flex-col gap-0.5 border-l border-surface-600/60 pl-[11px]">
                      {category.subItems.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => scrollToSection(item.id)}
                            className="w-full rounded-lg px-2 py-1.5 text-left font-sans text-[12.5px] text-surface-400 transition-colors hover:bg-surface-800/60 hover:text-surface-200"
                          >
                            {t(item.labelKey, item.fallback)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
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
          ref={panelRef}
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

      {/* ---------------- mobile: list → detail ---------------- */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        {mobileDetail === null ? (
          <div className="flex flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
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
                  onClick={() => {
                    setActiveCategory(category.id);
                    setMobileDetail(category.id);
                  }}
                  className="flex min-h-[64px] items-center gap-3 rounded-[14px] border border-surface-700/90 bg-surface-900/90 px-4 py-3.5 text-left active:bg-surface-700/70"
                >
                  <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent-500/10">
                    <Icon className="h-4 w-4 text-accent-text" aria-hidden />
                  </span>
                  <span className="flex-1">
                    <span className="block font-display text-[15px] font-semibold text-surface-50">
                      {t(category.labelKey, category.fallback)}
                    </span>
                    <span className="block text-xs text-surface-400">
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
            <div className="flex items-center gap-2 border-b border-surface-700/70 px-4 py-3">
              <button
                type="button"
                onClick={() => setMobileDetail(null)}
                aria-label={t('common.back', 'Back')}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-accent-text active:bg-surface-800"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <h2 className="font-display text-[21px] font-bold text-surface-50">
                {t(activeNav.labelKey, activeNav.fallback)}
              </h2>
            </div>

            <div ref={panelRef} className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
              {panels.render(activeCategory, panelProps)}
            </div>

            <div className="flex gap-3 border-t border-surface-700/70 bg-surface-900/95 px-4 pb-4 pt-3">
              <Button variant="secondary" className="min-h-[48px] flex-1 text-[15px]" onClick={handleDiscard}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                className="min-h-[48px] flex-[1.4] text-[15px]"
                onClick={handleSave}
                isLoading={saveMutation.isPending}
                disabled={totalDirty === 0}
              >
                {totalDirty > 0
                  ? t('savePill.saveCount', 'Save {{count}} changes', { count: totalDirty })
                  : t('savePill.save', 'Save changes')}
              </Button>
            </div>
          </>
        )}
      </div>
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
