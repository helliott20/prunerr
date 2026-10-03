import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import type { StorageStats } from '@/types';

const setSource = vi.fn(async (source: string) => ({ ...stats(), source }));
vi.mock('@/services/api', () => ({
  storageApi: { getStats: async () => stats(), setSource: (s: string) => setSource(s) },
}));

import { StorageSourceSwitch } from '../StorageSourceSwitch';

function stats(overrides: Partial<StorageStats> = {}): StorageStats {
  return {
    configured: true,
    source: 'unraid',
    preference: 'auto',
    available: { unraid: true, arr: true },
    totalCapacity: 0,
    usedCapacity: 0,
    freeCapacity: 0,
    usedPercent: 0,
    disks: [],
    ...overrides,
  } as StorageStats;
}

function renderSwitch(value: StorageStats) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StorageSourceSwitch stats={value} />
    </QueryClientProvider>
  );
}

describe('StorageSourceSwitch', () => {
  it('only shows when both sources are connected', () => {
    const { container } = renderSwitch(stats({ available: { unraid: true, arr: false } }));
    expect(container).toBeEmptyDOMElement();
  });

  it('saves the chosen source', async () => {
    renderSwitch(stats());
    expect(screen.getByRole('radio', { name: 'Unraid' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Sonarr/Radarr' }));
    await waitFor(() => expect(setSource).toHaveBeenCalledWith('arr'));
  });
});
