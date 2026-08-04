import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../SegmentedControl';

const OPTIONS = [
  { value: 'plex', label: 'Plex direct' },
  { value: 'tautulli', label: 'Tautulli' },
  { value: 'tracearr', label: 'Tracearr' },
];

describe('SegmentedControl', () => {
  it('renders one radio per option with the selected one checked', () => {
    render(
      <SegmentedControl value="tautulli" options={OPTIONS} onChange={() => {}} ariaLabel="Watch history provider" />
    );

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Tautulli' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Plex direct' })).toHaveAttribute('aria-checked', 'false');
  });

  it('selects nothing when value is null', () => {
    // First run: no provider has been chosen yet.
    render(
      <SegmentedControl value={null} options={OPTIONS} onChange={() => {}} ariaLabel="Watch history provider" />
    );

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('calls onChange with the clicked option value', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="plex" options={OPTIONS} onChange={onChange} ariaLabel="Watch history provider" />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Tracearr' }));

    expect(onChange).toHaveBeenCalledWith('tracearr');
  });

  it('does not fire for a disabled option and explains why', () => {
    // Tautulli and Tracearr only resolve Plex item ids, so they are offered but
    // unselectable on a Jellyfin or Emby install.
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="plex"
        options={[
          { value: 'plex', label: 'Jellyfin direct' },
          { value: 'tautulli', label: 'Tautulli', disabled: true, title: 'Requires Plex' },
        ]}
        onChange={onChange}
        ariaLabel="Watch history provider"
      />
    );

    const tautulli = screen.getByRole('radio', { name: 'Tautulli' });
    fireEvent.click(tautulli);

    expect(onChange).not.toHaveBeenCalled();
    expect(tautulli).toHaveAttribute('title', 'Requires Plex');
  });
});
