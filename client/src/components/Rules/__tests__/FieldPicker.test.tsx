import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldPicker } from '../FieldPicker';

describe('FieldPicker keyboard', () => {
  const onDocEscape = vi.fn((e: KeyboardEvent) => {
    // Mirrors the rule builder's document-level close handler.
    if (e.key === 'Escape' && !e.defaultPrevented) closeModal();
  });
  const closeModal = vi.fn();
  afterEach(() => {
    document.removeEventListener('keydown', onDocEscape);
    closeModal.mockClear();
  });

  it('drives the menu from the trigger and keeps Escape away from the modal', () => {
    document.addEventListener('keydown', onDocEscape);
    const onChange = vi.fn();
    render(<FieldPicker value="title" onChange={onChange} />);
    const trigger = screen.getByRole('button', { expanded: false });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Focus may still be on the trigger (e.g. before the menu is placed).
    const before = screen.getAllByRole('option').findIndex((o) => o.className.includes('text-surface-50'));
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const after = screen.getAllByRole('option').findIndex((o) => o.className.includes('text-surface-50'));
    expect(after).not.toBe(before);

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(closeModal).not.toHaveBeenCalled();
  });
});
