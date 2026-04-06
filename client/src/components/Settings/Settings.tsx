import { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Bell,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Save,
  RefreshCw,
  ExternalLink,
  Settings as SettingsIcon,
  Copy,
  Check,
  Monitor,
  Download,
  Upload,
  FileUp,
  AlertTriangle,
  Shield,
  Plus,
  Trash2,
  Library,
  Film,
  Tv,
  FolderX,
  Eye,
  KeyRound,
  EyeOff,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/common/Toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSettings,
  useSaveSettings,
  useTestConnection,
  useImportSettings,
} from '@/hooks/useApi';
import { apiKeyApi, type ApiKeyInfo } from '@/services/api';
import type { Settings as SettingsType, ServiceConnection, DisplaySettings } from '@/types';
import { useDisplayPreferences } from '@/contexts/DisplayPreferencesContext';

type ServiceField = 'url' | 'apiKey' | 'token';
type ServiceKeyType = 'plex' | 'tautulli' | 'tracearr' | 'sonarr' | 'radarr' | 'overseerr' | 'unraid';
type WatchHistoryProviderType = 'tautulli' | 'tracearr';

interface ServiceConfig {
  key: ServiceKeyType;
  name: string;
  description: string;
  fields: ServiceField[];
  required: boolean;
  defaultPort: string;
}

const SERVICES: ServiceConfig[] = [
  {
    key: 'plex',
    name: 'Plex',
    description: 'Media server for library data',
    fields: ['url', 'token'],
    required: true,
    defaultPort: '32400',
  },
  {
    key: 'sonarr',
    name: 'Sonarr',
    description: 'TV show management and deletion',
    fields: ['url', 'apiKey'],
    required: false,
    defaultPort: '8989',
  },
  {
    key: 'radarr',
    name: 'Radarr',
    description: 'Movie management and deletion',
    fields: ['url', 'apiKey'],
    required: false,
    defaultPort: '7878',
  },
  {
    key: 'overseerr',
    name: 'Seerr',
    description: 'Request management integration',
    fields: ['url', 'apiKey'],
    required: false,
    defaultPort: '5055',
  },
  {
    key: 'unraid',
    name: 'Unraid',
    description: 'Server storage monitoring via GraphQL API',
    fields: ['url', 'apiKey'],
    required: false,
    defaultPort: '443',
  },
] as const;

const WATCH_HISTORY_PROVIDERS = {
  tautulli: {
    key: 'tautulli' as const,
    name: 'Tautulli',
    description: 'Plex monitoring and statistics (Tautulli/Plexpy)',
    defaultPort: '8181',
    fieldLabel: 'API Key',
  },
  tracearr: {
    key: 'tracearr' as const,
    name: 'Tracearr',
    description: 'Plex/Jellyfin/Emby monitoring tool',
    defaultPort: '3004',
    fieldLabel: 'API Token',
  },
};

type ServiceKey = ServiceKeyType;

export default function Settings() {
  const { data: settings, isLoading, isError, error, refetch } = useSettings();
  const saveMutation = useSaveSettings();
  const testMutation = useTestConnection();
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [localSettings, setLocalSettings] = useState<Partial<SettingsType>>({});
  const [testResults, setTestResults] = useState<Record<string, { status: 'success' | 'error' | 'loading'; message?: string }>>({});
  const [autoTestRan, setAutoTestRan] = useState(false);

  // Watch History Provider state
  const [watchHistoryProvider, setWatchHistoryProvider] = useState<WatchHistoryProviderType>('tautulli');
  const [watchHistoryProviderLoaded, setWatchHistoryProviderLoaded] = useState(false);

  // Import/Export state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const importMutation = useImportSettings();

  // Exclusion patterns state
  interface ExclusionPattern {
    field: 'title' | 'type';
    operator: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'regex';
    value: string;
  }
  const [exclusionPatterns, setExclusionPatterns] = useState<ExclusionPattern[]>([]);
  const [exclusionPatternsLoaded, setExclusionPatternsLoaded] = useState(false);

  // Load exclusion patterns from main settings response
  useEffect(() => {
    if (settings && !exclusionPatternsLoaded) {
      setExclusionPatternsLoaded(true);
      if (settings.exclusionPatterns && settings.exclusionPatterns.length > 0) {
        setExclusionPatterns(settings.exclusionPatterns as ExclusionPattern[]);
      }
    }
  }, [settings, exclusionPatternsLoaded]);

  // Load watch history provider setting
  useEffect(() => {
    if (settings && !watchHistoryProviderLoaded) {
      setWatchHistoryProviderLoaded(true);
      // Determine which provider is configured based on existing settings
      if (settings.services?.tracearr?.url && settings.services?.tracearr?.apiKey) {
        setWatchHistoryProvider('tracearr');
      } else {
        setWatchHistoryProvider('tautulli');
      }
    }
  }, [settings, watchHistoryProviderLoaded]);

  const handleAddPattern = useCallback(() => {
    setExclusionPatterns((prev) => [...prev, { field: 'title', operator: 'contains', value: '' }]);
  }, []);

  const handleRemovePattern = useCallback((index: number) => {
    setExclusionPatterns((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePatternChange = useCallback((index: number, updates: Partial<ExclusionPattern>) => {
    setExclusionPatterns((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...updates } : p))
    );
  }, []);

  const handleSavePatterns = useCallback(async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'exclusion_patterns',
          value: JSON.stringify(exclusionPatterns.filter((p) => p.value.trim())),
        }),
      });
    } catch (error) {
      console.error('Failed to save exclusion patterns:', error);
    }
  }, [exclusionPatterns]);

  // Library exclusion state
  interface PlexLibraryInfo {
    key: string;
    title: string;
    type: string;
    excluded: boolean;
  }
  const [plexLibraries, setPlexLibraries] = useState<PlexLibraryInfo[]>([]);
  const [librariesLoading, setLibrariesLoading] = useState(false);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);

  const fetchPlexLibraries = useCallback(async () => {
    setLibrariesLoading(true);
    try {
      const r = await fetch('/api/library/plex-libraries');
      if (r.ok) {
        const data = await r.json();
        if (data.success) {
          setPlexLibraries(data.data);
        }
      }
    } catch { /* empty */ }
    finally { setLibrariesLoading(false); }
  }, []);

  // Auto-fetch libraries once Plex is configured
  useEffect(() => {
    if (settings?.services?.plex?.url && settings?.services?.plex?.token && !librariesLoaded) {
      setLibrariesLoaded(true);
      fetchPlexLibraries();
    }
  }, [settings, librariesLoaded, fetchPlexLibraries]);

  const handleToggleLibrary = useCallback((key: string) => {
    setPlexLibraries((prev) =>
      prev.map((lib) => lib.key === key ? { ...lib, excluded: !lib.excluded } : lib)
    );
    setLibraryExclusionsDirty(true);
  }, []);

  const handleSaveLibraryExclusions = useCallback(async () => {
    const excludedKeys = plexLibraries.filter((lib) => lib.excluded).map((lib) => lib.key);
    try {
      const r = await fetch('/api/library/plex-libraries/exclusions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludedKeys }),
      });
      const data = await r.json();
      if (data.data?.removedItems > 0) {
        addToast({ type: 'info', title: 'Libraries excluded', message: `Removed ${data.data.removedItems} items from excluded libraries` });
      }
      // Always refresh library and stats data
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to save', message: 'Could not save library exclusions' });
    }
  }, [plexLibraries, addToast, queryClient]);

  // API Key state
  const [apiKeyInfo, setApiKeyInfo] = useState<ApiKeyInfo | null>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  // Fetch API key info on mount
  useEffect(() => {
    apiKeyApi.get().then(setApiKeyInfo).catch(() => {
      // API key feature not available
    });
  }, []);


  const handleRegenerateApiKey = useCallback(async () => {
    setApiKeyLoading(true);
    try {
      const result = await apiKeyApi.regenerate();
      setApiKeyInfo(result);
      setShowRegenerateConfirm(false);
      setApiKeyVisible(true);
      addToast({
        type: 'success',
        title: 'API key regenerated',
        message: 'Any scripts or integrations using the old key will need to be updated.',
      });
    } catch {
      addToast({ type: 'error', title: 'Failed to regenerate API key' });
    } finally {
      setApiKeyLoading(false);
    }
  }, [addToast]);

  const handleCopyApiKey = useCallback(async () => {
    if (!apiKeyInfo?.apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKeyInfo.apiKey);
      setApiKeyCopied(true);
      setTimeout(() => setApiKeyCopied(false), 2000);
    } catch {
      addToast({ type: 'error', title: 'Failed to copy to clipboard' });
    }
  }, [apiKeyInfo, addToast]);

  // Discord test state
  const [discordTestResult, setDiscordTestResult] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });

  // Merge loaded settings with local changes
  const currentSettings = { ...settings, ...localSettings };

  // Auto-test configured services on page load
  useEffect(() => {
    if (settings && !autoTestRan && !isLoading) {
      setAutoTestRan(true);

      // Test each service that has credentials configured
      SERVICES.forEach((service) => {
        const config = settings.services?.[service.key];
        if (config?.url && (config?.apiKey || config?.token)) {
          // Run test in background
          setTestResults((prev) => ({ ...prev, [service.key]: { status: 'loading' } }));

          testMutation.mutateAsync({ service: service.key, config })
            .then(() => {
              setTestResults((prev) => ({ ...prev, [service.key]: { status: 'success', message: 'Connected' } }));
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : 'Connection failed';
              setTestResults((prev) => ({ ...prev, [service.key]: { status: 'error', message } }));
            });
        }
      });

      // Test watch history provider (tautulli or tracearr)
      const whpKey = (settings.services?.tracearr?.url && settings.services?.tracearr?.apiKey) ? 'tracearr' : 'tautulli';
      const whpConfig = settings.services?.[whpKey];
      if (whpConfig?.url && whpConfig?.apiKey) {
        setTestResults((prev) => ({ ...prev, [whpKey]: { status: 'loading' } }));
        testMutation.mutateAsync({ service: whpKey, config: whpConfig })
          .then(() => {
            setTestResults((prev) => ({ ...prev, [whpKey]: { status: 'success', message: 'Connected' } }));
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : 'Connection failed';
            setTestResults((prev) => ({ ...prev, [whpKey]: { status: 'error', message } }));
          });
      }
    }
  }, [settings, isLoading, autoTestRan, testMutation]);

  const handleFieldChange = (
    service: ServiceKey,
    field: string,
    value: string
  ) => {
    setLocalSettings((prev) => ({
      ...prev,
      services: {
        ...prev.services,
        ...currentSettings.services,
        [service]: {
          ...(currentSettings.services?.[service] || {}),
          [field]: value,
        },
      },
    }));
  };

  const handleTestConnection = async (service: ServiceKey) => {
    setTestResults((prev) => ({ ...prev, [service]: { status: 'loading' } }));

    try {
      const serviceConfig = currentSettings.services?.[service];
      if (!serviceConfig) {
        setTestResults((prev) => ({ ...prev, [service]: { status: 'error', message: 'No configuration found' } }));
        return;
      }

      await testMutation.mutateAsync({ service, config: serviceConfig });
      setTestResults((prev) => ({ ...prev, [service]: { status: 'success', message: 'Connected successfully' } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      setTestResults((prev) => ({ ...prev, [service]: { status: 'error', message } }));
    }
  };

  const handleSave = async () => {
    // Save exclusion patterns and library exclusions alongside settings
    handleSavePatterns();
    handleSaveLibraryExclusions();

    // Persist watch history settings
    try {
      await fetch('/api/settings/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { key: 'watch_history_provider', value: watchHistoryProvider },
          { key: 'watch_history_lookback_days', value: String(currentSettings.schedule?.historyLookbackDays ?? 365) },
        ]),
      });
    } catch (error) {
      console.error('Failed to save watch history settings:', error);
    }

    saveMutation.mutate(currentSettings as SettingsType, {
      onSuccess: () => {
        setLocalSettings({});
        setLibraryExclusionsDirty(false);
        setWatchHistoryDirty(false);
        refetch();
      },
    });
  };

  // Track if library exclusions or watch history provider have been changed
  const [libraryExclusionsDirty, setLibraryExclusionsDirty] = useState(false);
  const [watchHistoryDirty, setWatchHistoryDirty] = useState(false);
  const hasPendingChanges = Object.keys(localSettings).length > 0 || libraryExclusionsDirty || watchHistoryDirty;

  const handleWatchHistoryProviderChange = (provider: WatchHistoryProviderType) => {
    setWatchHistoryProvider(provider);
    setWatchHistoryDirty(true);
  };

  const handleNotificationChange = (field: keyof NonNullable<SettingsType['notifications']>, value: boolean | string) => {
    setLocalSettings((prev) => ({
      ...prev,
      notifications: {
        discordEnabled: prev.notifications?.discordEnabled ?? currentSettings.notifications?.discordEnabled ?? false,
        discordWebhook: prev.notifications?.discordWebhook ?? currentSettings.notifications?.discordWebhook,
        scanNotify: prev.notifications?.scanNotify ?? currentSettings.notifications?.scanNotify ?? 'flagged_only',
        notifyOnQueue: prev.notifications?.notifyOnQueue ?? currentSettings.notifications?.notifyOnQueue ?? true,
        notifyBeforeDeletion: prev.notifications?.notifyBeforeDeletion ?? currentSettings.notifications?.notifyBeforeDeletion ?? true,
        notifyOnDeletion: prev.notifications?.notifyOnDeletion ?? currentSettings.notifications?.notifyOnDeletion ?? true,
        [field]: value,
      },
    }));
  };

  const handleTestDiscord = async () => {
    const webhookUrl = currentSettings.notifications?.discordWebhook;
    if (!webhookUrl) {
      setDiscordTestResult({ status: 'error', message: 'Enter a webhook URL first' });
      return;
    }

    setDiscordTestResult({ status: 'loading' });

    try {
      const response = await fetch('/api/settings/test/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      });

      const data = await response.json();

      if (data.success) {
        setDiscordTestResult({ status: 'success', message: data.message });
      } else {
        setDiscordTestResult({ status: 'error', message: data.error || 'Test failed' });
      }
    } catch (error) {
      setDiscordTestResult({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to send test'
      });
    }

    // Clear result after 5 seconds
    setTimeout(() => setDiscordTestResult({ status: 'idle' }), 5000);
  };

  const handleScheduleChange = (field: keyof NonNullable<SettingsType['schedule']>, value: string | number | boolean) => {
    setLocalSettings((prev) => ({
      ...prev,
      schedule: {
        enabled: prev.schedule?.enabled ?? currentSettings.schedule?.enabled ?? false,
        interval: prev.schedule?.interval ?? currentSettings.schedule?.interval ?? 'daily',
        time: prev.schedule?.time ?? currentSettings.schedule?.time ?? '00:00',
        dayOfWeek: prev.schedule?.dayOfWeek ?? currentSettings.schedule?.dayOfWeek ?? 0,
        autoProcess: prev.schedule?.autoProcess ?? currentSettings.schedule?.autoProcess ?? false,
        [field]: value,
      },
    }));
  };

  // Export/Import handlers
  const handleExport = async () => {
    try {
      const response = await fetch('/api/settings/export');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prunerr-settings.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setShowImportConfirm(true);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleImportConfirm = async () => {
    if (!importFile) return;

    try {
      const text = await importFile.text();
      const data = JSON.parse(text);
      await importMutation.mutateAsync(data);
      setShowImportConfirm(false);
      setImportFile(null);
      // Trigger refetch to update UI with new settings
      refetch();
    } catch (error) {
      console.error('Import failed:', error);
    }
  };

  const handleImportCancel = () => {
    setShowImportConfirm(false);
    setImportFile(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
          <p className="text-surface-400">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-8 pb-8">
        <header className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-accent-500/5 via-transparent to-violet-500/5 rounded-3xl" />
          <div className="relative px-8 py-10">
            <h1 className="text-4xl font-display font-bold text-white tracking-tight">
              Settings
            </h1>
            <p className="text-surface-400 mt-2">
              Configure your services and preferences
            </p>
          </div>
        </header>
        <ErrorState
          error={error as Error}
          title="Failed to load settings"
          retry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <header className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-500/5 via-transparent to-violet-500/5 rounded-3xl" />
        <div className="relative px-4 py-6 sm:px-8 sm:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-accent-400 mb-2 flex items-center gap-2">
                <SettingsIcon className="w-4 h-4" />
                Configuration
              </p>
              <h1 className="text-2xl sm:text-4xl font-display font-bold text-white tracking-tight">
                Settings
              </h1>
              <p className="text-surface-400 mt-2">
                Configure service connections and preferences
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Floating Save Pill */}
      {hasPendingChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-up" style={{ animationFillMode: 'forwards' }}>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium shadow-lg shadow-accent-500/25 transition-all disabled:opacity-70"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Service Connections */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-500/10">
              <Server className="w-5 h-5 text-accent-400" />
            </div>
            <div>
              <CardTitle>Service Connections</CardTitle>
              <CardDescription>Connect to your media management services</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {SERVICES.map((service) => (
            <ServiceConnectionForm
              key={service.key}
              service={service}
              config={currentSettings.services?.[service.key]}
              testResult={testResults[service.key]}
              onFieldChange={(field, value) =>
                handleFieldChange(service.key, field, value)
              }
              onTest={() => handleTestConnection(service.key)}
            />
          ))}
        </CardContent>
      </Card>

      {/* Watch History Provider */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Eye className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <CardTitle>Watch History Provider</CardTitle>
              <CardDescription>Connect a watch history service for tracking play counts and watched status</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Provider Toggle */}
          <div className="flex gap-2">
            {(Object.keys(WATCH_HISTORY_PROVIDERS) as WatchHistoryProviderType[]).map((providerKey) => {
              const provider = WATCH_HISTORY_PROVIDERS[providerKey];
              const isSelected = watchHistoryProvider === providerKey;
              return (
                <button
                  key={providerKey}
                  onClick={() => handleWatchHistoryProviderChange(providerKey)}
                  className={cn(
                    'flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all border',
                    isSelected
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                      : 'bg-surface-800/40 border-surface-700/30 text-surface-400 hover:text-surface-200 hover:border-surface-600/50'
                  )}
                >
                  {provider.name}
                </button>
              );
            })}
          </div>

          {/* Provider Configuration */}
          {(() => {
            const provider = WATCH_HISTORY_PROVIDERS[watchHistoryProvider];
            const serviceKey = watchHistoryProvider;
            const config = currentSettings.services?.[serviceKey];
            const testResult = testResults[serviceKey];

            return (
              <div className="p-5 rounded-xl bg-surface-800/40 border border-surface-700/30">
                <div className="mb-4">
                  <h3 className="font-display font-semibold text-white">{provider.name}</h3>
                  <p className="text-sm text-surface-400 mt-1">{provider.description}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="URL"
                    type="url"
                    value={config?.url || ''}
                    onChange={(e) => handleFieldChange(serviceKey, 'url', e.target.value)}
                    placeholder={`http://localhost:${provider.defaultPort}`}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                  />
                  <Input
                    label={provider.fieldLabel}
                    type="password"
                    value={config?.apiKey || ''}
                    onChange={(e) => handleFieldChange(serviceKey, 'apiKey', e.target.value)}
                    placeholder={`Enter ${provider.fieldLabel.toLowerCase()}`}
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                  />
                </div>

                <div className="flex items-center justify-between mt-5 pt-5 border-t border-surface-700/30">
                  <div className="flex items-center gap-2 min-h-[24px]">
                    {testResult?.status === 'success' && (
                      <div className="flex items-center gap-2 text-emerald-400">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-sm font-medium">Connected successfully</span>
                      </div>
                    )}
                    {testResult?.status === 'error' && (
                      <div className="flex items-start gap-2 text-ruby-400 max-w-md">
                        <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span className="text-sm whitespace-pre-line">{testResult.message || 'Connection failed'}</span>
                      </div>
                    )}
                    {testResult?.status === 'loading' && (
                      <div className="flex items-center gap-2 text-accent-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Verifying connection...</span>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleTestConnection(serviceKey)}
                    disabled={!config?.url || testResult?.status === 'loading'}
                  >
                    {testResult?.status === 'loading' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Test Connection
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* History Lookback */}
          <div className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-white">History Lookback</p>
                <p className="text-sm text-surface-400 mt-0.5">
                  How far back to fetch watch history data
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={30}
                  max={3650}
                  value={currentSettings.schedule?.historyLookbackDays ?? 365}
                  onChange={(e) => handleScheduleChange('historyLookbackDays', Math.max(30, parseInt(e.target.value) || 365))}
                  className="w-20 px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-center focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                />
                <span className="text-sm text-surface-400">days</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10">
              <Bell className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Configure alerts for deletions and events</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Discord */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
            <div>
              <p className="font-medium text-white">Discord Webhook</p>
              <p className="text-sm text-surface-400 mt-0.5">
                Send notifications to a Discord channel
              </p>
            </div>
            <ToggleSwitch
              checked={currentSettings.notifications?.discordEnabled || false}
              onChange={(checked) => handleNotificationChange('discordEnabled', checked)}
            />
          </div>

          {currentSettings.notifications?.discordEnabled && (
            <div className="pl-4 border-l-2 border-violet-500/30 space-y-4">
              <Input
                label="Webhook URL"
                type="url"
                value={currentSettings.notifications?.discordWebhook || ''}
                onChange={(e) => handleNotificationChange('discordWebhook', e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
              />

              <div className="flex items-center gap-4">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleTestDiscord}
                  disabled={!currentSettings.notifications?.discordWebhook || discordTestResult.status === 'loading'}
                >
                  {discordTestResult.status === 'loading' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Bell className="w-4 h-4" />
                      Test Notification
                    </>
                  )}
                </Button>

                {discordTestResult.status === 'success' && (
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">{discordTestResult.message}</span>
                  </div>
                )}

                {discordTestResult.status === 'error' && (
                  <div className="flex items-center gap-2 text-ruby-400">
                    <XCircle className="w-4 h-4" />
                    <span className="text-sm">{discordTestResult.message}</span>
                  </div>
                )}
              </div>

              {/* Scan Notifications */}
              <div className="pt-4 border-t border-surface-700/30">
                <p className="font-medium text-white mb-3">Scan Notifications</p>
                <div className="space-y-2">
                  {([
                    { value: 'always', label: 'Always notify after scan' },
                    { value: 'flagged_only', label: 'Only when items are flagged' },
                    { value: 'never', label: 'Never' },
                  ] as const).map((option) => (
                    <label key={option.value} className="flex items-center gap-3 cursor-pointer group">
                      <input
                        type="radio"
                        name="scanNotify"
                        value={option.value}
                        checked={(currentSettings.notifications?.scanNotify ?? 'flagged_only') === option.value}
                        onChange={() => handleNotificationChange('scanNotify', option.value)}
                        className="w-4 h-4 text-accent-500 bg-surface-800 border-surface-600 focus:ring-accent-500/50"
                      />
                      <span className="text-sm text-surface-300 group-hover:text-white transition-colors">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Deletion Notifications */}
              <div className="pt-4 border-t border-surface-700/30">
                <p className="font-medium text-white mb-3">Deletion Notifications</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-surface-300">Notify when items are queued</p>
                    <ToggleSwitch
                      checked={currentSettings.notifications?.notifyOnQueue ?? true}
                      onChange={(checked) => handleNotificationChange('notifyOnQueue', checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-surface-300">Notify before items are deleted</p>
                    <ToggleSwitch
                      checked={currentSettings.notifications?.notifyBeforeDeletion ?? true}
                      onChange={(checked) => handleNotificationChange('notifyBeforeDeletion', checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-surface-300">Notify after items are deleted</p>
                    <ToggleSwitch
                      checked={currentSettings.notifications?.notifyOnDeletion ?? true}
                      onChange={(checked) => handleNotificationChange('notifyOnDeletion', checked)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scan Schedule */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Clock className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <CardTitle>Scan Schedule</CardTitle>
              <CardDescription>Automate library scanning and cleanup</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Auto Scan */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
            <div>
              <p className="font-medium text-white">Automatic Scanning</p>
              <p className="text-sm text-surface-400 mt-0.5">
                Automatically scan library for items matching rules
              </p>
            </div>
            <ToggleSwitch
              checked={currentSettings.schedule?.enabled || false}
              onChange={(checked) => handleScheduleChange('enabled', checked)}
            />
          </div>

          {currentSettings.schedule?.enabled && (
            <div className={cn(
              'grid gap-4 pl-4 border-l-2 border-emerald-500/30',
              currentSettings.schedule?.interval === 'weekly'
                ? 'grid-cols-1 md:grid-cols-3'
                : 'grid-cols-1 md:grid-cols-2'
            )}>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-surface-200">
                  Scan Interval
                </label>
                <select
                  value={currentSettings.schedule?.interval || 'daily'}
                  onChange={(e) => handleScheduleChange('interval', e.target.value)}
                  className="select"
                >
                  <option value="hourly">Every hour (at :00)</option>
                  <option value="daily">Once per day</option>
                  <option value="weekly">Once per week</option>
                </select>
              </div>
              {currentSettings.schedule?.interval === 'weekly' && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-surface-200">
                    Day of Week
                  </label>
                  <select
                    value={currentSettings.schedule?.dayOfWeek ?? 0}
                    onChange={(e) => handleScheduleChange('dayOfWeek', parseInt(e.target.value))}
                    className="select"
                  >
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <Input
                  label="Scan Time"
                  type="time"
                  value={currentSettings.schedule?.time || '03:00'}
                  onChange={(e) => handleScheduleChange('time', e.target.value)}
                />
                <p className="text-xs text-surface-500">
                  {currentSettings.schedule?.interval === 'hourly'
                    ? 'Scan will run at this minute past each hour'
                    : 'Scan will run at this time'}
                </p>
              </div>
            </div>
          )}

          {/* Auto Process */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
            <div>
              <p className="font-medium text-white">Auto-Process Queue</p>
              <p className="text-sm text-surface-400 mt-0.5">
                Automatically delete items after grace period expires
              </p>
            </div>
            <ToggleSwitch
              checked={currentSettings.schedule?.autoProcess || false}
              onChange={(checked) => handleScheduleChange('autoProcess', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Library Exclusions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Library className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <CardTitle>Library Exclusions</CardTitle>
                <CardDescription>Choose which Plex libraries to include in scans. Excluded libraries will be completely skipped.</CardDescription>
              </div>
            </div>
            <button
              onClick={fetchPlexLibraries}
              disabled={librariesLoading}
              className="p-2 rounded-lg text-surface-400 hover:text-accent-400 hover:bg-accent-500/10 transition-colors disabled:opacity-50"
              title="Refresh libraries from Plex"
            >
              <RefreshCw className={cn('w-4 h-4', librariesLoading && 'animate-spin')} />
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {librariesLoading && plexLibraries.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-surface-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading libraries from Plex...</span>
            </div>
          ) : plexLibraries.length === 0 ? (
            <div className="text-center py-6">
              <FolderX className="w-8 h-8 text-surface-600 mx-auto mb-2" />
              <p className="text-sm text-surface-400">No libraries found. Make sure Plex is configured and connected.</p>
            </div>
          ) : (
            <>
              {plexLibraries.map((lib) => {
                const TypeIcon = lib.type === 'movie' ? Film : lib.type === 'show' ? Tv : Library;
                const typeBadgeColor = lib.type === 'movie'
                  ? 'bg-violet-500/10 text-violet-400'
                  : lib.type === 'show'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-surface-600/50 text-surface-300';

                return (
                  <div
                    key={lib.key}
                    className={cn(
                      'flex items-center justify-between p-4 rounded-xl border transition-colors',
                      lib.excluded
                        ? 'bg-ruby-500/5 border-ruby-500/20'
                        : 'bg-surface-800/40 border-surface-700/30'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <TypeIcon className={cn('w-4 h-4', lib.excluded ? 'text-surface-600' : 'text-surface-300')} />
                      <div>
                        <p className={cn('font-medium', lib.excluded ? 'text-surface-500 line-through' : 'text-white')}>
                          {lib.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn('text-2xs px-1.5 py-0.5 rounded font-medium', typeBadgeColor)}>
                            {lib.type}
                          </span>
                          {lib.excluded && (
                            <span className="text-2xs text-ruby-400">Excluded</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ToggleSwitch
                      checked={!lib.excluded}
                      onChange={() => handleToggleLibrary(lib.key)}
                    />
                  </div>
                );
              })}

              <p className="text-xs text-surface-500 pt-2">
                {plexLibraries.filter((l) => !l.excluded).length} of {plexLibraries.length} libraries included in scans
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Exclusion Patterns */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <CardTitle>Exclusion Patterns</CardTitle>
              <CardDescription>Items matching these patterns will be automatically protected from deletion during scans</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {exclusionPatterns.map((pattern, index) => (
            <div key={index} className="flex items-center gap-3 p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                <select
                  value={pattern.field}
                  onChange={(e) => handlePatternChange(index, { field: e.target.value as 'title' | 'type' })}
                  className="select"
                >
                  <option value="title">Title</option>
                  <option value="type">Type</option>
                </select>
                <select
                  value={pattern.operator}
                  onChange={(e) => handlePatternChange(index, { operator: e.target.value as ExclusionPattern['operator'] })}
                  className="select"
                >
                  <option value="contains">Contains</option>
                  <option value="equals">Equals</option>
                  <option value="starts_with">Starts with</option>
                  <option value="ends_with">Ends with</option>
                  <option value="regex">Regex</option>
                </select>
                <Input
                  value={pattern.value}
                  onChange={(e) => handlePatternChange(index, { value: e.target.value })}
                  placeholder={pattern.field === 'type' ? 'movie or show' : 'Pattern to match...'}
                />
              </div>
              <button
                onClick={() => handleRemovePattern(index)}
                className="p-2 rounded-lg text-surface-400 hover:text-ruby-400 hover:bg-ruby-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

          <Button variant="secondary" onClick={handleAddPattern}>
            <Plus className="w-4 h-4" />
            Add Pattern
          </Button>

          {exclusionPatterns.length > 0 && (
            <p className="text-xs text-surface-500">
              {exclusionPatterns.filter((p) => p.value.trim()).length} active pattern{exclusionPatterns.filter((p) => p.value.trim()).length !== 1 ? 's' : ''}. Items matching any pattern will be skipped during rule evaluation.
            </p>
          )}
        </CardContent>
      </Card>

      {/* API Key Authentication */}
      {apiKeyInfo && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <KeyRound className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <CardTitle>API Key</CardTitle>
                <CardDescription>Required for external API access (scripts, nzb360, etc.). The web UI does not need it.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* API Key Display */}
            <div className="p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
              <div className="flex items-center justify-between mb-3">
                <p className="font-medium text-white">Your API Key</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setApiKeyVisible(!apiKeyVisible)}
                    className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700/50 transition-colors"
                    title={apiKeyVisible ? 'Hide key' : 'Reveal key'}
                  >
                    {apiKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handleCopyApiKey}
                    className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700/50 transition-colors"
                    title="Copy to clipboard"
                  >
                    {apiKeyCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-900/50 border border-surface-700/50 font-mono text-sm">
                <code className="flex-1 break-all text-surface-300">
                  {apiKeyVisible ? apiKeyInfo.apiKey : '\u2022'.repeat(32)}
                </code>
              </div>
            </div>

            {/* Regenerate */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-surface-400">
                Regenerating the key will invalidate the current one immediately.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowRegenerateConfirm(true)}
                disabled={apiKeyLoading}
              >
                <RefreshCw className={cn('w-4 h-4', apiKeyLoading && 'animate-spin')} />
                Regenerate
              </Button>
            </div>

            {/* Regenerate Confirmation */}
            {showRegenerateConfirm && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-white">Regenerate API Key?</p>
                    <p className="text-sm text-surface-400 mt-1">
                      This will create a new key and immediately invalidate the old one. Any scripts or integrations using the current key will stop working.
                    </p>
                    <div className="flex gap-3 mt-4">
                      <Button
                        onClick={handleRegenerateApiKey}
                        disabled={apiKeyLoading}
                        size="sm"
                      >
                        {apiKeyLoading ? 'Regenerating...' : 'Confirm Regenerate'}
                      </Button>
                      <Button
                        onClick={() => setShowRegenerateConfirm(false)}
                        variant="ghost"
                        size="sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Usage Help */}
            <div className="p-4 rounded-xl bg-surface-800/30 border border-surface-700/20">
              <p className="text-sm font-medium text-surface-200 mb-2">Usage</p>
              <p className="text-sm text-surface-400 mb-3">
                Include the key in the <code className="text-xs bg-surface-700/50 px-1.5 py-0.5 rounded font-mono">X-Api-Key</code> header when making API requests from external tools, scripts, or apps like nzb360.
              </p>
              <div className="p-3 rounded-lg bg-surface-900/50 border border-surface-700/50">
                <code className="text-xs text-surface-300 font-mono whitespace-pre-wrap break-all">
                  curl -H &quot;X-Api-Key: {'<your-key>'}&quot; http://{'<host>'}:{'{port}'}/api/health
                </code>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Display Preferences */}
      <DisplayPreferencesCard />

      {/* Backup & Restore */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <FileUp className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <CardTitle>Backup & Restore</CardTitle>
              <CardDescription>Export settings for backup or import from a previous export</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Export Button */}
            <Button onClick={handleExport} variant="secondary" className="flex-1">
              <Download className="w-4 h-4" />
              Export Settings
            </Button>

            {/* Import Button (hidden file input) */}
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => document.getElementById('import-file')?.click()}
            >
              <Upload className="w-4 h-4" />
              Import Settings
            </Button>
            <input
              id="import-file"
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <p className="text-xs text-surface-500">
            Exports include all settings including service credentials. Keep the file secure.
          </p>

          {/* Import Confirmation Dialog */}
          {showImportConfirm && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-white">Confirm Import</p>
                  <p className="text-sm text-surface-400 mt-1">
                    Importing will overwrite all current settings with the values from <strong>{importFile?.name}</strong>. This action cannot be undone.
                  </p>
                  <div className="flex gap-3 mt-4">
                    <Button
                      onClick={handleImportConfirm}
                      disabled={importMutation.isPending}
                      size="sm"
                    >
                      {importMutation.isPending ? 'Importing...' : 'Confirm Import'}
                    </Button>
                    <Button
                      onClick={handleImportCancel}
                      variant="ghost"
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Import Error */}
          {importMutation.isError && !showImportConfirm && (
            <div className="p-4 rounded-xl bg-ruby-500/10 border border-ruby-500/30">
              <p className="text-sm text-ruby-400">
                Import failed: {importMutation.error instanceof Error ? importMutation.error.message : 'Invalid file format'}
              </p>
            </div>
          )}

          {/* Import Success */}
          {importMutation.isSuccess && !showImportConfirm && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <p className="text-sm text-emerald-400">
                Settings imported successfully! The page will reload with new values.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900',
        checked ? 'bg-accent-500' : 'bg-surface-600'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transform ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}

// Unraid API Key Template - creates key with viewer role (read-only access)
const UNRAID_API_KEY_TEMPLATE = '?name=Prunerr&scopes=role%3Aviewer';

function UnraidApiKeyHelper() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(UNRAID_API_KEY_TEMPLATE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className="mt-4 p-4 rounded-lg bg-surface-900/50 border border-surface-700/50">
      <h4 className="text-sm font-medium text-white mb-2">How to create an API key</h4>
      <ol className="text-sm text-surface-400 space-y-2 mb-4 list-decimal list-inside">
        <li>Go to your Unraid server: <strong>Settings → Management Access → API</strong></li>
        <li>Click <strong>"Add API Key"</strong></li>
        <li>Click <strong>"Create from Template"</strong></li>
        <li>Paste the template below and click <strong>"Continue"</strong></li>
        <li>Copy the generated API key and paste it above</li>
      </ol>

      <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-800/50 border border-surface-600/50">
        <div className="flex-1">
          <p className="text-xs text-surface-400 mb-1">API Key Template:</p>
          <code className="text-sm text-accent-400 font-mono break-all">
            {UNRAID_API_KEY_TEMPLATE}
          </code>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          className="shrink-0"
          title="Copy template"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-surface-500 mt-3">
        This template creates a read-only API key with viewer permissions for monitoring array health and disk status.
      </p>
    </div>
  );
}

interface ServiceConnectionFormProps {
  service: ServiceConfig;
  config?: ServiceConnection;
  testResult?: { status: 'success' | 'error' | 'loading'; message?: string };
  onFieldChange: (field: ServiceField, value: string) => void;
  onTest: () => void;
}

function ServiceConnectionForm({
  service,
  config,
  testResult,
  onFieldChange,
  onTest,
}: ServiceConnectionFormProps) {
  return (
    <div className="p-5 rounded-xl bg-surface-800/40 border border-surface-700/30 transition-all duration-200 hover:border-surface-600/50">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="font-display font-semibold text-white">{service.name}</h3>
            {service.required && (
              <Badge variant="accent" size="sm">Required</Badge>
            )}
            {testResult?.status === 'success' && (
              <Badge variant="success" size="sm">
                <CheckCircle className="w-3 h-3" />
                Connected
              </Badge>
            )}
          </div>
          <p className="text-sm text-surface-400 mt-1">{service.description}</p>
        </div>
        <a
          href={`https://${service.key}.app`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg text-surface-400 hover:text-accent-400 hover:bg-surface-700/50 transition-all"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="URL"
          type="url"
          value={config?.url || ''}
          onChange={(e) => onFieldChange('url', e.target.value)}
          placeholder={`http://localhost:${service.defaultPort}`}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
        />
        <Input
          label={service.fields.includes('token') ? 'Token' : 'API Key'}
          type="password"
          value={config?.apiKey || config?.token || ''}
          onChange={(e) => {
            const field: ServiceField = service.fields.includes('token') ? 'token' : 'apiKey';
            onFieldChange(field, e.target.value);
          }}
          placeholder="Enter API key or token"
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
        />
      </div>

      {service.key === 'unraid' && <UnraidApiKeyHelper />}

      <div className="flex items-center justify-between mt-5 pt-5 border-t border-surface-700/30">
        <div className="flex items-center gap-2 min-h-[24px]">
          {testResult?.status === 'success' && (
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Connected successfully</span>
            </div>
          )}
          {testResult?.status === 'error' && (
            <div className="flex items-start gap-2 text-ruby-400 max-w-md">
              <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="text-sm whitespace-pre-line">{testResult.message || 'Connection failed'}</span>
            </div>
          )}
          {testResult?.status === 'loading' && (
            <div className="flex items-center gap-2 text-accent-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Verifying connection...</span>
            </div>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onTest}
          disabled={!config?.url || testResult?.status === 'loading'}
        >
          {testResult?.status === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Test Connection
        </Button>
      </div>
    </div>
  );
}

function DisplayPreferencesCard() {
  const { preferences, setPreferences } = useDisplayPreferences();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Monitor className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <CardTitle>Display Preferences</CardTitle>
            <CardDescription>Customize how dates, times, and sizes are shown</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Date Format */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-surface-200">
              Date Format
            </label>
            <select
              value={preferences.dateFormat}
              onChange={(e) => setPreferences({ dateFormat: e.target.value as DisplaySettings['dateFormat'] })}
              className="select"
            >
              <option value="relative">Relative (2 hours ago)</option>
              <option value="absolute">Absolute (Jan 24, 2026)</option>
              <option value="iso">ISO (2026-01-24)</option>
            </select>
          </div>

          {/* Time Format */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-surface-200">
              Time Format
            </label>
            <select
              value={preferences.timeFormat}
              onChange={(e) => setPreferences({ timeFormat: e.target.value as DisplaySettings['timeFormat'] })}
              className="select"
            >
              <option value="12h">12-hour (3:00 PM)</option>
              <option value="24h">24-hour (15:00)</option>
            </select>
          </div>

          {/* File Size Unit */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-surface-200">
              File Size Unit
            </label>
            <select
              value={preferences.fileSizeUnit}
              onChange={(e) => setPreferences({ fileSizeUnit: e.target.value as DisplaySettings['fileSizeUnit'] })}
              className="select"
            >
              <option value="auto">Auto (best fit)</option>
              <option value="MB">Always MB</option>
              <option value="GB">Always GB</option>
              <option value="TB">Always TB</option>
            </select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
