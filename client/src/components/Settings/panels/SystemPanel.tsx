import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, Copy, Download, Eye, EyeOff, RefreshCw, Upload } from 'lucide-react';

import { apiKeyApi, type ApiKeyInfo } from '@/services/api';
import { useImportSettings, useVersion } from '@/hooks/useApi';
import { useToast } from '@/components/common/Toast';
import { ConfirmModal, Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { cn } from '@/lib/utils';

import { PanelSection } from '../components/PanelSection';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsEmptyState } from '../components/SettingsEmptyState';
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
          ? 'border-ruby-500/30 bg-ruby-500/[0.14] text-ruby-400 hover:bg-ruby-500/20'
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

              <div className="flex flex-wrap items-center gap-2">
                <code
                  aria-label={t('apiKey.yourKey', 'Your API Key')}
                  className="min-w-0 flex-1 truncate rounded-[11px] border border-surface-600/60 bg-surface-800/70 px-3 py-3 font-mono text-[12.5px] tracking-[0.04em] text-surface-300"
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
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
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
        id="backup-restore"
        register={registerSection}
        title={t('nav.sub.backupRestore', 'Backup & restore')}
        description={t(
          'backup.description',
          'Export settings for backup or import from a previous export'
        )}
      >
        <SettingsCard className="flex flex-col gap-3.5 px-[18px] py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-[12.5px] text-surface-400">
              {t(
                'backup.exportHint',
                'Exports include all settings including service credentials. Keep the file secure.'
              )}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" aria-hidden />
                {t('backup.import', 'Import Settings')}
              </Button>
              <Button size="sm" className="min-h-[44px]" onClick={handleExport}>
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
            <p className="rounded-xl border border-ruby-500/30 bg-ruby-500/10 px-3.5 py-3 text-xs text-ruby-400">
              {t('backup.importFailed', 'Import failed: {{error}}', {
                error:
                  importMutation.error instanceof Error
                    ? importMutation.error.message
                    : t('backup.invalidFormat', 'Invalid file format'),
              })}
            </p>
          )}

          {importMutation.isSuccess && !showImportConfirm && (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-xs text-emerald-400">
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
    </>
  );
}
