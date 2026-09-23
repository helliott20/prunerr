import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Dropdown } from '../Dropdown';

const OPTIONS = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Once per day' },
  { value: 'weekly', label: 'Once per week', disabled: true },
];

describe('Dropdown', () => {
  it('shows the selected label on the trigger', () => {
    render(<Dropdown value="daily" options={OPTIONS} onChange={() => {}} ariaLabel="Interval" />);
    const trigger = screen.getByRole('combobox', { name: 'Interval' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Once per day');
  });

  it('opens on click and passes the value (not an event) to onChange', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<Dropdown value="daily" options={OPTIONS} onChange={onChange} ariaLabel="Interval" />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Once per day' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('option', { name: 'Every hour' }));
    expect(onChange).toHaveBeenCalledWith('hourly');
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('skips disabled options with the arrow keys and selects with Enter', () => {
    const onChange = vi.fn();
    render(<Dropdown value="hourly" options={OPTIONS} onChange={onChange} ariaLabel="Interval" />);
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // opens on "hourly"
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // daily
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // weekly is disabled → wraps to hourly
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // daily
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('daily');
  });

  it('Escape closes the menu without bubbling to a parent modal', () => {
    const parent = vi.fn();
    render(
      <div onKeyDown={parent}>
        <Dropdown value="daily" options={OPTIONS} onChange={() => {}} ariaLabel="Interval" />
      </div>
    );
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(parent).not.toHaveBeenCalled();
  });

  it('filters when searchable', () => {
    render(<Dropdown value={null} options={OPTIONS} onChange={() => {}} ariaLabel="Interval" searchable />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'week' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
});
