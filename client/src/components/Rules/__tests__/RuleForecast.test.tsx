import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const GB = 1024 ** 3;
const forecast = vi.fn();
vi.mock('@/services/api', () => ({ rulesApi: { forecast: (body: unknown) => forecast(body) } }));

import { RuleForecast } from '../RuleForecast';

const root = { kind: 'group' as const, logic: 'AND' as const, children: [] };
const point = (day: number, items: number, gb: number) => ({ day, items, bytes: gb * GB, predictableBytes: 0 });

function renderForecast(props: Partial<Parameters<typeof RuleForecast>[0]> = {}) {
  return render(
    <MemoryRouter>
      <RuleForecast root={root} {...props} />
    </MemoryRouter>
  );
}

describe('RuleForecast', () => {
  it('shows when an edit brings items forward, even if the year ends the same', async () => {
    forecast.mockResolvedValue({
      proposed: [point(0, 19, 115), point(90, 25, 160), point(365, 30, 202)],
      saved: [point(0, 11, 75), point(90, 20, 130), point(365, 30, 202)],
    });
    renderForecast({ mediaType: 'movie', ruleId: 4, deletionAction: 'unmonitor_and_delete' });
    expect(await screen.findByText('Next scan: +8 items · +40 GB compared with the saved rule', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText('19 items')).toBeInTheDocument();
    expect(screen.getByText('11 items')).toBeInTheDocument();
    expect(forecast).toHaveBeenCalledWith(expect.objectContaining({ version: 2, ruleId: 4, mediaType: 'movie' }));
  });

  it('says so when nothing changes', async () => {
    const same = [point(0, 5, 10), point(90, 6, 12), point(365, 9, 20)];
    forecast.mockResolvedValue({ proposed: same, saved: same });
    renderForecast({ ruleId: 4 });
    expect(await screen.findByText('Same as the saved rule.', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('shows one column for a new rule', async () => {
    forecast.mockResolvedValue({ proposed: [point(0, 1, 1), point(90, 2, 2), point(365, 12, 50)], saved: null });
    renderForecast();
    expect(await screen.findByText('This rule', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});
