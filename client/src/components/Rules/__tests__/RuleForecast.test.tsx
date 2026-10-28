import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  it('shows what the rule reaches later, not what it matches today', async () => {
    forecast.mockResolvedValue({ proposed: [point(0, 13, 30), point(90, 25, 170), point(365, 60, 650)], saved: null });
    renderForecast();
    expect(await screen.findByText('+12 items · 140 GB', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText('+47 items · 620 GB')).toBeInTheDocument();
    expect(screen.queryByText(/13 items/)).not.toBeInTheDocument();
  });

  it('stays hidden when nothing more comes and nothing was changed', async () => {
    const flat = [point(0, 13, 30), point(90, 13, 30), point(365, 13, 30)];
    forecast.mockResolvedValue({ proposed: flat, saved: flat });
    const { container } = renderForecast({ ruleId: 4 });
    await waitFor(() => expect(forecast).toHaveBeenCalled(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows when an edit brings items forward, even if the year ends the same', async () => {
    forecast.mockResolvedValue({
      proposed: [point(0, 19, 115), point(90, 25, 160), point(365, 30, 202)],
      saved: [point(0, 11, 75), point(90, 20, 130), point(365, 30, 202)],
    });
    renderForecast({ mediaType: 'movie', ruleId: 4, deletionAction: 'unmonitor_and_delete' });
    expect(
      await screen.findByText('Your change: +8 items · +40 GB at the next scan, compared with the saved rule', {}, { timeout: 2000 })
    ).toBeInTheDocument();
    expect(forecast).toHaveBeenCalledWith(expect.objectContaining({ version: 2, ruleId: 4, mediaType: 'movie' }));
  });

  it('still shows an edit’s effect on a rule that doesn’t depend on time', async () => {
    const flat = (n: number, gb: number) => [point(0, n, gb), point(90, n, gb), point(365, n, gb)];
    forecast.mockResolvedValue({ proposed: flat(20, 50), saved: flat(13, 30) });
    renderForecast({ ruleId: 4 });
    expect(await screen.findByText('Reaches nothing more within a year.', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/Your change: \+7 items · \+20 GB at the next scan/)).toBeInTheDocument();
  });
});
