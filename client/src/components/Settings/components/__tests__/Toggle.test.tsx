import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from '../Toggle';

describe('Toggle', () => {
  it('exposes switch semantics reflecting the checked state', () => {
    render(<Toggle checked onChange={() => {}} label="Automatic scanning" />);

    const toggle = screen.getByRole('switch', { name: 'Automatic scanning' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('reports aria-checked false when off', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Automatic scanning" />);

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the negated value', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Automatic scanning" />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not fire when disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Automatic scanning" disabled />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('anchors the knob to the left edge of the track', () => {
    // Without left-0 the knob resolves to the button's centred static position
    // and slides straight out of the track when checked.
    const { container } = render(<Toggle checked onChange={() => {}} label="Automatic scanning" />);

    const knob = container.querySelector('[data-track] > span');
    expect(knob).toHaveClass('left-0');
  });

  it('renders a larger track for the mobile size', () => {
    // Mobile hit targets have to clear 44px; the track itself is 48x28.
    const { container } = render(
      <Toggle checked onChange={() => {}} label="Automatic scanning" size="lg" />
    );

    expect(container.querySelector('[data-track]')).toHaveClass('w-12');
  });
});
