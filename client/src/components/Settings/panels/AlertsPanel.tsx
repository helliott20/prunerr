import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, ChevronDown, Loader2, Plus, Trash2, XCircle } from 'lucide-react';

import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useTestWebhook } from '@/hooks/useApi';
import { LANGUAGES, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n/languages';
import { cn } from '@/lib/utils';
import type { NotificationEventName, NotificationSettings, WebhookTarget } from '@/types';

import { PanelSection } from '../components/PanelSection';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsEmptyState } from '../components/SettingsEmptyState';
import { StatusDot, type StatusDotState } from '../components/StatusDot';
import { Toggle } from '../components/Toggle';
import type { PanelProps } from '../types';

/**
 * Suppress password-manager autofill on webhook fields. The optional "secret"
 * field makes managers treat the panel as a login form and autofill name/url.
 */
const noAutofill = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const;

type TestState = { status: 'idle' | 'loading' | 'success' | 'error'; message?: string };

const IDLE: TestState = { status: 'idle' };

/**
 * `notifications_notifyOnDiskPressure` is read by the server but has never been
 * exposed in the client type; the settings route round-trips any
 * `notifications_*` field, so the disk-pressure chip can drive it directly.
 */
type NotificationDraft = NotificationSettings & { notifyOnDiskPressure?: boolean };

/** Which stored preference each Discord event chip actually switches. */
type EventBinding =
  | { kind: 'scan' }
  | { kind: 'flag'; field: 'notifyOnQueue' | 'notifyBeforeDeletion' | 'notifyOnDeletion' | 'notifyOnDiskPressure' };

interface EventDefinition {
  value: NotificationEventName;
  labelKey: string;
  fallback: string;
  binding: EventBinding;
}

/**
 * The seven events, in the order the design lists them. `binding` mirrors
 * `NotificationService.isEventEnabled` on the server — two pairs genuinely
 * share one stored preference, so those chips move together.
 */
const EVENTS: EventDefinition[] = [
  { value: 'SCAN_COMPLETE', labelKey: 'webhooks.events.scanComplete', fallback: 'Scan complete', binding: { kind: 'scan' } },
  { value: 'SCAN_ERROR', labelKey: 'webhooks.events.scanError', fallback: 'Scan error', binding: { kind: 'scan' } },
  { value: 'ITEMS_MARKED', labelKey: 'webhooks.events.itemsQueued', fallback: 'Items queued', binding: { kind: 'flag', field: 'notifyOnQueue' } },
  { value: 'DELETION_IMMINENT', labelKey: 'webhooks.events.deletionImminent', fallback: 'Deletion imminent', binding: { kind: 'flag', field: 'notifyBeforeDeletion' } },
  { value: 'DELETION_COMPLETE', labelKey: 'webhooks.events.deletionComplete', fallback: 'Deletion complete', binding: { kind: 'flag', field: 'notifyOnDeletion' } },
  { value: 'DELETION_ERROR', labelKey: 'webhooks.events.deletionError', fallback: 'Deletion error', binding: { kind: 'flag', field: 'notifyOnDeletion' } },
  { value: 'DISK_PRESSURE_TRIGGERED', labelKey: 'webhooks.events.diskPressure', fallback: 'Disk pressure', binding: { kind: 'flag', field: 'notifyOnDiskPressure' } },
];

/** The amber/neutral pill shared by the Discord card and every webhook row. */
function EventChip({
  label,
  selected,
  onToggle,
  title,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full border px-3 py-1.5 text-xs font-medium lg:min-h-[30px]',
        'transition-colors duration-150 motion-reduce:transition-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60',
        selected
          ? 'border-accent-500/25 bg-accent-500/[0.13] text-accent-text'
          : 'border-surface-600/60 bg-surface-800/70 text-surface-400 hover:text-surface-200'
      )}
    >
      {label}
    </button>
  );
}

/** Inline verifying / delivered / failed line shared by both test buttons. */
function TestResultLine({ result }: { result: TestState }) {
  if (result.status === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-text">
        <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
        {result.message}
      </span>
    );
  }

  if (result.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ruby-text">
        <XCircle className="h-4 w-4 shrink-0" aria-hidden />
        {result.message}
      </span>
    );
  }

  return null;
}

export default function AlertsPanel({ draft, onChange, fresh, registerSection }: PanelProps) {
  const { t } = useTranslation('settings');

  const notifications = (draft.notifications ?? {}) as NotificationDraft;
  /** Nothing has ever been stored — the first-run state the handoff describes. */
  const untouched = fresh && Object.keys(notifications).length === 0;

  /**
   * Port of the old `handleNotificationChange`: every write materialises the
   * server-side defaults alongside the edited field, so a saved payload never
   * half-describes the notification preferences.
   */
  const patchNotifications = useCallback(
    (updates: Partial<NotificationDraft>) => {
      const next: NotificationDraft = {
        discordEnabled: notifications.discordEnabled ?? false,
        discordWebhook: notifications.discordWebhook,
        scanNotify: notifications.scanNotify ?? 'flagged_only',
        notifyOnQueue: notifications.notifyOnQueue ?? true,
        notifyBeforeDeletion: notifications.notifyBeforeDeletion ?? true,
        notifyOnDeletion: notifications.notifyOnDeletion ?? true,
        notifyOnDiskPressure: notifications.notifyOnDiskPressure ?? true,
        language: notifications.language,
        ...updates,
      };
      onChange('notifications', next as NotificationSettings);
    },
    [notifications, onChange]
  );

  // --- Discord test ---------------------------------------------------------

  const [discordTest, setDiscordTest] = useState<TestState>(IDLE);
  const discordTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(discordTimer.current), []);

  const handleTestDiscord = useCallback(async () => {
    const webhookUrl = notifications.discordWebhook;
    if (!webhookUrl) {
      setDiscordTest({
        status: 'error',
        message: t('notifications.discord.enterUrlFirst', 'Enter a webhook URL first'),
      });
      return;
    }

    setDiscordTest({ status: 'loading' });

    try {
      const response = await fetch('/api/settings/test/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      });
      const data = await response.json();

      if (data.success) {
        setDiscordTest({ status: 'success', message: data.message });
      } else {
        setDiscordTest({
          status: 'error',
          message: data.error || t('notifications.discord.testFailed', 'Test failed'),
        });
      }
    } catch (error) {
      setDiscordTest({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : t('notifications.discord.sendFailed', 'Failed to send test'),
      });
    }

    // The verdict clears itself after 5 seconds, as it always has.
    clearTimeout(discordTimer.current);
    discordTimer.current = setTimeout(() => setDiscordTest(IDLE), 5000);
  }, [notifications.discordWebhook, t]);

  // --- Discord event chips --------------------------------------------------

  const scanEnabled = (notifications.scanNotify ?? (untouched ? 'never' : 'flagged_only')) !== 'never';

  const isEventSelected = useCallback(
    (binding: EventBinding): boolean => {
      if (binding.kind === 'scan') return scanEnabled;
      return notifications[binding.field] ?? !untouched;
    },
    [notifications, scanEnabled, untouched]
  );

  const toggleEvent = useCallback(
    (binding: EventBinding) => {
      if (binding.kind === 'scan') {
        patchNotifications({ scanNotify: scanEnabled ? 'never' : 'flagged_only' });
        return;
      }
      patchNotifications({ [binding.field]: !isEventSelected(binding) } as Partial<NotificationDraft>);
    },
    [isEventSelected, patchNotifications, scanEnabled]
  );

  // --- Outbound webhooks ----------------------------------------------------

  const webhooks = useMemo<WebhookTarget[]>(() => draft.webhooks ?? [], [draft.webhooks]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const updateWebhooks = useCallback(
    (next: WebhookTarget[]) => {
      onChange('webhooks', next);
    },
    [onChange]
  );

  const handleAddWebhook = useCallback(() => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `wh_${Date.now()}`;
    updateWebhooks([...webhooks, { id, name: '', url: '', events: [], enabled: true }]);
    // A brand-new target is useless collapsed.
    setExpanded((current) => ({ ...current, [id]: true }));
  }, [updateWebhooks, webhooks]);

  const handleRemoveWebhook = useCallback(
    (id: string) => {
      updateWebhooks(webhooks.filter((webhook) => webhook.id !== id));
    },
    [updateWebhooks, webhooks]
  );

  const handleWebhookChange = useCallback(
    (id: string, updates: Partial<WebhookTarget>) => {
      updateWebhooks(webhooks.map((webhook) => (webhook.id === id ? { ...webhook, ...updates } : webhook)));
    },
    [updateWebhooks, webhooks]
  );

  const handleToggleWebhookEvent = useCallback(
    (id: string, event: NotificationEventName) => {
      updateWebhooks(
        webhooks.map((webhook) => {
          if (webhook.id !== id) return webhook;
          const has = webhook.events.includes(event);
          return {
            ...webhook,
            events: has ? webhook.events.filter((e) => e !== event) : [...webhook.events, event],
          };
        })
      );
    },
    [updateWebhooks, webhooks]
  );

  const language = notifications.language ?? 'en';

  return (
    <>
      {/* ---------------- Discord ---------------- */}
      <PanelSection
        id="discord"
        title={t('nav.sub.discord', 'Discord')}
        register={registerSection}
      >
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="font-display text-[14.5px] font-semibold text-surface-50">
                {t('notifications.discord.title', 'Discord Webhook')}
              </p>
              <p className="text-[12.5px] text-surface-400">
                {t('notifications.discord.description', 'Send notifications to a Discord channel')}
              </p>
            </div>
            <Toggle
              checked={notifications.discordEnabled ?? false}
              onChange={(checked) => patchNotifications({ discordEnabled: checked })}
              label={t('notifications.discord.title', 'Discord Webhook')}
            />
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                id="discord-webhook-url"
                label={t('notifications.discord.webhookUrl', 'Webhook URL')}
                type="url"
                className="font-mono text-[12.5px]"
                value={notifications.discordWebhook ?? ''}
                onChange={(event) => patchNotifications({ discordWebhook: event.target.value })}
                placeholder={
                  untouched
                    ? t('alerts.discord.urlPlaceholder', 'Paste a Discord webhook URL')
                    : 'https://discord.com/api/webhooks/...'
                }
                {...noAutofill}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 shrink-0 lg:min-h-[38px]"
              onClick={handleTestDiscord}
              disabled={!notifications.discordWebhook || discordTest.status === 'loading'}
            >
              {discordTest.status === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  {t('common.sending', 'Sending...')}
                </>
              ) : (
                t('webhooks.sendTest', 'Send test')
              )}
            </Button>
          </div>

          <TestResultLine result={discordTest} />

          <div className="flex flex-col gap-2">
            <p className="text-[12.5px] font-medium text-surface-200">
              {t('webhooks.eventsLabel', 'Events')}
            </p>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map((event) => (
                <EventChip
                  key={event.value}
                  label={t(event.labelKey, event.fallback)}
                  selected={isEventSelected(event.binding)}
                  onToggle={() => toggleEvent(event.binding)}
                />
              ))}
            </div>
          </div>
        </SettingsCard>

        <SettingsCard className="flex flex-col gap-3 px-[18px] py-4">
          <p className="font-display text-[14.5px] font-semibold text-surface-50">
            {t('notifications.scan.title', 'Scan Notifications')}
          </p>
          <div
            role="radiogroup"
            aria-label={t('notifications.scan.title', 'Scan Notifications')}
            className="flex flex-col gap-1"
          >
            {(
              [
                { value: 'always', label: t('notifications.scan.always', 'Always notify after scan') },
                {
                  value: 'flagged_only',
                  label: t('notifications.scan.flaggedOnly', 'Only when items are flagged'),
                },
                { value: 'never', label: t('notifications.scan.never', 'Never') },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-[11px] px-2 hover:bg-surface-800/60"
              >
                <input
                  type="radio"
                  name="scanNotify"
                  value={option.value}
                  checked={
                    (notifications.scanNotify ?? (untouched ? 'never' : 'flagged_only')) === option.value
                  }
                  onChange={() => patchNotifications({ scanNotify: option.value })}
                  className="h-4 w-4 border-surface-600 bg-surface-800 text-accent-500 focus:ring-accent-500/50"
                />
                <span className="text-[13px] text-surface-300 transition-colors group-hover:text-surface-50 motion-reduce:transition-none">
                  {option.label}
                </span>
              </label>
            ))}
          </div>
        </SettingsCard>
      </PanelSection>

      {/* ---------------- Outbound webhooks ---------------- */}
      <PanelSection
        id="webhooks"
        title={t('webhooks.title', 'Outbound Webhooks')}
        description={t(
          'webhooks.description',
          'POST events to any URL — wire Prunerr into Home Assistant, n8n, or your own automations'
        )}
        register={registerSection}
        action={
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0 lg:min-h-[34px]"
            onClick={handleAddWebhook}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('webhooks.add', 'Add webhook')}
          </Button>
        }
      >
        <SettingsCard className="flex flex-col gap-2.5 px-[18px] py-4">
          {webhooks.length === 0 ? (
            <SettingsEmptyState
              title={t('alerts.webhooks.emptyTitle', 'No webhooks configured')}
              body={t('webhooks.empty', 'No webhooks configured. Add one to start sending events.')}
            />
          ) : (
            webhooks.map((webhook) => (
              <WebhookRow
                key={webhook.id}
                webhook={webhook}
                expanded={expanded[webhook.id] ?? !webhook.url}
                onToggleExpanded={() =>
                  setExpanded((current) => ({
                    ...current,
                    [webhook.id]: !(current[webhook.id] ?? !webhook.url),
                  }))
                }
                onChange={handleWebhookChange}
                onRemove={handleRemoveWebhook}
                onToggleEvent={handleToggleWebhookEvent}
              />
            ))
          )}
        </SettingsCard>
      </PanelSection>

      {/* ---------------- Notification language ---------------- */}
      <PanelSection
        id="notification-language"
        title={t('notifications.language.title', 'Notification Language')}
        register={registerSection}
      >
        <SettingsCard className="flex flex-col gap-3 px-[18px] py-4">
          <label htmlFor="notification-language-select" className="text-[12.5px] text-surface-400">
            {t('notifications.language.description', 'Language for outgoing notification messages')}
          </label>
          <select
            id="notification-language-select"
            value={language}
            onChange={(event) =>
              patchNotifications({ language: event.target.value as SupportedLanguage })
            }
            className={cn(
              'min-h-11 w-full rounded-[11px] border border-surface-600/60 bg-surface-800/70 px-3',
              'text-[13px] text-surface-100 focus:border-accent-500/50 focus:outline-none sm:max-w-xs'
            )}
          >
            {SUPPORTED_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGES[code]}
              </option>
            ))}
          </select>
        </SettingsCard>
      </PanelSection>
    </>
  );
}

/**
 * One outbound target: a compact summary row that expands into the name / URL /
 * secret editor and its per-event chips.
 */
function WebhookRow({
  webhook,
  expanded,
  onToggleExpanded,
  onChange,
  onRemove,
  onToggleEvent,
}: {
  webhook: WebhookTarget;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChange: (id: string, updates: Partial<WebhookTarget>) => void;
  onRemove: (id: string) => void;
  onToggleEvent: (id: string, event: NotificationEventName) => void;
}) {
  const { t } = useTranslation('settings');
  const testWebhookMutation = useTestWebhook();
  const [result, setResult] = useState<TestState>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleTest = useCallback(async () => {
    if (!webhook.url) {
      setResult({ status: 'error', message: t('webhooks.enterUrlFirst', 'Enter a URL first') });
      return;
    }

    setResult({ status: 'loading' });

    try {
      const response = await testWebhookMutation.mutateAsync({
        url: webhook.url,
        secret: webhook.secret,
      });
      setResult({
        status: 'success',
        message: t('webhooks.delivered', 'Delivered (HTTP {{status}})', { status: response.status ?? 200 }),
      });
    } catch (error) {
      setResult({
        status: 'error',
        message:
          error instanceof Error ? error.message : t('webhooks.deliveryFailed', 'Delivery failed'),
      });
    }

    clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(IDLE), 5000);
  }, [t, testWebhookMutation, webhook.secret, webhook.url]);

  const failing = result.status === 'error';
  // An off or half-written target is not an error — it is simply not in play.
  const dotState: StatusDotState = failing
    ? 'failed'
    : !webhook.enabled || !webhook.url
      ? 'optional-unset'
      : 'healthy';

  return (
    <div
      className={cn(
        'rounded-xl border px-3.5 py-3 transition-colors duration-200 motion-reduce:transition-none',
        failing ? 'border-ruby-500/25 bg-ruby-500/[0.05]' : 'border-surface-700/90 bg-surface-800/50'
      )}
    >
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center gap-3 text-left"
      >
        <StatusDot state={dotState} size={7} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[13px] font-semibold text-surface-50">
            {webhook.name || t('alerts.webhooks.untitled', 'Untitled webhook')}
          </span>
          <span className="block truncate font-mono text-[11px] text-surface-500">
            {webhook.url || t('alerts.webhooks.noUrl', 'No URL yet')}
          </span>
        </span>
        <span
          className={cn('shrink-0 text-[11.5px]', failing ? 'text-ruby-text' : 'text-surface-500')}
        >
          {failing
            ? t('alerts.webhooks.lastDeliveryFailed', 'last delivery failed')
            : t('alerts.webhooks.eventCount', '{{count}} events', { count: webhook.events.length })}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0 text-surface-500 transition-transform duration-200 motion-reduce:transition-none',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3.5 border-t border-surface-700/60 pt-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-3">
              <Input
                id={`webhook-name-${webhook.id}`}
                label={t('webhooks.nameLabel', 'Name (optional)')}
                value={webhook.name ?? ''}
                onChange={(event) => onChange(webhook.id, { name: event.target.value })}
                placeholder="Home Assistant"
                {...noAutofill}
              />
              <Input
                id={`webhook-url-${webhook.id}`}
                label={t('services.fields.url', 'URL')}
                type="url"
                className="font-mono text-[12.5px]"
                value={webhook.url}
                onChange={(event) => onChange(webhook.id, { url: event.target.value })}
                placeholder="https://ha.local:8123/api/webhook/prunerr"
                {...noAutofill}
              />
              <Input
                id={`webhook-secret-${webhook.id}`}
                label={t('webhooks.secretLabel', 'Signing secret (optional)')}
                className="font-mono text-[12.5px]"
                value={webhook.secret ?? ''}
                onChange={(event) => onChange(webhook.id, { secret: event.target.value })}
                placeholder={t(
                  'webhooks.secretPlaceholder',
                  'Used to sign requests with X-Prunerr-Signature'
                )}
                {...noAutofill}
              />
            </div>
            <div className="flex flex-col items-end gap-3 pt-1">
              <Toggle
                checked={webhook.enabled}
                onChange={(checked) => onChange(webhook.id, { enabled: checked })}
                label={t('alerts.webhooks.enable', 'Enable this webhook')}
              />
              <button
                type="button"
                onClick={() => onRemove(webhook.id)}
                title={t('webhooks.remove', 'Remove webhook')}
                aria-label={t('webhooks.remove', 'Remove webhook')}
                className="flex h-11 w-11 items-center justify-center rounded-[10px] text-surface-400 transition-colors hover:bg-ruby-500/10 hover:text-ruby-text motion-reduce:transition-none"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[12.5px] font-medium text-surface-200">
              {t('webhooks.eventsLabel', 'Events')}
            </p>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map((event) => (
                <EventChip
                  key={event.value}
                  label={t(event.labelKey, event.fallback)}
                  selected={webhook.events.includes(event.value)}
                  onToggle={() => onToggleEvent(webhook.id, event.value)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 lg:min-h-[34px]"
              onClick={handleTest}
              disabled={!webhook.url || result.status === 'loading'}
            >
              {result.status === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  {t('common.sending', 'Sending...')}
                </>
              ) : (
                t('webhooks.sendTest', 'Send test')
              )}
            </Button>
            <TestResultLine result={result} />
          </div>
        </div>
      )}
    </div>
  );
}
