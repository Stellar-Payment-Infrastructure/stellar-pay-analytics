import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rangeProblem, windowParams } from '../api';
import { Dashboard, defaultFilters } from '../Dashboard';

const FILTERS = { fromDate: '2026-03-01', toDate: '2026-03-02', merchantId: '' };

function payments(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: (offset + i).toString(16).padStart(64, 'a'),
    merchantId: 'm1',
    status: i % 2 ? 'refunded' : 'settled',
    amount: '12500000',
    settleMode: 'auto',
    fee: null,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
  }));
}

type Handler = (url: URL) => { status?: number; body: unknown };

function mockApi(overrides: Record<string, Handler> = {}) {
  const calls: URL[] = [];
  const handlers: Record<string, Handler> = {
    volume: () => ({
      body: {
        interval: 'day', total: '35000001', count: 3,
        buckets: [
          { bucket: '2026-03-01T00:00:00Z', volume: '35000000', count: 2 },
          { bucket: '2026-03-02T00:00:00Z', volume: '1', count: 1 },
        ],
      },
    }),
    'success-rate': () => ({ body: { settled: 3, refunded: 1, cancelled: 0, failed: 0, inFlight: 2, denominator: 4, successRateBps: 7500, successRate: '75.00' } }),
    'average-size': () => ({ body: { count: 3, total: '35000001', average: '11666667' } }),
    merchants: () => ({ body: { data: ['11111111-1111-4111-8111-111111111111'] } }),
    payments: (u) => (u.searchParams.get('cursor') ? { body: { data: payments(5, 20), nextCursor: null } } : { body: { data: payments(20), nextCursor: 'c1' } }),
    ...overrides,
  };
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'http://localhost');
    calls.push(url);
    const name = url.pathname.replace('/api/stats/', '');
    const h = handlers[name];
    const r = h ? h(url) : { status: 404, body: { error: { message: 'nope' } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return calls;
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Dashboard initialFilters={FILTERS} pollMs={60_000} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

async function noViolations(container: Element) {
  const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

describe('Dashboard', () => {
  it('shows exact metrics formatted from base units', async () => {
    mockApi();
    const { container } = renderDashboard();
    expect(await screen.findByText('3.5000001 XLM')).toBeInTheDocument();
    expect(screen.getByText('75.00%')).toBeInTheDocument();
    expect(screen.getByText('1.1666667 XLM')).toBeInTheDocument();
    expect(screen.getByText('3 settled of 4 finished (2 in flight)')).toBeInTheDocument();
    expect(screen.getByText(/last updated/)).toBeInTheDocument();
    await noViolations(container);
  });

  it('gives the chart a text alternative and an adjacent data table', async () => {
    mockApi();
    renderDashboard();
    const chart = await screen.findByRole('img', { name: /Bar chart of settled volume, total 3.5000001 XLM/ });
    expect(chart).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Settled volume per bucket' });
    expect(within(table).getByText('3.50 XLM')).toBeInTheDocument();
    expect(within(table).getByText('0.0000001 XLM')).toBeInTheDocument();
  });

  it('sends the filters as a half-open UTC window and paginates the table', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderDashboard();
    await screen.findAllByText('1.25 XLM');
    const vol = calls.find((c) => c.pathname.endsWith('/volume'));
    expect(vol?.searchParams.get('from')).toBe('2026-03-01T00:00:00.000Z');
    expect(vol?.searchParams.get('to')).toBe('2026-03-03T00:00:00.000Z');
    expect(screen.getAllByRole('row')).toHaveLength(21 + 3);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(calls.some((c) => c.pathname.endsWith('/payments') && c.searchParams.get('cursor') === 'c1')).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Page 1')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Merchant'), '11111111-1111-4111-8111-111111111111');
    await screen.findByText('Page 1');
    expect(calls.some((c) => c.searchParams.get('merchant_id') === '11111111-1111-4111-8111-111111111111')).toBe(true);
  });

  it('shows empty states', async () => {
    mockApi({
      volume: () => ({ body: { interval: 'day', total: '0', count: 0, buckets: [{ bucket: '2026-03-01T00:00:00Z', volume: '0', count: 0 }] } }),
      'success-rate': () => ({ body: { settled: 0, refunded: 0, cancelled: 0, failed: 0, inFlight: 0, denominator: 0, successRateBps: null, successRate: null } }),
      'average-size': () => ({ body: { count: 0, total: '0', average: null } }),
      payments: () => ({ body: { data: [], nextCursor: null } }),
    });
    const { container } = renderDashboard();
    expect(await screen.findByText('No settled payments in this range.')).toBeInTheDocument();
    expect(screen.getByText('No payments in this range.')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    await noViolations(container);
  });

  it('shows error states without crashing', async () => {
    mockApi({ volume: () => ({ status: 503, body: { error: { message: 'aggregator unavailable' } } }) });
    renderDashboard();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent?.includes('aggregator unavailable'))).toBe(true);
    expect(await screen.findByText('75.00%')).toBeInTheDocument();
  });

  it('flags an inverted date range', async () => {
    mockApi();
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('75.00%');
    const from = screen.getByLabelText('From (UTC)');
    await user.clear(from);
    // A cleared date must not crash the page or send a bad query.
    expect(await screen.findByText('Choose a valid start and end date.')).toBeInTheDocument();
    expect(screen.getByText('75.00%')).toBeInTheDocument();
    await user.type(from, '2026-03-05');
    expect(await screen.findByText('The start date must not be after the end date.')).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('converts inclusive dates to a half-open window', () => {
    expect(windowParams({ fromDate: '2026-12-31', toDate: '2026-12-31', merchantId: 'm' })).toEqual({
      from: '2026-12-31T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
      merchant_id: 'm',
    });
    expect(defaultFilters(new Date('2026-03-10T12:00:00Z'))).toEqual({ fromDate: '2026-03-04', toDate: '2026-03-10', merchantId: '' });
    expect(rangeProblem({ fromDate: '', toDate: '2026-01-01', merchantId: '' })).toMatch(/valid/);
    expect(rangeProblem({ fromDate: '2026-02-30', toDate: '2026-03-01', merchantId: '' })).toBeNull();
    expect(rangeProblem({ fromDate: '2026-01-02', toDate: '2026-01-01', merchantId: '' })).toMatch(/after/);
  });
});
