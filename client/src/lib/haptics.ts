import { useCallback, useState } from 'react';

/**
 * Per-device haptic-feedback preference. Stored in localStorage (like the theme
 * and library view-mode) because vibration is inherently device-specific — your
 * phone vibrates, your desktop doesn't. Defaults to enabled.
 */
const STORAGE_KEY = 'prunerr:haptics';

export function isHapticsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // localStorage can throw in private mode / sandboxed contexts.
    return true;
  }
}

function writeHapticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* ignore — preference just won't persist */
  }
}

/**
 * Fire a short haptic tick, if the device supports the Vibration API and the
 * user hasn't disabled haptics. No-op everywhere else (e.g. iOS Safari).
 */
export function haptic(ms = 8): void {
  if (!isHapticsEnabled()) return;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(ms);
  }
}

/** Reactive accessor for the haptics preference, for use in settings UI. */
export function useHapticsEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(isHapticsEnabled);
  const update = useCallback((next: boolean) => {
    writeHapticsEnabled(next);
    setEnabled(next);
  }, []);
  return [enabled, update];
}
