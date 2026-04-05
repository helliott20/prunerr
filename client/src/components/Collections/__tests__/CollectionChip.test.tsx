import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CollectionChip } from '../CollectionChip';

function renderChip(props: Parameters<typeof CollectionChip>[0]) {
  return render(
    <MemoryRouter>
      <CollectionChip {...props} />
    </MemoryRouter>
  );
}

describe('CollectionChip', () => {
  it('renders the collection title', () => {
    renderChip({ id: 1, title: 'The Lord of the Rings' });
    expect(screen.getByText('The Lord of the Rings')).toBeTruthy();
  });

  it('links to the collection detail page', () => {
    renderChip({ id: 42, title: 'MCU' });
    const link = screen.getByTestId('collection-chip') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/collections/42');
  });

  it('shows a shield icon when the collection is protected', () => {
    renderChip({ id: 1, title: 'MCU', isProtected: true });
    expect(screen.getByTestId('collection-chip-shield')).toBeTruthy();
  });

  it('does not show the shield icon when the collection is not protected', () => {
    renderChip({ id: 1, title: 'MCU', isProtected: false });
    expect(screen.queryByTestId('collection-chip-shield')).toBeNull();
  });
});
