import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  collectionsApi: {
    list: vi.fn(),
    sync: vi.fn(),
  },
}));

import { collectionsApi } from '@/services/api';
import Collections from '../Collections';

function renderCollections() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Collections />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const mockCollections = [
  {
    id: 1,
    title: 'The Lord of the Rings',
    itemCount: 3,
    isProtected: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 2,
    title: 'Marvel Cinematic Universe',
    itemCount: 30,
    isProtected: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

describe('Collections', () => {
  beforeEach(() => {
    vi.mocked(collectionsApi.list).mockResolvedValue(mockCollections);
    vi.mocked(collectionsApi.sync).mockResolvedValue({
      collectionsSynced: 2,
      itemsMatched: 5,
    });
  });

  it('renders collection cards', async () => {
    renderCollections();
    const lotrMatches = await screen.findAllByText('The Lord of the Rings');
    expect(lotrMatches.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Marvel Cinematic Universe').length).toBeGreaterThan(0);
  });

  it('filters collections by search', async () => {
    renderCollections();
    await screen.findAllByText('The Lord of the Rings');

    const searchBox = screen.getByTestId('collections-search') as HTMLInputElement;
    fireEvent.change(searchBox, { target: { value: 'marvel' } });

    await waitFor(() => {
      expect(screen.queryByText('The Lord of the Rings')).toBeNull();
    });
    expect(screen.getAllByText('Marvel Cinematic Universe').length).toBeGreaterThan(0);
  });

  it('calls sync API when sync button is clicked', async () => {
    renderCollections();
    await screen.findAllByText('The Lord of the Rings');

    const syncButton = screen.getByTestId('sync-collections-button');
    fireEvent.click(syncButton);

    await waitFor(() => {
      expect(collectionsApi.sync).toHaveBeenCalled();
    });
  });

  it('shows empty state when no collections', async () => {
    vi.mocked(collectionsApi.list).mockResolvedValue([]);
    renderCollections();
    expect(await screen.findByText(/No collections yet/i)).toBeTruthy();
  });
});
