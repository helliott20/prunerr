import type { MediaServerType, Settings as SettingsType } from '@/types';

/**
 * The six categories the settings page collapses into. Order is meaningful:
 * things you connect → things that run → things that protect you → things that
 * tell you → things you look at → things you administer.
 */
export type CategoryId =
  | 'connections'
  | 'automation'
  | 'safety'
  | 'alerts'
  | 'interface'
  | 'system';

export type ServiceField = 'url' | 'apiKey' | 'token';

export type ServiceKeyType =
  | 'plex'
  | 'jellyfin'
  | 'tautulli'
  | 'tracearr'
  | 'sonarr'
  | 'radarr'
  | 'overseerr'
  | 'unraid';

export type WatchHistoryProviderType = 'tautulli' | 'tracearr' | 'plex';

export type TestStatus = 'success' | 'error' | 'loading';

export interface TestResult {
  status: TestStatus;
  message?: string;
}

/**
 * Which media server the install talks to, resolved once by the shell so no
 * panel has to branch on the backend. `configKey` is the settings namespace —
 * Jellyfin and Emby deliberately share one.
 */
export interface ActiveMediaServer {
  type: MediaServerType;
  /** Display name: "Plex", "Jellyfin" or "Emby". Interpolate into copy. */
  name: string;
  configKey: 'plex' | 'jellyfin';
}

/**
 * The single contract every category panel receives.
 *
 * Panels are pure presentation over staged state: they never call the settings
 * API directly, they stage edits through `onChange`/`onServiceChange` and the
 * shell decides when to persist.
 */
export interface PanelProps {
  /** Saved settings with staged edits applied on top. */
  draft: Partial<SettingsType>;
  /** Stage one top-level change. */
  onChange: <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => void;
  /** Stage one service credential field. */
  onServiceChange: (service: ServiceKeyType, field: ServiceField, value: string) => void;
  /**
   * True when no service has both a URL and a credential — the install has
   * never been configured. Drives first-run copy and empty states. An
   * unconfigured optional service must never be styled as an error.
   */
  fresh: boolean;
  mediaServer: ActiveMediaServer;
  testResults: Record<string, TestResult>;
  runTest: (service: ServiceKeyType) => Promise<void>;
  /**
   * Registers a sub-section's DOM node so the rail can scroll the panel to it.
   * Pass to `PanelSection`; do not call directly.
   */
  registerSection: (id: string, node: HTMLElement | null) => void;
}
