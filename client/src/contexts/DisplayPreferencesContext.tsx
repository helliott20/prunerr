import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useSettings, useSaveSettings } from '@/hooks/useApi';
import type { DisplaySettings, Settings } from '@/types';

const DEFAULT_PREFERENCES: DisplaySettings = {
  dateFormat: 'relative',
  timeFormat: '24h',
  fileSizeUnit: 'auto',
};

interface DisplayPreferencesContextValue {
  preferences: DisplaySettings;
  setPreferences: (preferences: Partial<DisplaySettings>) => void;
  isLoading: boolean;
}

const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue | undefined>(undefined);

interface DisplayPreferencesProviderProps {
  children: ReactNode;
}

export function DisplayPreferencesProvider({ children }: DisplayPreferencesProviderProps) {
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const saveMutation = useSaveSettings();

  const [preferences, setPreferencesState] = useState<DisplaySettings>(DEFAULT_PREFERENCES);
  const [initialized, setInitialized] = useState(false);

  // Sync preferences from API on load
  useEffect(() => {
    if (settings?.display && !initialized) {
      setPreferencesState({
        ...DEFAULT_PREFERENCES,
        ...settings.display,
      });
      setInitialized(true);
    } else if (settings && !settings.display && !initialized) {
      // Settings loaded but no display preferences yet - use defaults
      setInitialized(true);
    }
  }, [settings, initialized]);

  const setPreferences = useCallback((newPreferences: Partial<DisplaySettings>) => {
    const updatedPreferences = { ...preferences, ...newPreferences };
    setPreferencesState(updatedPreferences);

    // Persist to backend
    if (settings) {
      const updatedSettings: Settings = {
        ...settings,
        display: updatedPreferences,
      };
      saveMutation.mutate(updatedSettings);
    }
  }, [preferences, settings, saveMutation]);

  const value: DisplayPreferencesContextValue = {
    preferences,
    setPreferences,
    isLoading: settingsLoading && !initialized,
  };

  return (
    <DisplayPreferencesContext.Provider value={value}>
      {children}
    </DisplayPreferencesContext.Provider>
  );
}

export function useDisplayPreferences(): DisplayPreferencesContextValue {
  const context = useContext(DisplayPreferencesContext);
  if (context === undefined) {
    throw new Error('useDisplayPreferences must be used within a DisplayPreferencesProvider');
  }
  return context;
}
