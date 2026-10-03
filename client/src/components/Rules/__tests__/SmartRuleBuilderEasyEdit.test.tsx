import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import type { Rule } from '@/types';

vi.mock('@/services/api', () => {
  const empty = async () => [];
  return {
    rulesApi: {
      getSuggestions: async () => ({ suggestions: [] }),
      previewV2: async () => ({ totalMatches: 0, wouldQueue: 0, wouldSkipProtected: 0, samples: [], sampleTotal: 0 }),
    },
    libraryApi: {
      getPlexLibraries: async () => [
        { key: '1', title: 'Movies', type: 'movie', excluded: false },
        { key: '2', title: '4K Movies', type: 'movie', excluded: false },
        { key: '3', title: 'TV Shows', type: 'show', excluded: false },
      ],
    },
    usersApi: { list: empty, sync: empty },
    collectionsApi: { list: empty },
    requestersApi: { list: empty },
  };
});

import { SmartRuleBuilder } from '../SmartRuleBuilder';

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: '1',
    name: 'Old unwatched',
    type: 'watch_status',
    action: 'delete',
    enabled: false,
    mediaType: 'movie',
    libraryKeys: [],
    conditions: {
      version: 2,
      root: {
        kind: 'group',
        logic: 'AND',
        children: [
          { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
          { kind: 'condition', field: 'days_since_added', operator: 'greater_than', value: 60 },
        ],
      },
    },
    gracePeriodDays: 14,
    deletionAction: 'unmonitor_only',
    priority: 5,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as Rule;
}

function open(editingRule: Rule) {
  const onSave = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SmartRuleBuilder isOpen onClose={() => undefined} onSave={onSave} editingRule={editingRule} />
    </QueryClientProvider>
  );
  return onSave;
}

describe('editing a rule in Easy Setup', () => {
  it('opens a simple rule in Easy Setup and keeps what it doesn’t show', async () => {
    const onSave = open(rule({}));

    fireEvent.click(screen.getByRole('button', { name: /Easy Setup/ }));
    expect(await screen.findByText('have never been watched')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Old unwatched')).toBeInTheDocument();
    expect(screen.getByDisplayValue('60')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Update/ })[0]!);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      name: 'Old unwatched',
      mediaType: 'movie',
      gracePeriodDays: 14,
      deletionAction: 'unmonitor_only',
      // Easy Setup has no priority or on/off control; editing must keep them.
      priority: 5,
      enabled: false,
      conditions: {
        version: 2,
        root: {
          kind: 'group',
          logic: 'AND',
          children: [
            { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
            { kind: 'condition', field: 'days_since_added', operator: 'greater_than', value: 60 },
          ],
        },
      },
    });
  });

  it('carries Easy Setup edits back to the Custom Builder', async () => {
    const onSave = open(rule({}));

    fireEvent.click(screen.getByRole('button', { name: /Easy Setup/ }));
    fireEvent.change(await screen.findByDisplayValue('60'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /Custom Builder/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /Update/ })[0]!);

    const saved = onSave.mock.calls[0]![0];
    expect(saved.conditions.root.children[1]).toMatchObject({ field: 'days_since_added', value: 120 });
    expect(saved.priority).toBe(5);
  });

  it('shows a condition without wording using the Custom Builder’s inputs', async () => {
    const onSave = open(
      rule({
        conditions: {
          version: 2,
          root: {
            kind: 'group',
            logic: 'AND',
            children: [
              { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
              { kind: 'condition', field: 'title', operator: 'contains', value: 'Christmas' },
            ],
          },
        },
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /Easy Setup/ }));
    expect(await screen.findByText('have never been watched')).toBeInTheDocument();
    const value = screen.getByDisplayValue('Christmas');
    fireEvent.change(value, { target: { value: 'Holiday' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Update/ })[0]!);

    expect(onSave.mock.calls[0]![0].conditions.root.children).toEqual([
      { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
      { kind: 'condition', field: 'title', operator: 'contains', value: 'Holiday' },
    ]);
  });

  it('greys Easy Setup out, with the reason, for a rule it can’t show', async () => {
    open(
      rule({
        conditions: {
          version: 2,
          root: {
            kind: 'group',
            logic: 'NOT',
            children: [
              { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
              { kind: 'condition', field: 'size_gb', operator: 'greater_than', value: 50 },
            ],
          },
        },
      })
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /Easy Setup/ })).toBeDisabled());
    expect(screen.getByText(/it uses Match NONE/)).toBeInTheDocument();
    // Templates start a new rule, so they aren't offered while editing.
    expect(screen.queryByRole('button', { name: /Templates/ })).not.toBeInTheDocument();
  });

  it('opens a rule that matches any condition, and can switch it to all', async () => {
    const onSave = open(
      rule({
        conditions: {
          version: 2,
          root: {
            kind: 'group',
            logic: 'OR',
            children: [
              { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
              { kind: 'condition', field: 'size_gb', operator: 'greater_than', value: 50 },
            ],
          },
        },
      })
    );

    fireEvent.click(await screen.findByRole('button', { name: /Easy Setup/ }));
    expect(await screen.findByText('are larger than')).toBeInTheDocument();
    expect(screen.getByText(/^\s*or\s*$/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Match any' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Match all' }));
    expect(screen.getByText(/^\s*and\s*$/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Update/ })[0]!);
    expect(onSave.mock.calls[0]![0].conditions.root.logic).toBe('AND');
  });

  it('keeps and edits the libraries a rule is limited to', async () => {
    const onSave = open(rule({ libraryKeys: ['2'] }));

    fireEvent.click(await screen.findByRole('button', { name: /Easy Setup/ }));
    // Only the movie libraries are offered for a movie rule.
    await screen.findByRole('button', { name: '4K Movies' });
    expect(screen.queryByRole('button', { name: 'TV Shows' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Movies' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Update/ })[0]!);
    expect(onSave.mock.calls[0]![0].libraryKeys).toEqual(['2', '1']);
  });
});
