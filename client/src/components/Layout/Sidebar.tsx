import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Library,
  ListFilter,
  Trash2,
  History,
  Activity,
  Settings,
  Scissors,
  HardDrive,
  Sparkles,
  X,
  Github,
  MessageCircle,
  Container,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { useUnraidStats, useDeletionQueue, useVersion } from '@/hooks/useApi';
import { DiskStatsModal } from './DiskStatsModal';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Library', href: '/library', icon: Library },
  { name: 'Rules', href: '/rules', icon: ListFilter },
  { name: 'Queue', href: '/queue', icon: Trash2 },
  { name: 'History', href: '/history', icon: History },
  { name: 'Activity', href: '/activity', icon: Activity },
  { name: 'Settings', href: '/settings', icon: Settings },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const location = useLocation();
  const [isDiskStatsOpen, setIsDiskStatsOpen] = useState(false);
  const { data: unraidStats } = useUnraidStats();
  const { data: queueItems } = useDeletionQueue();
  const { data: version } = useVersion();
  const queueCount = queueItems?.length ?? 0;

  // Calculate storage display values
  const hasUnraidData = unraidStats?.configured && unraidStats?.totalCapacity !== undefined;
  const usedStorage = hasUnraidData ? unraidStats.usedCapacity : 0;
  const totalStorage = hasUnraidData ? unraidStats.totalCapacity : 0;
  const freeStorage = hasUnraidData ? unraidStats.freeCapacity : 0;
  const usedPercent = hasUnraidData ? (unraidStats.usedPercent ?? 0) : 0;

  const handleNavClick = () => {
    // Close mobile menu when a nav link is clicked
    onClose?.();
  };

  return (
    <aside
      className={cn(
        'w-72 bg-surface-900/50 border-r border-surface-800/50 flex flex-col backdrop-blur-sm',
        'fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out',
        'lg:relative lg:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      {/* Logo - with close button on mobile */}
      <div className="h-20 flex items-center justify-between gap-4 px-6 border-b border-surface-800/50">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 bg-gradient-to-br from-accent-500 to-accent-600 rounded-xl flex items-center justify-center shadow-lg shadow-accent-500/20">
              <Scissors className="w-6 h-6 text-surface-950" />
            </div>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-surface-900 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-white tracking-tight">Prunerr</h1>
            <p className="text-xs text-surface-500 font-medium">Media Library Manager</p>
          </div>
        </div>
        {/* Close button - only visible on mobile */}
        <button
          onClick={onClose}
          className="lg:hidden p-2 rounded-xl text-surface-400 hover:text-white hover:bg-surface-800/60 transition-colors"
          aria-label="Close navigation menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        <div className="px-3 py-2 mb-4">
          <p className="text-2xs font-semibold text-surface-500 uppercase tracking-widest">Menu</p>
        </div>
        {navigation.map((item, index) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));

          return (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={handleNavClick}
              className={cn(
                'group flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                'animate-fade-up opacity-0',
                isActive
                  ? 'bg-accent-500/10 text-accent-400 border border-accent-500/20 shadow-sm shadow-accent-500/10'
                  : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/60'
              )}
              style={{
                animationDelay: `${index * 50}ms`,
                animationFillMode: 'forwards'
              }}
            >
              <item.icon className={cn(
                'w-5 h-5 transition-colors',
                isActive ? 'text-accent-400' : 'text-surface-500 group-hover:text-surface-300'
              )} />
              <span>{item.name}</span>
              {item.name === 'Queue' && queueCount > 0 && (
                <span className="ml-auto px-2 py-0.5 text-xs font-semibold rounded-full bg-ruby-500/20 text-ruby-400 border border-ruby-500/30">
                  {queueCount}
                </span>
              )}
              {isActive && item.name !== 'Queue' && (
                <Sparkles className="w-3 h-3 ml-auto text-accent-400/60" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Storage Widget */}
      <div className="p-4 border-t border-surface-800/50">
        <button
          onClick={() => setIsDiskStatsOpen(true)}
          className={cn(
            'w-full p-4 rounded-xl bg-surface-800/40 border border-surface-700/30 text-left',
            'transition-all duration-200 cursor-pointer',
            'hover:bg-surface-800/60 hover:border-surface-600/50',
            'focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:ring-offset-2 focus:ring-offset-surface-900'
          )}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-accent-500/10">
              <HardDrive className="w-4 h-4 text-accent-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-surface-300">Storage Used</p>
              <p className="text-lg font-display font-bold text-white">
                {hasUnraidData ? formatBytes(usedStorage) : 'Not configured'}
              </p>
            </div>
          </div>
          {hasUnraidData ? (
            <>
              <div className="progress-bar">
                <div
                  className={cn(
                    'progress-fill',
                    usedPercent > 90
                      ? 'bg-ruby-500'
                      : usedPercent > 75
                        ? 'bg-amber-500'
                        : 'bg-accent-500'
                  )}
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
              <div className="flex justify-between mt-2">
                <p className="text-2xs text-surface-500">
                  {usedPercent.toFixed(0)}% of {formatBytes(totalStorage)}
                </p>
                <p className="text-2xs text-accent-400 font-medium">
                  {formatBytes(freeStorage)} free
                </p>
              </div>
            </>
          ) : (
            <p className="text-2xs text-surface-500">
              Click to configure Unraid connection
            </p>
          )}
        </button>
      </div>

      {/* Disk Stats Modal */}
      <DiskStatsModal
        isOpen={isDiskStatsOpen}
        onClose={() => setIsDiskStatsOpen(false)}
      />

      {/* Version & Links */}
      <div className="px-6 py-3 border-t border-surface-800/50">
        <div className="flex items-center justify-center gap-3 mb-2">
          <a
            href="https://github.com/helliott20/prunerr"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-surface-500 hover:text-accent-400 hover:bg-surface-800/60 transition-all"
            title="GitHub"
          >
            <Github className="w-4 h-4" />
          </a>
          <a
            href="https://forums.unraid.net/topic/196929-support-prunerr-media-library-cleanup-tool/"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-surface-500 hover:text-accent-400 hover:bg-surface-800/60 transition-all"
            title="Unraid Support"
          >
            <MessageCircle className="w-4 h-4" />
          </a>
          <a
            href="https://hub.docker.com/r/helliott20/prunerr"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-surface-500 hover:text-accent-400 hover:bg-surface-800/60 transition-all"
            title="Docker Hub"
          >
            <Container className="w-4 h-4" />
          </a>
        </div>
        <p className="text-2xs text-surface-600 text-center font-mono">v{version || '...'}</p>
      </div>
    </aside>
  );
}
