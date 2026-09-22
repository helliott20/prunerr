import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, Copy, Download, Eye, EyeOff, RefreshCw, Upload } from 'lucide-react';

import { apiKeyApi, type ApiKeyInfo } from '@/services/api';
import { useImportSettings, useTelemetry, useUpdateTelemetry, useVersion } from '@/hooks/useApi';
import { useToast } from '@/components/common/Toast';
import { ConfirmModal, Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { cn } from '@/lib/utils';

import { PanelSection } from '../components/PanelSection';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsEmptyState } from '../components/SettingsEmptyState';
import { Toggle } from '../components/Toggle';
import type { PanelProps } from '../types';

const MASKED_KEY = '•'.repeat(32);

/** Small outline action, sized to clear the 44px hit target on touch. */
function ActionButton({
  onClick,
  disabled,
  tone = 'default',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'destructive';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[10px] border px-3',
        'text-[11.5px] font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60',
        'disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'destructive'
          ? 'border-ruby-500/30 bg-ruby-500/[0.14] text-ruby-text hover:bg-ruby-500/20'
          : 'border-surface-600/80 text-surface-200 hover:bg-surface-700/60 hover:text-surface-50'
      )}
    >
      {children}
    </button>
  );
}

/**
 * System — the API key and backup/restore, plus the version footer.
 *
 * Both sub-sections talk to their own endpoints and act immediately (a
 * regenerated key or an imported file is not something you stage), so neither
 * touches the draft or the dirty count.
 */
export default function SystemPanel({ registerSection }: PanelProps) {
  const { t } = useTranslation('settings');
  const { addToast } = useToast();

  // --- API key --------------------------------------------------------------

  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiKeyApi
      .get()
      .then((info) => {
        if (cancelled) return;
        setApiKeyInfo(info);
        setApiKeyStatus('ready');
      })
      .catch(() => {
        // API key feature not available on this install.
        if (!cancelled) setApiKeyStatus('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRegenerateApiKey = useCallback(async () => {
    setApiKeyLoading(true);
    try {
      const result = await apiKeyApi.regenerate();
      setApiKeyInfo(result);
      setApiKeyStatus('ready');
      setShowRegenerateConfirm(false);
      setApiKeyVisible(true);
      addToast({
        type: 'success',
        title: t('toasts.apiKeyRegeneratedTitle', 'API key regenerated'),
        message: t(
          'toasts.apiKeyRegeneratedMsg',
          'Any scripts or integrations using the old key will need to be updated.'
        ),
      });
    } catch {
      addToast({
        type: 'error',
        title: t('toasts.apiKeyRegenerateFailed', 'Failed to regenerate API key'),
      });
    } finally {
      setApiKeyLoading(false);
    }
  }, [addToast, t]);

  const handleCopyApiKey = useCallback(async () => {
    if (!apiKeyInfo?.apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKeyInfo.apiKey);
      setApiKeyCopied(true);
      setTimeout(() => setApiKeyCopied(false), 2000);
    } catch {
      addToast({ type: 'error', title: t('toasts.copyFailed', 'Failed to copy to clipboard') });
    }
  }, [apiKeyInfo, addToast, t]);

  // --- telemetry ------------------------------------------------------------

  const { data: telemetry } = useTelemetry();
  const updateTelemetry = useUpdateTelemetry();

  const handleTelemetryToggle = useCallback(
    (enabled: boolean) => {
      updateTelemetry.mutate(
        { enabled, noticeSeen: true },
        {
          onError: () =>
            addToast({
              type: 'error',
              title: t('toasts.telemetryFailed', 'Could not change that setting'),
            }),
        }
      );
    },
    [updateTelemetry, addToast, t]
  );

  // --- backup & restore -----------------------------------------------------

  const importMutation = useImportSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);

  const handleExport = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/export');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'prunerr-settings.json';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (error) {
      addToast({
        type: 'error',
        title: t('backup.exportFailed', 'Export failed'),
        message: error instanceof Error ? error.message : undefined,
      });
    }
  }, [addToast, t]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
      setShowImportConfirm(true);
    }
    // Reset the input so the same file can be picked again.
    event.target.value = '';
  }, []);

  const handleImportConfirm = useCallback(async () => {
    if (!importFile) return;
    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      await importMutation.mutateAsync(data);
      setShowImportConfirm(false);
      setImportFile(null);
    } catch {
      // Surfaced by the error banner below; the modal stays open so the file
      // name is still visible.
    }
  }, [importFile, importMutation]);

  const handleImportCancel = useCallback(() => {
    setShowImportConfirm(false);
    setImportFile(null);
  }, []);

  // --- full database backup & restore ---------------------------------------
  //
  // The settings export above carries only the settings table. This pair moves
  // the whole database: library, rules, queue and history included.

  const backupInputRef = useRef<HTMLInputElement>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const handleDownloadBackup = useCallback(async () => {
    setBackupBusy(true);
    try {
      const response = await fetch('/api/settings/backup');
      if (!response.ok) throw new Error(await response.text());

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `prunerr-backup-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      addToast({
        type: 'success',
        title: t('backup.fullDownloaded', 'Backup downloaded'),
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: t('backup.fullFailed', 'Backup failed'),
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBackupBusy(false);
    }
  }, [addToast, t]);

  const handleRestoreSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setRestoreFile(file);
      setShowRestoreConfirm(true);
    }
    event.target.value = '';
  }, []);

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoreFile) return;
    setRestoreBusy(true);
    try {
      const response = await fetch('/api/settings/restore', {
        method: 'POST',
        // Streamed to disk server-side; a library database is far too big to
        // send as JSON or hold in memory.
        headers: { 'Content-Type': 'application/octet-stream' },
        body: restoreFile,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Restore failed');
      }

      setShowRestoreConfirm(false);
      setRestoreFile(null);
      addToast({
        type: 'success',
        title: t('backup.restoreDone', 'Database restored'),
        message: t('backup.restoreDoneHint', 'Reload the page to see the restored data.'),
      });
    } catch (error) {
      addToast({
        type: 'error',
        title: t('backup.restoreFailed', 'Restore failed'),
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRestoreBusy(false);
    }
  }, [addToast, restoreFile, t]);

  // --- version --------------------------------------------------------------

  const { data: version } = useVersion();

  return (
    <>
      <PanelSection
        id="api-key"
        register={registerSection}
        title={t('nav.sub.apiKey', 'API key')}
        description={t(
          'apiKey.description',
          'Required for external API access (scripts, nzb360, etc.). The web UI does not need it.'
        )}
      >
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          {apiKeyStatus === 'unavailable' ? (
            <SettingsEmptyState
              title={t('apiKey.unavailableTitle', 'No API key yet')}
              body={t(
                'apiKey.unavailableBody',
                'This install has not issued an API key. External access stays disabled until one exists.'
              )}
            />
          ) : (
            <>
              <p className="font-display text-[13.5px] font-semibold text-surface-50">
                {t('apiKey.yourKey', 'Your API Key')}
              </p>

              {/* basis-full is what stops the key from being squeezed into a
                  sliver beside three buttons on a phone: it takes its own row,
                  and the actions share the one below. */}
              <div className="flex flex-wrap items-center gap-2">
                <code
                  aria-label={t('apiKey.yourKey', 'Your API Key')}
                  className={cn(
                    'min-w-0 basis-full truncate rounded-[11px] border border-surface-600/60',
                    'bg-surface-800/70 px-3 py-3 font-mono text-[12.5px] tracking-[0.04em] text-surface-300',
                    'sm:flex-1 sm:basis-auto'
                  )}
                >
                  {apiKeyVisible && apiKeyInfo ? apiKeyInfo.apiKey : MASKED_KEY}
                </code>

                <ActionButton
                  onClick={() => setApiKeyVisible((visible) => !visible)}
                  disabled={!apiKeyInfo}
                >
                  {apiKeyVisible ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {apiKeyVisible ? t('apiKey.hideKey', 'Hide key') : t('apiKey.revealKey', 'Reveal key')}
                </ActionButton>

                <ActionButton onClick={handleCopyApiKey} disabled={!apiKeyInfo}>
                  {apiKeyCopied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-text" aria-hidden />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {t('apiKey.copyToClipboard', 'Copy to clipboard')}
                </ActionButton>

                <ActionButton
                  tone="destructive"
                  onClick={() => setShowRegenerateConfirm(true)}
                  disabled={apiKeyLoading}
                >
                  <RefreshCw
                    className={cn('h-3.5 w-3.5', apiKeyLoading && 'animate-spin motion-reduce:animate-none')}
                    aria-hidden
                  />
                  {t('apiKey.regenerate', 'Regenerate')}
                </ActionButton>
              </div>

              <p className="text-[11.5px] text-surface-400">
                {t(
                  'apiKey.regenerateHint',
                  'Regenerating the key will invalidate the current one immediately.'
                )}
              </p>

              <div className="flex flex-col gap-2 rounded-xl bg-surface-800/45 px-3.5 py-3">
                <p className="font-display text-[12.5px] font-semibold text-surface-200">
                  {t('apiKey.usageTitle', 'Usage')}
                </p>
                <p className="text-xs text-surface-300">
                  {/* Child order must stay text → <code> → text: the stored
                      translation addresses the code element as <1>. */}
                  <Trans i18nKey="apiKey.usageBody" ns="settings">
                    Include the key in the <code className="rounded bg-surface-700/50 px-1.5 py-0.5 font-mono text-[11px] text-accent-text">X-Api-Key</code> header when making API requests from external tools, scripts, or apps like nzb360.
                  </Trans>
                </p>
                <code className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-surface-700/50 bg-surface-900/50 px-3 py-2 font-mono text-[11px] text-surface-300">
                  curl -H &quot;X-Api-Key: {'<your-key>'}&quot; http://{'<host>'}:{'{port}'}/api/health
                </code>
              </div>
            </>
          )}
        </SettingsCard>
      </PanelSection>

      <PanelSection
        id="privacy"
        register={registerSection}
        title={t('nav.sub.privacy', 'Privacy')}
        description={t(
          'privacy.description',
          'What Prunerr sends outside your network, and how to stop it.'
        )}
      >
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-display text-[13.5px] font-semibold text-surface-50">
                {t('privacy.installCountTitle', 'Anonymous install count')}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-surface-400">
                {t(
                  'privacy.installCountBody',
                  'Once a day, Prunerr sends a random ID and its version number so we can see how many installs are out there. Nothing about your library, your settings, your credentials or you is included, and your IP address is not stored. Switching this off deletes the random ID.'
                )}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-surface-400">
                {t(
                  'privacy.announcementsBody',
                  'The same switch controls the announcements shown under What’s new in the sidebar. They are fetched from the same endpoint a few times a day with only the version number attached; with this off, the panel shows built-in release notes only.'
                )}
              </p>
            </div>

            <Toggle
              checked={Boolean(telemetry?.enabled)}
              onChange={handleTelemetryToggle}
              // Also locked when the build carries no endpoint: `enabled` is
              // computed, so flipping the switch would write the setting and
              // then spring straight back to off. A control that cannot change
              // anything should read as disabled rather than ignore the click.
              disabled={
                !telemetry ||
                telemetry.lockedByEnv ||
                !telemetry.endpoint ||
                updateTelemetry.isPending
              }
              label={t('privacy.installCountTitle', 'Anonymous install count')}
            />
          </div>

          {telemetry?.lockedByEnv && (
            <p className="rounded-xl border border-surface-700/80 bg-surface-800/50 px-3.5 py-3 text-xs text-surface-400">
              {t(
                'privacy.lockedByEnv',
                'Turned off for this container by TELEMETRY_ENABLED=false. Nothing is sent, and this switch cannot override it.'
              )}
            </p>
          )}

          {telemetry && !telemetry.lockedByEnv && !telemetry.endpoint && (
            <p className="rounded-xl border border-surface-700/80 bg-surface-800/50 px-3.5 py-3 text-xs text-surface-400">
              {t(
                'privacy.noEndpoint',
                'This build has no telemetry endpoint configured, so nothing is sent regardless of this switch.'
              )}
            </p>
          )}

          {/* The exact payload. Showing it beats describing it: anyone
              suspicious can compare this against their own firewall logs. */}
          {telemetry?.enabled && telemetry.endpoint && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-surface-700/80 bg-surface-800/50 px-3.5 py-3">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-surface-400">
                {t('privacy.exactlyWhatIsSent', 'Exactly what is sent')}
              </p>
              <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed text-surface-300">
{`POST ${telemetry.endpoint}
{
  "installId": "${telemetry.installId ?? t('privacy.notYetGenerated', 'not generated yet')}",
  "version": "${telemetry.version}"
}`}
              </pre>
              {telemetry.lastPingAt && (
                <p className="text-[11.5px] text-surface-400">
                  {t('privacy.lastSent', 'Last sent: {{when}}', {
                    when: new Date(telemetry.lastPingAt).toLocaleString(),
                  })}
                </p>
              )}
            </div>
          )}
        </SettingsCard>
      </PanelSection>

      <PanelSection
        id="backup-restore"
        register={registerSection}
        title={t('nav.sub.backupRestore', 'Backup & restore')}
        description={t(
          'backup.description',
          'Take a full backup before upgrading, or restore one you took earlier'
        )}
      >
        {/* Full database backup — the one that actually protects your data. */}
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          {/* Stacked on a phone: side by side, the buttons keep their width and
              the description collapses to one word per line. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 sm:flex-1">
              <p className="font-display text-[13.5px] font-semibold text-surface-50">
                {t('backup.fullTitle', 'Full backup')}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-surface-400">
                {t(
                  'backup.fullHint',
                  'The entire database — library, rules, queue, history and settings. Restoring replaces everything currently in Prunerr.'
                )}
              </p>
            </div>

            {/* Full width and stacked on a phone: side by side there is not
                enough room for both labels in English, let alone in the longer
                translations, and they wrap inside the buttons. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0 sm:items-center">
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px] w-full sm:w-auto"
                onClick={() => backupInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" aria-hidden />
                {t('backup.restore', 'Restore')}
              </Button>
              <Button
                size="sm"
                className="min-h-[44px] w-full sm:w-auto"
                onClick={handleDownloadBackup}
                isLoading={backupBusy}
              >
                <Download className="h-4 w-4" aria-hidden />
                {t('backup.downloadFull', 'Download backup')}
              </Button>
            </div>
          </div>

          <input
            ref={backupInputRef}
            type="file"
            accept=".db,application/octet-stream"
            onChange={handleRestoreSelect}
            className="hidden"
            aria-hidden
            tabIndex={-1}
          />
        </SettingsCard>

        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 sm:flex-1">
              <p className="font-display text-[13.5px] font-semibold text-surface-50">
                {t('backup.settingsTitle', 'Settings only')}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-surface-400">
                {t(
                  'backup.exportHint',
                  'Connections and preferences as JSON — portable between installs. Does not include your library, rules or history. Contains service credentials, so keep it safe.'
                )}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0 sm:items-center">
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px] w-full sm:w-auto"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" aria-hidden />
                {t('backup.import', 'Import Settings')}
              </Button>
              <Button
                size="sm"
                className="min-h-[44px] w-full sm:w-auto"
                onClick={handleExport}
              >
                <Download className="h-4 w-4" aria-hidden />
                {t('backup.export', 'Export Settings')}
              </Button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
            aria-hidden
            tabIndex={-1}
          />

          {importMutation.isError && !showImportConfirm && (
            <p className="rounded-xl border border-ruby-500/30 bg-ruby-500/10 px-3.5 py-3 text-xs text-ruby-text">
              {t('backup.importFailed', 'Import failed: {{error}}', {
                error:
                  importMutation.error instanceof Error
                    ? importMutation.error.message
                    : t('backup.invalidFormat', 'Invalid file format'),
              })}
            </p>
          )}

          {importMutation.isSuccess && !showImportConfirm && (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-xs text-emerald-text">
              {t(
                'backup.importSuccess',
                'Settings imported successfully! The page will reload with new values.'
              )}
            </p>
          )}
        </SettingsCard>

        <div className="flex items-center justify-between rounded-[14px] border border-surface-700/80 bg-surface-800/40 px-[18px] py-3.5">
          <span className="text-[12.5px] text-surface-400">{t('system.productName', 'Prunerr')}</span>
          <span className="font-mono text-[12.5px] text-surface-300">
            {version ? `v${version}` : '—'}
          </span>
        </div>
      </PanelSection>

      <ConfirmModal
        isOpen={showRegenerateConfirm}
        onClose={() => setShowRegenerateConfirm(false)}
        onConfirm={handleRegenerateApiKey}
        isLoading={apiKeyLoading}
        variant="danger"
        title={t('apiKey.confirmTitle', 'Regenerate API Key?')}
        message={t(
          'apiKey.confirmBody',
          'This will create a new key and immediately invalidate the old one. Any scripts or integrations using the current key will stop working.'
        )}
        confirmText={
          apiKeyLoading
            ? t('apiKey.regenerating', 'Regenerating...')
            : t('apiKey.confirmRegenerate', 'Confirm Regenerate')
        }
        cancelText={t('common.cancel', 'Cancel')}
      />

      <Modal
        isOpen={showImportConfirm}
        onClose={handleImportCancel}
        size="sm"
        title={t('backup.confirmImportTitle', 'Confirm Import')}
      >
        <div className="space-y-6">
          <p className="leading-relaxed text-surface-300">
            <Trans
              i18nKey="backup.confirmImportBody"
              ns="settings"
              values={{ filename: importFile?.name ?? '' }}
            >
              Importing will overwrite all current settings with the values from <strong>{'{{filename}}'}</strong>. This action cannot be undone.
            </Trans>
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" className="min-h-[44px]" onClick={handleImportCancel}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              className="min-h-[44px]"
              onClick={handleImportConfirm}
              isLoading={importMutation.isPending}
            >
              {importMutation.isPending
                ? t('backup.importing', 'Importing...')
                : t('backup.confirmImport', 'Confirm Import')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showRestoreConfirm}
        onClose={() => !restoreBusy && setShowRestoreConfirm(false)}
        size="sm"
        title={t('backup.confirmRestoreTitle', 'Restore this backup?')}
      >
        <div className="space-y-6">
          <p className="leading-relaxed text-surface-300">
            <Trans
              i18nKey="backup.confirmRestoreBody"
              ns="settings"
              values={{ filename: restoreFile?.name ?? '' }}
            >
              Everything currently in Prunerr — library, rules, queue and history — will be replaced by <strong>{'{{filename}}'}</strong>.
            </Trans>
          </p>
          <p className="rounded-xl border border-surface-700/80 bg-surface-800/50 px-3.5 py-3 text-xs text-surface-400">
            {t(
              'backup.confirmRestoreSafety',
              'Your current database is saved alongside it first, so a mistake can be undone from the data folder.'
            )}
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="min-h-[44px]"
              disabled={restoreBusy}
              onClick={() => setShowRestoreConfirm(false)}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button className="min-h-[44px]" onClick={handleRestoreConfirm} isLoading={restoreBusy}>
              {restoreBusy
                ? t('backup.restoring', 'Restoring…')
                : t('backup.confirmRestore', 'Replace my data')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
