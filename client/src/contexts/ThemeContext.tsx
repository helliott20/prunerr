import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useModeAnimation, ThemeAnimationType } from 'react-theme-switch-animation';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  /** Call with the mouse event so the animation originates from the clicked button */
  toggleTheme: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme') as Theme | null;
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'dark';
}

function updateMetaThemeColor(isDark: boolean) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', isDark ? '#030712' : '#fafbfd');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initialTheme = getInitialTheme();
  const initialResolved = resolveTheme(initialTheme);

  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(initialResolved);

  const { ref, toggleSwitchTheme, isDarkMode } = useModeAnimation({
    isDarkMode: resolvedTheme === 'dark',
    animationType: ThemeAnimationType.BLUR_CIRCLE,
    duration: 750,
    blurAmount: 2,
    easing: 'ease-in-out',
    globalClassName: 'dark',
    onDarkModeChange: (isDark: boolean) => {
      setThemeState(isDark ? 'dark' : 'light');
      setResolvedTheme(isDark ? 'dark' : 'light');
      updateMetaThemeColor(isDark);
    },
  });

  const toggleTheme = useCallback((e?: React.MouseEvent<HTMLButtonElement>) => {
    // Point the library's ref at whichever button was clicked so the
    // animation originates from the correct position on any viewport.
    if (e?.currentTarget) {
      (ref as React.MutableRefObject<HTMLButtonElement | null>).current = e.currentTarget;
    }
    toggleSwitchTheme();
  }, [toggleSwitchTheme, ref]);

  useEffect(() => {
    setResolvedTheme(isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const isDark = e.matches;
      setResolvedTheme(isDark ? 'dark' : 'light');
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      updateMetaThemeColor(isDark);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
