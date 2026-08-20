import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { cn } from '@/lib/utils';
import type { MediaServerType, ServiceConnection } from '@/types';

import { MediaServerLogo } from '../components/MediaServerLogo';
import { PanelSection } from '../components/PanelSection';
import { SegmentedControl } from '../components/SegmentedControl';
import { SettingsCard } from '../components/SettingsCard';
import { StatusDot, type StatusDotState } from '../components/StatusDot';
import type {
  PanelProps,
  ServiceField,
  ServiceKeyType,
  TestResult,
  WatchHistoryProviderType,
} from '../types';

/* -------------------------------------------------------------------------- */
/* Static service metadata (ported from Settings.tsx)                          */
/* -------------------------------------------------------------------------- */

interface MediaServerMeta {
  /** Settings namespace. Jellyfin and Emby deliberately share one. */
  configKey: 'plex' | 'jellyfin';
  /** Plex authenticates with a token; Jellyfin and Emby with an API key. */
  credential: Extract<ServiceField, 'apiKey' | 'token'>;
  defaultPort: string;
  docsUrl: string;
}

const MEDIA_SERVER_META: Record<MediaServerType, MediaServerMeta> = {
  plex: {
    configKey: 'plex',
    credential: 'token',
    defaultPort: '32400',
    docsUrl: 'https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/',
  },
  jellyfin: {
    configKey: 'jellyfin',
    credential: 'apiKey',
    defaultPort: '8096',
    docsUrl: 'https://jellyfin.org/docs/general/server/api-keys/',
  },
  emby: {
    configKey: 'jellyfin',
    credential: 'apiKey',
    defaultPort: '8096',
    docsUrl: 'https://emby.media/support/articles/API-Key.html',
  },
};

const MEDIA_SERVER_ORDER: MediaServerType[] = ['plex', 'jellyfin', 'emby'];

type ServiceRole = 'required' | 'recommended' | 'optional';

interface IntegrationMeta {
  key: Extract<ServiceKeyType, 'sonarr' | 'radarr' | 'overseerr' | 'unraid'>;
  name: string;
  role: ServiceRole;
  defaultPort: string;
  docsUrl: string;
}

const INTEGRATIONS: Record<IntegrationMeta['key'], IntegrationMeta> = {
  sonarr: {
    key: 'sonarr',
    name: 'Sonarr',
    role: 'recommended',
    defaultPort: '8989',
    docsUrl: 'https://sonarr.tv',
  },
  radarr: {
    key: 'radarr',
    name: 'Radarr',
    role: 'recommended',
    defaultPort: '7878',
    docsUrl: 'https://radarr.video',
  },
  overseerr: {
    key: 'overseerr',
    name: 'Seerr',
    role: 'optional',
    defaultPort: '5055',
    docsUrl: 'https://docs.overseerr.dev',
  },
  unraid: {
    key: 'unraid',
    name: 'Unraid',
    role: 'optional',
    defaultPort: '443',
    docsUrl: 'https://docs.unraid.net',
  },
};

const WATCH_HISTORY_META: Record<
  Exclude<WatchHistoryProviderType, 'plex'>,
  { name: string; defaultPort: string }
> = {
  tautulli: { name: 'Tautulli', defaultPort: '8181' },
  tracearr: { name: 'Tracearr', defaultPort: '3004' },
};

/** Suppress password-manager autofill on credential fields. */
const noAutofill = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const;

/** Once per page load, not per mount — see the auto-test effect below. */
let autoTestRan = false;

function isConfigured(config: ServiceConnection | undefined): boolean {
  return Boolean(config?.url && (config.token || config.apiKey));
}

function isWatchHistoryProvider(value: unknown): value is WatchHistoryProviderType {
  return value === 'plex' || value === 'tautulli' || value === 'tracearr';
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

export default function ConnectionsPanel({
  draft,
  onChange,
  onServiceChange,
  fresh,
  mediaServer,
  testResults,
  runTest,
  registerSection,
  registerSaver,
}: PanelProps) {
  const { t } = useTranslation('settings');
  const services = draft.services;
  const mediaMeta = MEDIA_SERVER_META[mediaServer.type];
  const mediaConfig = services?.[mediaServer.configKey];
  const mediaServerUrlRef = useRef<HTMLInputElement>(null);

  /*
   * Switching backend invalidates the previous verdict: Jellyfin and Emby share
   * stored credentials but not a wire dialect, so a pass as one says nothing
   * about the other. The shell owns `testResults`, so rather than mutating it we
   * remember which result objects went stale and hide exactly those.
   */
  const [staleVerdicts, setStaleVerdicts] = useState<Record<string, TestResult | undefined>>({});

  const handleMediaServerTypeChange = useCallback(
    (next: MediaServerType) => {
      if (next === mediaServer.type) return;
      onChange('mediaServerType', next);
      setStaleVerdicts({ plex: testResults.plex, jellyfin: testResults.jellyfin });
    },
    [mediaServer.type, onChange, testResults.jellyfin, testResults.plex]
  );

  const rawMediaResult = testResults[mediaServer.configKey];
  const mediaResult =
    staleVerdicts[mediaServer.configKey] === rawMediaResult ? undefined : rawMediaResult;

  /* ---------------- watch history ---------------- */

  const lookbackDays = draft.schedule?.historyLookbackDays ?? 365;

  const storedProvider = draft.watchHistory?.provider;
  const watchProvider: WatchHistoryProviderType | null = useMemo(() => {
    if (isWatchHistoryProvider(storedProvider)) return storedProvider;
    // Legacy installs never stored the choice, so it is inferred exactly as the
    // previous implementation did.
    if (isConfigured(services?.tracearr)) return 'tracearr';
    if (fresh) return null;
    return 'tautulli';
  }, [fresh, services?.tracearr, storedProvider]);

  const handleWatchProviderChange = useCallback(
    (next: WatchHistoryProviderType) => {
      // Staged through the draft rather than panel-local state so the choice
      // survives a category switch and is reverted by Discard.
      onChange('watchHistory', { ...(draft.watchHistory ?? {}), provider: next });
    },
    [draft.watchHistory, onChange]
  );

  /*
   * The provider is not part of the settings payload — it lives under its own
   * `watch_history_*` keys — so the panel registers its own save step and the
   * shell still shows exactly one save button.
   */
  const saveInput = useRef({ provider: watchProvider, lookbackDays });
  saveInput.current = { provider: watchProvider, lookbackDays };

  const watchHistorySaveFailed = t(
    'connections.watchHistory.saveFailed',
    'Could not save the watch history provider'
  );

  useEffect(() => {
    registerSaver('watchHistory', async () => {
      const { provider, lookbackDays: days } = saveInput.current;
      const response = await fetch('/api/settings/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ...(provider ? [{ key: 'watch_history_provider', value: provider }] : []),
          { key: 'watch_history_lookback_days', value: String(days) },
        ]),
      });
      if (!response.ok) throw new Error(watchHistorySaveFailed);
    });
    // Deliberately not unregistered on unmount: the provider is staged in the
    // draft, which outlives this panel, and PUT /settings ignores it — so if the
    // saver went away when the user switched category, a staged provider change
    // would be dropped by the very save that clears it. Re-mounting replaces the
    // entry under the same id, so nothing accumulates.
  }, [registerSaver, watchHistorySaveFailed]);

  /* ---------------- test all ---------------- */

  const [testingAll, setTestingAll] = useState(false);

  const configuredKeys = useMemo(() => {
    const keys: ServiceKeyType[] = [];
    if (isConfigured(mediaConfig)) keys.push(mediaServer.configKey);
    for (const meta of Object.values(INTEGRATIONS)) {
      if (isConfigured(services?.[meta.key])) keys.push(meta.key);
    }
    for (const key of ['tautulli', 'tracearr'] as const) {
      if (isConfigured(services?.[key])) keys.push(key);
    }
    return keys;
  }, [mediaConfig, mediaServer.configKey, services]);

  /*
   * The old page tested every configured service as soon as settings loaded, so
   * the dots meant something before you touched anything. The flag is module
   * scoped rather than per-mount so switching category and back does not fire a
   * fresh round of requests.
   */
  const runTestRef = useRef(runTest);
  runTestRef.current = runTest;
  useEffect(() => {
    if (autoTestRan || configuredKeys.length === 0) return;
    autoTestRan = true;
    for (const key of configuredKeys) void runTestRef.current(key);
  }, [configuredKeys]);

  const handleTestAll = useCallback(async () => {
    setTestingAll(true);
    try {
      await Promise.all(configuredKeys.map((key) => runTest(key)));
    } finally {
      setTestingAll(false);
    }
  }, [configuredKeys, runTest]);

  /* ---------------- copy ---------------- */

  const credentialLabel =
    mediaMeta.credential === 'token'
      ? t('services.fields.token', 'Token')
      : t('services.fields.apiKey', 'API Key');

  const testAllAction = (
    <button
      type="button"
      onClick={handleTestAll}
      disabled={configuredKeys.length === 0 || testingAll}
      title={
        configuredKeys.length === 0
          ? t('connections.testAllEmpty', 'Nothing is configured to test yet')
          : undefined
      }
      className={cn(
        'inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-[10px] border border-surface-600/80 px-3 py-1.5',
        'font-sans text-[12px] font-semibold text-surface-200 transition-colors',
        'hover:bg-surface-700/60 hover:text-surface-50',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60',
        'disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-[32px]'
      )}
    >
      {testingAll ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      )}
      {t('connections.testAll', 'Test all connections')}
    </button>
  );

  return (
    <>
      {/* ------------------------------ media server ------------------------------ */}
      <PanelSection
        id="media-server"
        register={registerSection}
        title={t('mediaServer.title', 'Media Server')}
        description={t('mediaServer.description', 'The server Prunerr reads your library from')}
        action={testAllAction}
      >
        {fresh && (
          <div className="flex flex-col gap-3 rounded-[14px] border border-accent-500/[0.22] bg-accent-500/[0.08] px-[18px] py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p className="font-display text-[14px] font-semibold text-accent-text">
                {t('connections.firstRun.title', 'Nothing is connected yet')}
              </p>
              <p className="max-w-2xl text-[12px] text-surface-300">
                {t(
                  'connections.firstRun.body',
                  'Connect {{name}} and Prunerr can read your library. Add Sonarr or Radarr when you want it to actually delete things — scanning stays off until then.',
                  { name: mediaServer.name }
                )}
              </p>
            </div>
            <Button
              size="sm"
              className="min-h-[44px] shrink-0"
              onClick={() => mediaServerUrlRef.current?.focus()}
            >
              {t('connections.firstRun.connect', 'Connect {{name}}', { name: mediaServer.name })}
            </Button>
          </div>
        )}

        <ConnectionCard
          name={mediaServer.name}
          logo={<MediaServerLogo type={mediaServer.type} size={16} />}
          role="required"
          note={t('connections.notes.mediaServer', 'Library data and watch status')}
          config={mediaConfig}
          testResult={mediaResult}
          docsUrl={mediaMeta.docsUrl}
          defaultPort={mediaMeta.defaultPort}
          credential={mediaMeta.credential}
          credentialLabel={credentialLabel}
          fieldIdPrefix={`media-${mediaServer.configKey}`}
          urlRef={mediaServerUrlRef}
          alwaysOpen
          onFieldChange={(field, value) => onServiceChange(mediaServer.configKey, field, value)}
          onTest={() => runTest(mediaServer.configKey)}
          header={
            <MediaServerPicker
              value={mediaServer.type}
              onChange={handleMediaServerTypeChange}
              ariaLabel={t('mediaServer.title', 'Media Server')}
            />
          }
          footer={
            mediaServer.type !== 'plex' ? (
              <p className="rounded-xl border border-surface-700/60 bg-surface-800/50 px-3.5 py-3 text-[12px] text-surface-300">
                {t(
                  'mediaServer.playbackReportingHint',
                  'Tip: install the Playback Reporting plugin on your server. Without it only the most recent play of each item is recorded, so repeat views are missed and play counts read low.'
                )}
              </p>
            ) : null
          }
        />
      </PanelSection>

      {/* ------------------------------ sonarr & radarr ------------------------------ */}
      <PanelSection
        id="sonarr-radarr"
        register={registerSection}
        title={t('connections.sections.sonarrRadarr', 'Sonarr & Radarr')}
        description={t(
          'connections.sections.sonarrRadarrDescription',
          'Prunerr deletes through these — without them it can only report'
        )}
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {(['sonarr', 'radarr'] as const).map((key) => (
            <IntegrationCard
              key={key}
              meta={INTEGRATIONS[key]}
              config={services?.[key]}
              testResult={testResults[key]}
              onFieldChange={(field, value) => onServiceChange(key, field, value)}
              onTest={() => runTest(key)}
            />
          ))}
        </div>
      </PanelSection>

      {/* ------------------------------ watch history ------------------------------ */}
      <PanelSection
        id="watch-history"
        register={registerSection}
        title={t('watchHistory.title', 'Watch History Provider')}
        description={t(
          'watchHistory.description',
          'Connect a watch history service for tracking play counts and watched status'
        )}
      >
        <WatchHistoryCard
          provider={watchProvider}
          onProviderChange={handleWatchProviderChange}
          mediaServerName={mediaServer.name}
          mediaServerType={mediaServer.type}
          fresh={fresh}
          lookbackDays={lookbackDays}
          onLookbackChange={(days) =>
            onChange('schedule', {
              enabled: draft.schedule?.enabled ?? false,
              interval: draft.schedule?.interval ?? 'daily',
              time: draft.schedule?.time ?? '03:00',
              autoProcess: draft.schedule?.autoProcess ?? false,
              ...draft.schedule,
              historyLookbackDays: days,
            })
          }
          services={services}
          testResults={testResults}
          onFieldChange={onServiceChange}
          runTest={runTest}
        />
      </PanelSection>

      {/* ------------------------------ seerr ------------------------------ */}
      <PanelSection
        id="overseerr"
        register={registerSection}
        title={INTEGRATIONS.overseerr.name}
        description={t(
          'connections.sections.overseerrDescription',
          'Clears the request when Prunerr deletes what it asked for'
        )}
      >
        <IntegrationCard
          meta={INTEGRATIONS.overseerr}
          config={services?.overseerr}
          testResult={testResults.overseerr}
          onFieldChange={(field, value) => onServiceChange('overseerr', field, value)}
          onTest={() => runTest('overseerr')}
        />
      </PanelSection>

      {/* ------------------------------ unraid ------------------------------ */}
      <PanelSection
        id="unraid"
        register={registerSection}
        title={INTEGRATIONS.unraid.name}
        description={t(
          'connections.sections.unraidDescription',
          'Array and disk monitoring — feeds the disk-pressure gauge'
        )}
      >
        <IntegrationCard
          meta={INTEGRATIONS.unraid}
          config={services?.unraid}
          testResult={testResults.unraid}
          onFieldChange={(field, value) => onServiceChange('unraid', field, value)}
          onTest={() => runTest('unraid')}
          extra={<UnraidApiKeyHelper />}
        />
      </PanelSection>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Media server picker                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Visually the shared `SegmentedControl`, but each option carries its backend's
 * brand mark — which a string-only option list cannot express.
 */
function MediaServerPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: MediaServerType;
  onChange: (value: MediaServerType) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        // Full width on a phone, where it wraps onto its own line anyway.
        'flex w-full gap-1 rounded-[11px] border border-surface-700/90 bg-surface-800/80 p-[3px]',
        'sm:inline-flex sm:w-auto'
      )}
    >
      {MEDIA_SERVER_ORDER.map((type) => {
        const selected = value === type;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(type)}
            className={cn(
              'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg px-2 text-xs font-semibold',
              'sm:flex-none sm:px-[13px] sm:py-1.5 lg:min-h-[30px]',
              'transition-colors duration-150 motion-reduce:transition-none',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60',
              selected
                ? 'bg-accent-500/[0.14] text-accent-text'
                : 'text-surface-400 hover:text-surface-200'
            )}
          >
            <MediaServerLogo type={type} size={14} />
            {MEDIA_SERVER_NAMES[type]}
          </button>
        );
      })}
    </div>
  );
}

const MEDIA_SERVER_NAMES: Record<MediaServerType, string> = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
};

/* -------------------------------------------------------------------------- */
/* Connection card                                                             */
/* -------------------------------------------------------------------------- */

function StatusPill({
  testResult,
  role,
  configured,
}: {
  testResult: TestResult | undefined;
  role: ServiceRole;
  configured: boolean;
}) {
  const { t } = useTranslation('settings');

  const base = 'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium';

  if (testResult?.status === 'success') {
    return (
      <span className={cn(base, 'bg-emerald-500/10 text-emerald-400')}>
        {t('services.test.connected', 'Connected')}
      </span>
    );
  }
  if (testResult?.status === 'error') {
    return (
      <span className={cn(base, 'bg-ruby-500/10 text-ruby-400')}>
        {t('connections.status.unreachable', 'Unreachable')}
      </span>
    );
  }
  if (testResult?.status === 'loading') {
    return (
      <span className={cn(base, 'bg-accent-500/10 text-accent-text')}>
        {t('connections.status.verifying', 'Verifying…')}
      </span>
    );
  }

  const roleLabel =
    role === 'required'
      ? t('services.required', 'Required')
      : role === 'recommended'
        ? t('connections.roles.recommended', 'Recommended')
        : t('connections.roles.optional', 'Optional');

  return (
    <span
      className={cn(
        base,
        role === 'required' && !configured
          ? 'bg-accent-500/10 text-accent-text'
          : 'bg-surface-700/60 text-surface-400'
      )}
    >
      {roleLabel}
    </span>
  );
}

function dotState(
  testResult: TestResult | undefined,
  role: ServiceRole,
  configured: boolean
): StatusDotState {
  if (testResult?.status === 'success') return 'healthy';
  if (testResult?.status === 'error') return 'failed';
  if (!configured && role === 'required') return 'required-unset';
  // Configured but unverified is deliberately neutral rather than green: only a
  // passing test earns the healthy dot.
  return 'optional-unset';
}

interface ConnectionCardProps {
  name: string;
  logo?: ReactNode;
  role: ServiceRole;
  note: string;
  config: ServiceConnection | undefined;
  testResult: TestResult | undefined;
  docsUrl: string;
  defaultPort: string;
  credential: Extract<ServiceField, 'apiKey' | 'token'>;
  credentialLabel: string;
  fieldIdPrefix: string;
  onFieldChange: (field: ServiceField, value: string) => void;
  onTest: () => void;
  /** Rendered on the card's top row — the backend picker on the media server. */
  header?: ReactNode;
  /** Rendered at the bottom of the expanded body. */
  footer?: ReactNode;
  /** Extra disclosure inside the expanded body — the Unraid key helper. */
  extra?: ReactNode;
  /** The media-server card never collapses: it is the one thing you must set. */
  alwaysOpen?: boolean;
  urlRef?: Ref<HTMLInputElement>;
}

function ConnectionCard({
  name,
  logo,
  role,
  note,
  config,
  testResult,
  docsUrl,
  defaultPort,
  credential,
  credentialLabel,
  fieldIdPrefix,
  onFieldChange,
  onTest,
  header,
  footer,
  extra,
  alwaysOpen = false,
  urlRef,
}: ConnectionCardProps) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const expanded = alwaysOpen || open;
  const configured = isConfigured(config);
  const failing = testResult?.status === 'error';

  return (
    <SettingsCard
      tone={failing ? 'failing' : 'default'}
      className="flex flex-col gap-2.5 px-[15px] py-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot state={dotState(testResult, role, configured)} size={7} />
          {logo}
          <h3 className="truncate font-display text-[14px] font-semibold text-surface-50">{name}</h3>
          <StatusPill testResult={testResult} role={role} configured={configured} />
        </div>
        {header}
      </div>

      <p
        className={cn(
          'truncate font-mono text-[11.5px]',
          config?.url ? 'text-surface-400' : 'text-surface-500'
        )}
      >
        {config?.url || t('connections.notConnected', 'Not connected')}
      </p>

      <div className="flex items-center justify-between gap-3">
        <p
          className={cn(
            'min-w-0 flex-1 text-[11.5px]',
            failing ? 'line-clamp-2 text-ruby-400' : 'truncate text-surface-500'
          )}
        >
          {failing
            ? testResult?.message || t('services.test.connectionFailed', 'Connection failed')
            : note}
        </p>

        <div className="flex shrink-0 items-center gap-1">
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('connections.docs', 'Open {{name}} documentation', { name })}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[9px] text-surface-500 transition-colors hover:bg-surface-700/50 hover:text-accent-text lg:min-h-[30px] lg:min-w-[30px]"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>

          {!alwaysOpen && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={expanded}
              className={cn(
                'inline-flex min-h-[44px] items-center gap-1.5 rounded-[9px] border px-[11px] py-[5px]',
                'text-[11.5px] font-semibold transition-colors lg:min-h-[30px]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60',
                role === 'required' && !configured
                  ? 'border-accent-500/30 bg-accent-500/[0.14] text-accent-text'
                  : 'border-surface-600/80 text-surface-200 hover:bg-surface-700/60 hover:text-surface-50'
              )}
            >
              {configured
                ? t('connections.edit', 'Edit')
                : t('connections.connect', 'Connect')}
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform duration-150 motion-reduce:transition-none',
                  expanded && 'rotate-180'
                )}
                aria-hidden
              />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-1 flex flex-col gap-3.5 border-t border-surface-700/60 pt-3.5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              ref={urlRef}
              id={`${fieldIdPrefix}-url`}
              label={t('services.fields.url', 'URL')}
              type="url"
              value={config?.url || ''}
              onChange={(event) => onFieldChange('url', event.target.value)}
              placeholder={`http://localhost:${defaultPort}`}
              {...noAutofill}
            />
            <Input
              id={`${fieldIdPrefix}-credential`}
              label={credentialLabel}
              type="password"
              value={(credential === 'token' ? config?.token : config?.apiKey) || ''}
              onChange={(event) => onFieldChange(credential, event.target.value)}
              placeholder={t('services.fields.apiKeyOrTokenPlaceholder', 'Enter API key or token')}
              {...noAutofill}
              autoComplete="new-password"
            />
          </div>

          {extra}

          <TestRow testResult={testResult} onTest={onTest} disabled={!config?.url} />

          {footer}
        </div>
      )}
    </SettingsCard>
  );
}

function IntegrationCard({
  meta,
  config,
  testResult,
  onFieldChange,
  onTest,
  extra,
}: {
  meta: IntegrationMeta;
  config: ServiceConnection | undefined;
  testResult: TestResult | undefined;
  onFieldChange: (field: ServiceField, value: string) => void;
  onTest: () => void;
  extra?: ReactNode;
}) {
  const { t } = useTranslation('settings');

  const notes: Record<IntegrationMeta['key'], string> = {
    sonarr: t('connections.notes.sonarr', 'Needed to delete TV shows'),
    radarr: t('connections.notes.radarr', 'Needed to delete movies'),
    overseerr: t('connections.notes.overseerr', 'Resets requests on deletion'),
    unraid: t('connections.notes.unraid', 'Array and disk monitoring'),
  };

  return (
    <ConnectionCard
      name={meta.name}
      role={meta.role}
      note={notes[meta.key]}
      config={config}
      testResult={testResult}
      docsUrl={meta.docsUrl}
      defaultPort={meta.defaultPort}
      credential="apiKey"
      credentialLabel={t('services.fields.apiKey', 'API Key')}
      fieldIdPrefix={`service-${meta.key}`}
      onFieldChange={onFieldChange}
      onTest={onTest}
      extra={extra}
    />
  );
}

function TestRow({
  testResult,
  onTest,
  disabled,
}: {
  testResult: TestResult | undefined;
  onTest: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation('settings');

  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-h-[24px] min-w-0 items-center gap-2">
        {testResult?.status === 'success' && (
          <span className="flex items-center gap-2 text-[12.5px] font-medium text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            {t('services.test.connectedSuccess', 'Connected successfully')}
          </span>
        )}
        {testResult?.status === 'error' && (
          <span className="flex max-w-md items-start gap-2 whitespace-pre-line text-[12.5px] text-ruby-400">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {testResult.message || t('services.test.connectionFailed', 'Connection failed')}
          </span>
        )}
        {testResult?.status === 'loading' && (
          <span className="flex items-center gap-2 text-[12.5px] text-accent-text">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            {t('services.test.verifying', 'Verifying connection...')}
          </span>
        )}
      </div>

      <Button
        variant="secondary"
        size="sm"
        className="min-h-[44px] w-full sm:w-auto lg:min-h-0"
        onClick={onTest}
        disabled={disabled || testResult?.status === 'loading'}
      >
        {testResult?.status === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
        {t('services.test.button', 'Test Connection')}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Watch history                                                               */
/* -------------------------------------------------------------------------- */

function WatchHistoryCard({
  provider,
  onProviderChange,
  mediaServerName,
  mediaServerType,
  fresh,
  lookbackDays,
  onLookbackChange,
  services,
  testResults,
  onFieldChange,
  runTest,
}: {
  provider: WatchHistoryProviderType | null;
  onProviderChange: (provider: WatchHistoryProviderType) => void;
  mediaServerName: string;
  mediaServerType: MediaServerType;
  fresh: boolean;
  lookbackDays: number;
  onLookbackChange: (days: number) => void;
  services: PanelProps['draft']['services'];
  testResults: PanelProps['testResults'];
  onFieldChange: PanelProps['onServiceChange'];
  runTest: PanelProps['runTest'];
}) {
  const { t } = useTranslation('settings');

  const isPlexBackend = mediaServerType === 'plex';

  /*
   * Tautulli and Tracearr resolve item ids from Plex-format artwork paths. On a
   * Jellyfin or Emby install they match nothing, so every item reports zero
   * plays — which is precisely what the rules engine deletes. They are offered
   * only when the backend is Plex.
   */
  const plexOnlyTitle = (name: string) =>
    t(
      'connections.watchHistory.plexOnly',
      '{{provider}} reads Plex item ids, so it needs a Plex media server.',
      { provider: name }
    );

  const options = [
    {
      value: 'plex' as const,
      label: t('connections.watchHistory.direct', '{{name}} direct', { name: mediaServerName }),
    },
    {
      value: 'tautulli' as const,
      label: WATCH_HISTORY_META.tautulli.name,
      disabled: !isPlexBackend,
      title: isPlexBackend ? undefined : plexOnlyTitle(WATCH_HISTORY_META.tautulli.name),
    },
    {
      value: 'tracearr' as const,
      label: WATCH_HISTORY_META.tracearr.name,
      disabled: !isPlexBackend,
      title: isPlexBackend ? undefined : plexOnlyTitle(WATCH_HISTORY_META.tracearr.name),
    },
  ];

  const external = provider === 'tautulli' || provider === 'tracearr' ? provider : null;
  const mismatched = external !== null && !isPlexBackend;
  const externalConfig = external ? services?.[external] : undefined;
  const externalResult = external ? testResults[external] : undefined;

  return (
    <SettingsCard className="flex flex-col gap-3.5 px-[17px] py-[15px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-display text-[14.5px] font-semibold text-surface-50">
            {t('connections.watchHistory.title', 'Watch history provider')}
          </p>
          <p className="text-[11.5px] text-surface-400">
            {fresh
              ? t(
                  'connections.watchHistory.freshHint',
                  'Optional — pick one to unlock watch-count rules'
                )
              : t(
                  'connections.watchHistory.hint',
                  'Play counts and watched status · {{days}} day lookback',
                  { days: lookbackDays }
                )}
          </p>
        </div>

        <SegmentedControl
          value={provider}
          options={options}
          onChange={onProviderChange}
          ariaLabel={t('connections.watchHistory.title', 'Watch history provider')}
        />
      </div>

      {mismatched && (
        <p className="rounded-xl border border-ruby-500/25 bg-ruby-500/[0.06] px-3.5 py-3 text-[12px] text-ruby-400">
          {t(
            'connections.watchHistory.mismatch',
            '{{provider}} only resolves Plex item ids, so on {{name}} every item reports zero plays — and zero-play items are exactly what the rules engine deletes. Switch to “{{name}} direct”.',
            { provider: WATCH_HISTORY_META[external].name, name: mediaServerName }
          )}
        </p>
      )}

      {provider === 'plex' && (
        <p className="rounded-xl border border-surface-700/60 bg-surface-800/50 px-3.5 py-3 text-[12px] text-surface-300">
          {isPlexBackend
            ? t(
                'watchHistory.plexDirectInfo',
                "No extra configuration needed — Prunerr will read history from your Plex server using the connection set in the Media Server section above. Requires the server-owner's token."
              )
            : t(
                'watchHistory.mediaServerDirectInfo',
                'No extra configuration needed — Prunerr will read history from your media server using the connection set in the Media Server section above. Install the Playback Reporting plugin for full play-count accuracy.'
              )}
        </p>
      )}

      {external && (
        <div className="flex flex-col gap-3.5 rounded-xl border border-surface-700/90 bg-surface-800/40 px-3.5 py-3.5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              id={`watch-history-${external}-url`}
              label={t('services.fields.url', 'URL')}
              type="url"
              value={externalConfig?.url || ''}
              onChange={(event) => onFieldChange(external, 'url', event.target.value)}
              placeholder={`http://localhost:${WATCH_HISTORY_META[external].defaultPort}`}
              {...noAutofill}
            />
            <Input
              id={`watch-history-${external}-key`}
              label={
                external === 'tautulli'
                  ? t('watchHistory.providers.tautulli.fieldLabel', 'API Key')
                  : t('watchHistory.providers.tracearr.fieldLabel', 'API Token')
              }
              type="password"
              value={externalConfig?.apiKey || ''}
              onChange={(event) => onFieldChange(external, 'apiKey', event.target.value)}
              placeholder={t('services.fields.apiKeyOrTokenPlaceholder', 'Enter API key or token')}
              {...noAutofill}
              autoComplete="new-password"
            />
          </div>

          <TestRow
            testResult={externalResult}
            onTest={() => runTest(external)}
            disabled={!externalConfig?.url}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-800/45 px-3.5 py-3">
        <div className="flex flex-col gap-0.5">
          <label
            htmlFor="watch-history-lookback"
            className="font-display text-[13.5px] font-semibold text-surface-50"
          >
            {t('watchHistory.lookback.title', 'History Lookback')}
          </label>
          <p className="text-[11.5px] text-surface-400">
            {t('watchHistory.lookback.description', 'How far back to fetch watch history data')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="watch-history-lookback"
            type="number"
            min={30}
            max={3650}
            value={lookbackDays}
            onChange={(event) =>
              onLookbackChange(Math.max(30, parseInt(event.target.value, 10) || 365))
            }
            className="min-h-[44px] w-24 rounded-[11px] border border-surface-600/60 bg-surface-800/70 px-3 py-2 text-center font-mono text-[13px] text-surface-50 focus:border-accent-500/50 focus:outline-none lg:min-h-0"
          />
          <span className="text-[12px] text-surface-400">
            {t('watchHistory.lookback.days', 'days')}
          </span>
        </div>
      </div>
    </SettingsCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Unraid API-key helper                                                       */
/* -------------------------------------------------------------------------- */

/** Creates a key with the viewer role — read-only access. */
const UNRAID_API_KEY_TEMPLATE = '?name=Prunerr&scopes=role%3Aviewer';

function UnraidApiKeyHelper() {
  const { t } = useTranslation('settings');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(UNRAID_API_KEY_TEMPLATE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  return (
    <details className="rounded-xl border border-surface-700/60 bg-surface-800/40 px-3.5 py-3">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[12.5px] font-semibold text-surface-200 lg:min-h-0">
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-surface-500" aria-hidden />
        {t('unraidHelper.title', 'How to create an API key')}
      </summary>

      <ol className="mt-3 list-inside list-decimal space-y-2 text-[12px] text-surface-400">
        <li>
          <Trans i18nKey="unraidHelper.step1" ns="settings">
            Go to your Unraid server: <strong>Settings → Management Access → API</strong>
          </Trans>
        </li>
        <li>
          <Trans i18nKey="unraidHelper.step2" ns="settings">
            Click <strong>&quot;Add API Key&quot;</strong>
          </Trans>
        </li>
        <li>
          <Trans i18nKey="unraidHelper.step3" ns="settings">
            Click <strong>&quot;Create from Template&quot;</strong>
          </Trans>
        </li>
        <li>
          <Trans i18nKey="unraidHelper.step4" ns="settings">
            Paste the template below and click <strong>&quot;Continue&quot;</strong>
          </Trans>
        </li>
        <li>{t('unraidHelper.step5', 'Copy the generated API key and paste it above')}</li>
      </ol>

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-surface-600/50 bg-surface-800/60 px-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] text-surface-400">
            {t('unraidHelper.templateLabel', 'API Key Template:')}
          </p>
          <code className="break-all font-mono text-[12px] text-accent-text">
            {UNRAID_API_KEY_TEMPLATE}
          </code>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          className="min-h-[44px] shrink-0 lg:min-h-0"
          title={t('unraidHelper.copyTemplate', 'Copy template')}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-emerald-400" aria-hidden />
              <span className="text-emerald-400">{t('unraidHelper.copied', 'Copied')}</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" aria-hidden />
              {t('unraidHelper.copy', 'Copy')}
            </>
          )}
        </Button>
      </div>

      <p className="mt-3 text-[11px] text-surface-500">
        {t(
          'unraidHelper.note',
          'This template creates a read-only API key with viewer permissions for monitoring array health and disk status.'
        )}
      </p>
    </details>
  );
}
