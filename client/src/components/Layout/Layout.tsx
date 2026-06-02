import { ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Sun, Moon } from 'lucide-react';
import Sidebar from './Sidebar';
import { useTheme } from '@/contexts/ThemeContext';
import { useTranslation } from 'react-i18next';

const SIDEBAR_WIDTH = 288; // w-72 = 18rem = 288px
const VELOCITY_THRESHOLD = 0.3; // px/ms — fast swipe snaps regardless of position
const SNAP_THRESHOLD = 0.35; // fraction of sidebar width to snap open

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useTranslation('layout');

  // Swipe state refs (avoid re-renders during drag)
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const startTime = useRef(0);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const isHorizontalSwipe = useRef<boolean | null>(null);
  const backdropHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suspend descendant backdrop-filters while the sidebar is moving (see the
  // `.nav-animating` rule in index.css). Pass a duration to auto-clear after the
  // snap settles, or null to hold it on for the duration of a live drag.
  const suspendBlurDuringNav = useCallback((clearAfterMs: number | null) => {
    document.documentElement.classList.add('nav-animating');
    if (navAnimTimer.current) {
      clearTimeout(navAnimTimer.current);
      navAnimTimer.current = null;
    }
    if (clearAfterMs !== null) {
      navAnimTimer.current = setTimeout(() => {
        document.documentElement.classList.remove('nav-animating');
        navAnimTimer.current = null;
      }, clearAfterMs);
    }
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    if (mobileMenuOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileMenuOpen]);

  // Update the sidebar transform and backdrop opacity directly (no React state)
  const updatePosition = useCallback((offsetX: number) => {
    const sidebar = sidebarRef.current;
    const backdrop = backdropRef.current;
    if (!sidebar) return;

    // Hold blur suspended for the whole live drag; touch-end's snapTo schedules
    // the restore once the gesture settles.
    suspendBlurDuringNav(null);

    // Clamp between -SIDEBAR_WIDTH (fully hidden) and 0 (fully visible)
    const clamped = Math.max(-SIDEBAR_WIDTH, Math.min(0, offsetX));
    sidebar.style.transform = `translateX(${clamped}px)`;
    sidebar.style.transition = 'none';

    if (backdrop) {
      const progress = 1 + clamped / SIDEBAR_WIDTH; // 0 = hidden, 1 = fully open
      backdrop.style.opacity = String(Math.max(0, progress * 0.6));
      backdrop.style.display = progress > 0 ? 'block' : 'none';
      backdrop.style.transition = 'none';
    }
  }, [suspendBlurDuringNav]);

  // Snap to open or closed with animation
  const snapTo = useCallback((open: boolean) => {
    const sidebar = sidebarRef.current;
    const backdrop = backdropRef.current;

    // Snap runs a 300ms transition; suspend blur for that window then restore.
    suspendBlurDuringNav(300);

    if (sidebar) {
      sidebar.style.transition = 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)';
      sidebar.style.transform = open ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`;
    }
    if (backdrop) {
      // Clear any pending hide timer
      if (backdropHideTimer.current) {
        clearTimeout(backdropHideTimer.current);
        backdropHideTimer.current = null;
      }
      backdrop.style.transition = 'opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)';
      backdrop.style.opacity = open ? '0.6' : '0';
      if (open) {
        backdrop.style.display = 'block';
      } else {
        backdropHideTimer.current = setTimeout(() => {
          if (backdropRef.current) backdropRef.current.style.display = 'none';
          backdropHideTimer.current = null;
        }, 300);
      }
    }

    setMobileMenuOpen(open);
  }, [suspendBlurDuringNav]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only on mobile (lg breakpoint = 1024px)
    if (window.innerWidth >= 1024) return;

    const touch = e.touches[0];
    const x = touch.clientX;

    // Always track — we'll decide if it's a sidebar swipe once direction is clear
    isDragging.current = true;
    startX.current = x;
    startY.current = touch.clientY;
    currentX.current = x;
    startTime.current = Date.now();
    wasOpen.current = mobileMenuOpen;
    isHorizontalSwipe.current = null;
  }, [mobileMenuOpen]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;

    const touch = e.touches[0];
    const dx = touch.clientX - startX.current;
    const dy = touch.clientY - startY.current;

    // Determine swipe direction on first significant movement
    if (isHorizontalSwipe.current === null) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy);
        if (!isHorizontalSwipe.current) {
          isDragging.current = false;
          return;
        }
        // If sidebar is closed and swiping left, abort (nothing to do)
        if (!wasOpen.current && dx < 0) {
          isDragging.current = false;
          return;
        }
        // If sidebar is open and swiping right, abort (already open)
        if (wasOpen.current && dx > 0) {
          isDragging.current = false;
          return;
        }
      } else {
        return;
      }
    }

    currentX.current = touch.clientX;

    // Calculate sidebar position
    if (wasOpen.current) {
      updatePosition(Math.min(0, dx));
    } else {
      updatePosition(-SIDEBAR_WIDTH + Math.max(0, dx));
    }
  }, [updatePosition]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    isHorizontalSwipe.current = null;

    const dx = currentX.current - startX.current;
    const dt = Date.now() - startTime.current;
    const velocity = Math.abs(dx) / dt; // px/ms

    // Decide whether to snap open or closed
    let shouldOpen: boolean;
    if (velocity > VELOCITY_THRESHOLD) {
      // Fast swipe — direction determines outcome
      shouldOpen = dx > 0;
    } else {
      // Slow drag — position determines outcome
      if (wasOpen.current) {
        shouldOpen = dx > -SIDEBAR_WIDTH * SNAP_THRESHOLD;
      } else {
        shouldOpen = dx > SIDEBAR_WIDTH * SNAP_THRESHOLD;
      }
    }

    snapTo(shouldOpen);
  }, [snapTo]);

  // Handle interrupted touches (notification shade, app switcher, etc.)
  const handleTouchCancel = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    isHorizontalSwipe.current = null;
    snapTo(wasOpen.current);
  }, [snapTo]);

  // When mobileMenuOpen changes from button press, sync the DOM
  useEffect(() => {
    const sidebar = sidebarRef.current;
    const backdrop = backdropRef.current;
    if (!sidebar) return;

    // Only reset styles if not mid-drag
    if (!isDragging.current) {
      // Button/route-driven open/close also runs the 300ms transition.
      suspendBlurDuringNav(300);
      sidebar.style.transition = 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)';
      sidebar.style.transform = mobileMenuOpen ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`;

      if (backdrop) {
        // Clear any pending hide timer
        if (backdropHideTimer.current) {
          clearTimeout(backdropHideTimer.current);
          backdropHideTimer.current = null;
        }
        backdrop.style.transition = 'opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)';
        backdrop.style.opacity = mobileMenuOpen ? '0.6' : '0';
        if (mobileMenuOpen) {
          backdrop.style.display = 'block';
        } else {
          backdropHideTimer.current = setTimeout(() => {
            if (backdropRef.current) backdropRef.current.style.display = 'none';
            backdropHideTimer.current = null;
          }, 300);
        }
      }
    }
  }, [mobileMenuOpen, suspendBlurDuringNav]);

  // Clean up the blur-suspension timer/class on unmount
  useEffect(() => {
    return () => {
      if (navAnimTimer.current) clearTimeout(navAnimTimer.current);
      document.documentElement.classList.remove('nav-animating');
    };
  }, []);

  return (
    <div
      className="flex h-screen overflow-hidden bg-surface-950"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Mobile Header */}
      <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-surface-900/95 backdrop-blur-sm border-b border-surface-800/50 flex items-center px-4 lg:hidden">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="p-2 -ml-2 rounded-xl text-surface-400 hover:text-surface-50 hover:bg-surface-800/60 transition-colors"
          aria-label={t('openMenu', 'Open navigation menu')}
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-3 ml-3">
          <div className="w-8 h-8 bg-gradient-to-br from-accent-500 to-accent-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-amber-950" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3" />
              <path d="M8.12 8.12 12 12" />
              <path d="M20 4 8.12 15.88" />
              <circle cx="6" cy="18" r="3" />
              <path d="M14.8 14.8 20 20" />
            </svg>
          </div>
          <span className="text-lg font-display font-bold text-surface-50">Prunerr</span>
        </div>
        <button
          onClick={toggleTheme}
          className="ml-auto p-2 rounded-xl text-surface-400 hover:text-accent-text-hover hover:bg-surface-800/60 transition-colors"
          aria-label={resolvedTheme === 'dark' ? t('theme.toLight', 'Switch to light mode') : t('theme.toDark', 'Switch to dark mode')}
        >
          {resolvedTheme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </header>

      {/* Backdrop overlay for mobile — controlled by swipe + button */}
      <div
        ref={backdropRef}
        className="fixed inset-0 bg-black z-40 lg:hidden"
        style={{ opacity: 0, display: 'none' }}
        onClick={() => snapTo(false)}
        aria-hidden="true"
      />

      {/* Sidebar — transform controlled by JS for swipe tracking */}
      <Sidebar
        ref={sidebarRef}
        isOpen={mobileMenuOpen}
        onClose={() => snapTo(false)}
      />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pt-16 lg:pt-0">
        <div className="p-4 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
