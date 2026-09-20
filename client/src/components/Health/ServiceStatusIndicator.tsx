import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Settings as SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface ServiceStatusIndicatorProps {
  name: string;
  configured: boolean;
  connected: boolean;
  error?: string;
  loading?: boolean;
  responseTimeMs?: number;
  /** The service's own web UI. Null when it has no URL configured. */
  href?: string | null;
  /** Where to send the user to set this service up. */
  settingsHref?: string;
}

export function ServiceStatusIndicator({
  name,
  configured,
  connected,
  error,
  loading,
  responseTimeMs,
  href,
  settingsHref,
}: ServiceStatusIndicatorProps) {
  const { t } = useTranslation('health');
  const status = !configured ? 'unconfigured' : connected ? 'connected' : 'disconnected';

  const statusConfig = {
    unconfigured: {
      dotColor: 'bg-surface-500',
      textColor: 'text-surface-400',
      label: t('service.notConfigured', 'Not configured'),
    },
    connected: {
      dotColor: 'bg-emerald-500',
      textColor: 'text-emerald-text',
      label: responseTimeMs ? `${responseTimeMs}ms` : t('service.connected', 'Connected'),
    },
    disconnected: {
      dotColor: 'bg-ruby-500',
      textColor: 'text-ruby-text',
      label: error || t('service.disconnected', 'Disconnected'),
    },
  };

  const config = statusConfig[status];

  const row = (
    <>
      <span
        className={cn(
          'w-2 h-2 rounded-full flex-shrink-0 transition-colors',
          loading ? 'bg-amber-500 animate-pulse' : config.dotColor
        )}
      />
      <span className="text-sm text-surface-200 capitalize">{name}</span>
      <span className={cn('text-xs truncate', loading ? 'text-accent-text' : config.textColor)}>
        {loading ? t('service.checking', 'Checking...') : config.label}
      </span>
    </>
  );

  const rowClass = 'flex items-center gap-2 py-1';
  const interactiveClass = cn(
    rowClass,
    '-mx-2 px-2 rounded-lg hover:bg-surface-800/60 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40'
  );

  // A configured service opens its own web UI in a new tab; an unconfigured
  // one goes to the settings panel where it can be set up.
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(interactiveClass, 'group')}
        title={t('service.openService', 'Open {{name}}', { name })}
      >
        {row}
        <Trailing>
          <ExternalLink className="w-3 h-3 text-surface-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        </Trailing>
      </a>
    );
  }

  if (!configured && settingsHref) {
    return (
      <Link
        to={settingsHref}
        className={cn(interactiveClass, 'group')}
        title={t('service.configureService', 'Configure {{name}}', { name })}
      >
        {row}
        <Trailing>
          <SettingsIcon className="w-3 h-3 text-surface-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        </Trailing>
      </Link>
    );
  }

  return <div className={rowClass}>{row}</div>;
}

/** Pins the hover affordance to the right-hand edge of the row. */
function Trailing({ children }: { children: ReactNode }) {
  return <span className="ml-auto flex-shrink-0">{children}</span>;
}
