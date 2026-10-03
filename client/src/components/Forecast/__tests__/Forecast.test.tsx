import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import type { ForecastResult } from '@/types';

const NOW = new Date();
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const GB = 1024 ** 3;

let result: ForecastResult;
const base = (): ForecastResult => ({
  generatedAt: NOW.toISOString(),
  horizonDays: 730,
  rules: [{ id: 1, name: 'Old unwatched movies' }],
  skipped: { protected: 2, excluded: 0, flagOrNotify: 0 },
  deleteRuleCount: 1,
  storage: { configured: true, source: 'unraid', freeBytes: 500 * GB, totalBytes: 1000 * GB, driveCount: 0 },
  scanEnabled: true,
  autoProcess: true,
  diskPressureActive: false,
  items: [
    {
      id: 1, title: 'Moonlight', type: 'movie', year: 2016, libraryKey: '1', posterUrl: null,
      sizeBytes: 10 * GB, freesBytes: 10 * GB, playCount: 0, lastWatchedAt: null, addedAt: null,
      eligibleAt: inDays(5), deleteAt: inDays(10), queued: false, eligibleNow: false,
      ruleId: 1, ruleName: 'Old unwatched movies', certainty: 'predictable',
      reasons: [{ field: 'days_since_added', operator: 'greater_than', value: 365, actual: 366 }],
    },
    {
      id: 2, title: 'Arrival', type: 'movie', year: 2016, libraryKey: '1', posterUrl: null,
      sizeBytes: 20 * GB, freesBytes: 20 * GB, playCount: 1, lastWatchedAt: inDays(-100), addedAt: null,
      eligibleAt: inDays(200), deleteAt: inDays(205), queued: false, eligibleNow: false,
      ruleId: 1, ruleName: 'Old unwatched movies', certainty: 'conditional', reasons: [],
    },
  ],
});

vi.mock('@/services/api', () => ({
  forecastApi: { get: async () => result },
  libraryApi: { getPlexLibraries: async () => [{ key: '1', title: 'Movies', type: 'movie', excluded: false }] },
}));

import Forecast from '../Forecast';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Forecast page', () => {
  it('shows totals, the reason and certainty for each item', async () => {
    result = base();
    renderPage();
    expect(await screen.findAllByText('Moonlight')).not.toHaveLength(0);
    expect(screen.getAllByText('366 days since added (rule: greater than 365)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Predictable').length).toBeGreaterThan(0);
    expect(screen.getByText(/2 protected or excluded items are left out/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Free space if your rules run' })).toBeInTheDocument();
  });

  it('narrows the list to the chosen period', async () => {
    result = base();
    renderPage();
    await screen.findAllByText('Moonlight');
    expect(screen.getAllByText('Arrival').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }));
    expect(screen.queryAllByText('Arrival')).toHaveLength(0);
  });

  it('points to the rules page when there are no delete rules', async () => {
    result = { ...base(), deleteRuleCount: 0, rules: [], items: [] };
    renderPage();
    expect(await screen.findByText('No cleanup rules yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a rule' })).toBeInTheDocument();
  });

  it('counts space reclaimed when no storage is connected', async () => {
    result = { ...base(), storage: { configured: false, source: null, freeBytes: null, totalBytes: null, driveCount: 0 } };
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Space your rules would free' })).toBeInTheDocument();
  });

  it('lists only what a custom range reaches', async () => {
    result = { ...base(), horizonDays: 1825 };
    renderPage();
    await screen.findAllByText('Moonlight');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = (days: number) => {
      const d = new Date(NOW.getTime() + days * 86_400_000);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    fireEvent.change(screen.getByLabelText('To'), { target: { value: local(300) } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: local(100) } });
    expect(screen.queryAllByText('Moonlight')).toHaveLength(0);
    expect(screen.getAllByText('Arrival').length).toBeGreaterThan(0);
    expect(screen.getByText(/: 1 item, 20 GB/)).toBeInTheDocument();
  });

  it('shows a month calendar with each item on its deletion day', async () => {
    result = base();
    renderPage();
    await screen.findAllByText('Moonlight');
    fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }));
    // Moonlight is deleted 10 days out; its day is selected first and listed below.
    const day = new Date(NOW.getTime() + 10 * 86_400_000);
    const label = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(day);
    expect(screen.getByRole('button', { name: `${label}: 1 item, 10 GB` })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Moonlight').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Arrival')).toHaveLength(0);
  });
});
