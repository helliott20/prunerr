import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  collectionsApi: {
    getById: vi.fn(),
    getItems: vi.fn(),
    setProtection: vi.fn(),
  },
}));

import { collectionsApi } from '@/services/api';
import CollectionDetail from '../CollectionDetail';

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/collections/1']}>
        <Routes>
          <Route path="/collections/:id" element={<CollectionDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const baseCollection = {
  id: 1,
  title: 'MCU',
  itemCount: 2,
  isProtected: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('CollectionDetail', () => {
  beforeEach(() => {
    vi.mocked(collectionsApi.getById).mockResolvedValue(baseCollection);
    vi.mocked(collectionsApi.getItems).mockResolvedValue([]);
    vi.mocked(collectionsApi.setProtection).mockResolvedValue({
      ...baseCollection,
      isProtected: true,
    });
  });

  it('renders the collection title and protect button', async () => {
    renderDetail();
    expect(await screen.findByText('MCU')).toBeTruthy();
    const toggle = screen.getByTestId('protection-toggle');
    expect(toggle.textContent).toContain('Protect this collection');
  });

  it('opens confirm dialog then calls setProtection with isProtected=true', async () => {
    renderDetail();
    await screen.findByText('MCU');

    fireEvent.click(screen.getByTestId('protection-toggle'));

    const confirmButton = await screen.findByRole('button', { name: 'Protect' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(collectionsApi.setProtection).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ isProtected: true })
      );
    });
  });

  it('shows Unprotect label when already protected', async () => {
    vi.mocked(collectionsApi.getById).mockResolvedValue({
      ...baseCollection,
      isProtected: true,
      protectedAt: '2024-01-01T00:00:00Z',
      protectionReason: 'Manual',
    });
    renderDetail();
    await screen.findByText('MCU');
    const toggle = screen.getByTestId('protection-toggle');
    expect(toggle.textContent).toContain('Unprotect');
  });
});
