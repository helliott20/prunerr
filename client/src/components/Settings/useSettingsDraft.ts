import { useCallback, useMemo, useState } from 'react';
import type { Settings as SettingsType, ServiceConnection } from '@/types';
import type { ServiceField, ServiceKeyType } from './types';

/** A staged service credential edit, flattened so it can be counted per field. */
type ServiceEdits = Partial<Record<ServiceKeyType, Partial<ServiceConnection>>>;

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Settings values are JSON all the way down, so this is sound and keeps the
  // dirty count honest for arrays and nested objects.
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export interface SettingsDraft {
  /** Saved settings with staged edits applied on top. */
  draft: Partial<SettingsType>;
  /** Number of leaf fields that differ from the saved payload. */
  dirtyCount: number;
  set: <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => void;
  setService: (service: ServiceKeyType, field: ServiceField, value: string) => void;
  discard: () => void;
  markSaved: () => void;
}

/**
 * Staged-edit state for the settings page.
 *
 * Nothing is written to the server until the shell saves, so edits survive
 * category switches — and, importantly, survive React Query refetching the
 * saved payload underneath us.
 */
export function useSettingsDraft(saved: Partial<SettingsType> | undefined): SettingsDraft {
  const [edits, setEdits] = useState<Partial<SettingsType>>({});
  const [serviceEdits, setServiceEdits] = useState<ServiceEdits>({});

  const set = useCallback(
    <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => {
      setEdits((current) => {
        const next = { ...current };
        // Editing a field back to its saved value un-dirties it rather than
        // leaving a no-op change behind.
        if (isEqual(saved?.[key], value)) {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
    },
    [saved]
  );

  const setService = useCallback(
    (service: ServiceKeyType, field: ServiceField, value: string) => {
      setServiceEdits((current) => {
        const savedValue = saved?.services?.[service]?.[field];
        const forService = { ...(current[service] ?? {}) };

        if (isEqual(savedValue ?? '', value)) {
          delete forService[field];
        } else {
          forService[field] = value;
        }

        const next = { ...current };
        if (Object.keys(forService).length === 0) {
          delete next[service];
        } else {
          next[service] = forService;
        }
        return next;
      });
    },
    [saved]
  );

  const draft = useMemo<Partial<SettingsType>>(() => {
    const merged: Partial<SettingsType> = { ...saved, ...edits };

    if (Object.keys(serviceEdits).length > 0) {
      const services = { ...(saved?.services ?? {}) } as NonNullable<SettingsType['services']>;
      for (const [key, fields] of Object.entries(serviceEdits)) {
        const service = key as ServiceKeyType;
        services[service] = { ...(services[service] ?? {}), ...fields };
      }
      merged.services = services;
    }

    return merged;
  }, [saved, edits, serviceEdits]);

  const dirtyCount = useMemo(() => {
    const serviceFieldCount = Object.values(serviceEdits).reduce(
      (total, fields) => total + Object.keys(fields ?? {}).length,
      0
    );
    return Object.keys(edits).length + serviceFieldCount;
  }, [edits, serviceEdits]);

  const discard = useCallback(() => {
    setEdits({});
    setServiceEdits({});
  }, []);

  return { draft, dirtyCount, set, setService, discard, markSaved: discard };
}
