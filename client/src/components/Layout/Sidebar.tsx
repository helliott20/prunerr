import { useState, forwardRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Scissors,
  Sparkles,
  X,
  Moon,
} from 'lucide-react';
import {
  DashboardIcon,
  LibraryIcon,
  CollectionsIcon,
  RulesIcon,
  QueueIcon,
  HistoryIcon,
  ActivityIcon,
  SettingsIcon,
  SunIcon,
  GlobeIcon,
  GithubIcon,
  MessageCircleIcon,
  ContainerIcon,
} from './NavIcons';
import { cn } from '@/lib/utils';
import { useUnraidStats, useDeletionQueue, useVersion, useStats } from '@/hooks/useApi';
import { useTheme } from '@/contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { DiskStatsModal } from './DiskStatsModal';
import { StorageWidget } from './StorageWidget';
import { DiskPressureWidget } from './DiskPressureWidget';

interface SidebarProps {
  isOpen?: boolean; // kept for API compat, transform managed by Layout
  onClose?: () => void;
}

const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(function Sidebar({ onClose }, ref) {
  const location = useLocation();
  const [isDiskStatsOpen, setIsDiskStatsOpen] = useState(false);
  const { data: unraidStats } = useUnraidStats();
  const { data: dashboardStats } = useStats();
  const { data: queueItems } = useDeletionQueue();
  const { data: version } = useVersion();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useTranslation('layout');
  const queueCount = queueItems?.length ?? 0;

  const navItems = [
    { id: 'dashboard', label: t('nav.dashboard', 'Dashboard'), href: '/', icon: DashboardIcon },
    { id: 'library', label: t('nav.library', 'Library'), href: '/library', icon: LibraryIcon },
    { id: 'collections', label: t('nav.collections', 'Collections'), href: '/collections', icon: CollectionsIcon },
    { id: 'rules', label: t('nav.rules', 'Rules'), href: '/rules', icon: RulesIcon },
    { id: 'queue', label: t('nav.queue', 'Queue'), href: '/queue', icon: QueueIcon },
    { id: 'history', label: t('nav.history', 'History'), href: '/history', icon: HistoryIcon },
    { id: 'activity', label: t('nav.activity', 'Activity'), href: '/activity', icon: ActivityIcon },
    { id: 'settings', label: t('nav.settings', 'Settings'), href: '/settings', icon: SettingsIcon },
  ];

  const handleNavClick = () => {
    // Close mobile menu when a nav link is clicked
    onClose?.();
  };

  return (
    <aside
      ref={ref}
      className={cn(
        'w-72 bg-surface-900 border-r border-surface-700/50 flex flex-col',
        'fixed inset-y-0 left-0 z-50',
        'lg:relative lg:!translate-x-0 lg:!transition-none',
      )}
      style={{ transform: 'translateX(-100%)' }}
    >
      {/* Logo - with close button on mobile */}
      <div className="h-20 flex items-center justify-between gap-4 px-6 border-b border-surface-800/50">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-accent-500 to-accent-600 rounded-xl flex items-center justify-center shadow-lg shadow-accent-500/20">
            <Scissors className="w-6 h-6 text-amber-950" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-surface-50 tracking-tight">Prunerr</h1>
            <p className="text-xs text-surface-500 font-medium">{t('tagline', 'Media Library Manager')}</p>
          </div>
        </div>
        {/* Close button - only visible on mobile */}
        <button
          onClick={onClose}
          className="lg:hidden p-2 rounded-xl text-surface-400 hover:text-surface-50 hover:bg-surface-800/60 transition-colors"
          aria-label={t('closeMenu', 'Close navigation menu')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        <div className="px-3 py-2 mb-4">
          <p className="text-2xs font-semibold text-surface-500 uppercase tracking-widest">{t('menuLabel', 'Menu')}</p>
        </div>
        {navItems.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));

          return (
            <NavLink
              key={item.id}
              to={item.href}
              onClick={handleNavClick}
              className={cn(
                'group flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                // The border is always there, transparent when inactive: only
                // the active item used to carry one, so every click resized it
                // by 2px and nudged the items between old and new.
                'border',
                // The ring hugs the pill and is ours in every theme — the
                // browser's own focus ring is white on a dark sidebar, and the
                // global offset ring leaves a pale halo.
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                'focus-visible:ring-accent-500/60 focus-visible:ring-offset-0',
                isActive
                  ? 'bg-accent-500/10 text-accent-text border-accent-500/20 shadow-sm shadow-accent-500/10'
                  : 'border-transparent text-surface-400 hover:text-surface-100 hover:bg-surface-800/60'
              )}
            >
              <item.icon className={cn(
                'w-5 h-5 transition-colors',
                isActive ? 'text-accent-text' : 'text-surface-500 group-hover:text-surface-300'
              )} />
              <span>{item.label}</span>
              {item.id === 'queue' && queueCount > 0 && (
                <span className="ml-auto px-2 py-0.5 text-xs font-semibold rounded-full bg-ruby-500/20 text-ruby-text border border-ruby-500/30">
                  {queueCount}
                </span>
              )}
              {isActive && item.id !== 'queue' && (
                <Sparkles className="w-3 h-3 ml-auto text-accent-text/60" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Storage Widget */}
      <div className="p-4 border-t border-surface-800/50 space-y-3">
        <StorageWidget
          stats={unraidStats}
          onClick={() => setIsDiskStatsOpen(true)}
        />
        {/* Free-space gauge from statfs — shown when Unraid isn't the source */}
        {!unraidStats?.configured && dashboardStats?.diskPressureEnabled && (
          <DiskPressureWidget stats={dashboardStats} />
        )}
      </div>

      {/* Disk Stats Modal */}
      <DiskStatsModal
        isOpen={isDiskStatsOpen}
        onClose={() => setIsDiskStatsOpen(false)}
      />

      {/* Version & Links */}
      <div className="px-6 py-3 border-t border-surface-800/50">
        <div className="flex items-center justify-center gap-3 mb-2">
          <button
            onClick={toggleTheme}
            className="group p-2.5 rounded-lg text-surface-500 hover:text-accent-text-hover hover:bg-surface-800/60 transition-all"
            title={resolvedTheme === 'dark' ? t('theme.toLight', 'Switch to light mode') : t('theme.toDark', 'Switch to dark mode')}
            aria-label={resolvedTheme === 'dark' ? t('theme.toLight', 'Switch to light mode') : t('theme.toDark', 'Switch to dark mode')}
          >
            {resolvedTheme === 'dark' ? <SunIcon className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <a
            href="https://prunerr.media"
            target="_blank"
            rel="noopener noreferrer"
            className="group p-2.5 rounded-lg text-surface-500 hover:text-accent-text-hover hover:bg-surface-800/60 transition-all"
            title={t('links.website', 'Website')}
            aria-label={t('links.websiteAria', 'Prunerr website')}
          >
            <GlobeIcon className="w-4 h-4" />
          </a>
          <a
            href="https://github.com/helliott20/prunerr"
            target="_blank"
            rel="noopener noreferrer"
            className="group p-2.5 rounded-lg text-surface-500 hover:text-accent-text-hover hover:bg-surface-800/60 transition-all"
            title={t('links.github', 'GitHub')}
          >
            <GithubIcon className="w-4 h-4" />
          </a>
          <a
            href="https://forums.unraid.net/topic/196929-support-prunerr-media-library-cleanup-tool/"
            target="_blank"
            rel="noopener noreferrer"
            className="group p-2.5 rounded-lg text-surface-500 hover:text-accent-text-hover hover:bg-surface-800/60 transition-all"
            title={t('links.unraidSupport', 'Unraid Support')}
          >
            <MessageCircleIcon className="w-4 h-4" />
          </a>
          <a
            href="https://hub.docker.com/r/helliott20/prunerr"
            target="_blank"
            rel="noopener noreferrer"
            className="group p-2.5 rounded-lg text-surface-500 hover:text-accent-text-hover hover:bg-surface-800/60 transition-all"
            title={t('links.dockerHub', 'Docker Hub')}
          >
            <ContainerIcon className="w-4 h-4" />
          </a>
        </div>
        <p className="text-2xs text-surface-600 text-center font-mono">v{version || '...'}</p>
      </div>
    </aside>
  );
});

export default Sidebar;
