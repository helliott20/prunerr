import { Link } from 'react-router-dom';
import {
  Scissors,
  ArrowRight,
  Server,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ServiceStatus {
  name: string;
  configured: boolean;
  required: boolean | 'arr';
  description: string;
}

interface WelcomeCardProps {
  services: ServiceStatus[];
}

export function WelcomeCard({ services }: WelcomeCardProps) {
  const configuredCount = services.filter(s => s.configured).length;

  // Split services into categories
  const alwaysRequired = services.filter(s => s.required === true);
  const arrServices = services.filter(s => s.required === 'arr');
  const optionalServices = services.filter(s => s.required === false);

  // Check if requirements are met
  const alwaysRequiredConfigured = alwaysRequired.every(s => s.configured);
  const hasArrConfigured = arrServices.some(s => s.configured);
  const allRequiredConfigured = alwaysRequiredConfigured && hasArrConfigured;

  return (
    <div className="card p-6 sm:p-8 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-accent-500/10 via-violet-500/5 to-transparent rounded-full -translate-y-32 translate-x-32" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-emerald-500/5 to-transparent rounded-full translate-y-24 -translate-x-24" />

      <div className="relative">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6">
          <div className="w-14 h-14 bg-gradient-to-br from-accent-500 to-accent-600 rounded-2xl flex items-center justify-center shadow-lg shadow-accent-500/20 flex-shrink-0">
            <Scissors className="w-7 h-7 text-surface-950" />
          </div>
          <div>
            <h2 className="text-2xl font-display font-bold text-white mb-1">
              Welcome to Prunerr
            </h2>
            <p className="text-surface-400">
              Let's get your media library cleanup system configured. Connect your services below to get started.
            </p>
          </div>
        </div>

        {/* Progress indicator */}
        <div className="mb-6 p-4 rounded-xl bg-surface-800/40 border border-surface-700/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-surface-300">Setup Progress</span>
            <span className="text-sm text-accent-400 font-medium">
              {configuredCount} of {services.length} services
            </span>
          </div>
          <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full transition-all duration-500"
              style={{ width: `${(configuredCount / services.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Required Services */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-surface-300 flex items-center gap-2">
              <Server className="w-4 h-4 text-accent-400" />
              Required
            </h3>
            {alwaysRequired.map((service) => (
              <ServiceItem key={service.name} service={service} />
            ))}
          </div>

          {/* Arr Services - at least one required */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-surface-300 flex items-center gap-2">
              <Server className="w-4 h-4 text-amber-400" />
              At Least One
            </h3>
            {arrServices.map((service) => (
              <ServiceItem key={service.name} service={service} arrGroup hasArrConfigured={hasArrConfigured} />
            ))}
          </div>

          {/* Optional Services */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-surface-300 flex items-center gap-2">
              <Server className="w-4 h-4 text-violet-400" />
              Optional
            </h3>
            {optionalServices.map((service) => (
              <ServiceItem key={service.name} service={service} />
            ))}
          </div>
        </div>

        {/* Action */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <Link
            to="/settings"
            className={cn(
              'btn inline-flex items-center gap-2 px-6 py-3',
              allRequiredConfigured
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                : 'bg-accent-500 hover:bg-accent-600 text-surface-950'
            )}
          >
            {allRequiredConfigured ? 'Review Settings' : 'Configure Services'}
            <ArrowRight className="w-4 h-4" />
          </Link>
          {allRequiredConfigured && (
            <p className="text-sm text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Required services configured! You're ready to go.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface ServiceItemProps {
  service: ServiceStatus;
  arrGroup?: boolean;
  hasArrConfigured?: boolean;
}

function ServiceItem({ service, arrGroup, hasArrConfigured }: ServiceItemProps) {
  // For arr group, show as "satisfied" if any arr service is configured
  const showAsConfigured = service.configured;
  const showWarning = arrGroup ? !hasArrConfigured : (service.required === true && !service.configured);

  return (
    <div className={cn(
      'flex items-center gap-3 p-3 rounded-lg transition-colors',
      showAsConfigured
        ? 'bg-emerald-500/10 border border-emerald-500/20'
        : 'bg-surface-800/40 border border-surface-700/30'
    )}>
      {showAsConfigured ? (
        <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
      ) : (
        <Circle className="w-5 h-5 text-surface-500 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium',
          showAsConfigured ? 'text-emerald-300' : 'text-surface-300'
        )}>
          {service.name}
        </p>
        <p className="text-xs text-surface-500 truncate">{service.description}</p>
      </div>
      {showWarning && (
        <span className="text-2xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium flex-shrink-0">
          Required
        </span>
      )}
    </div>
  );
}
