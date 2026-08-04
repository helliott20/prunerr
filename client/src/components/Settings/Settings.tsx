import { SettingsShell } from './SettingsShell';
import type { CategoryId, PanelProps } from './types';

import ConnectionsPanel from './panels/ConnectionsPanel';
import AutomationPanel from './panels/AutomationPanel';
import SafetyPanel from './panels/SafetyPanel';
import AlertsPanel from './panels/AlertsPanel';
import InterfacePanel from './panels/InterfacePanel';
import SystemPanel from './panels/SystemPanel';

const PANELS: Record<CategoryId, (props: PanelProps) => JSX.Element> = {
  connections: ConnectionsPanel,
  automation: AutomationPanel,
  safety: SafetyPanel,
  alerts: AlertsPanel,
  interface: InterfacePanel,
  system: SystemPanel,
};

/**
 * The settings page: a shell that owns navigation, search and staged saving,
 * plus one panel per category. Panels are plain components over `PanelProps` —
 * see `types.ts` for the contract.
 */
export default function Settings() {
  return (
    <SettingsShell
      panels={{
        render: (id, props) => {
          const Panel = PANELS[id];
          return <Panel {...props} />;
        },
      }}
    />
  );
}
