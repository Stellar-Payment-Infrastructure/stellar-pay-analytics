import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAmount } from 'stellar-pay-sdk';
import {
  type AverageSizeResponse,
  type Filters,
  getJson,
  type PaymentsResponse,
  rangeProblem,
  type SuccessRateResponse,
  type VolumeResponse,
  windowParams,
} from './api';

export const DECIMALS = 7;
export const TOKEN_CODE = 'XLM';
export const POLL_MS = 30_000;

const fmt = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${formatAmount(v, DECIMALS, { minFractionDigits: 2 })} ${TOKEN_CODE}`);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultFilters(now = new Date()): Filters {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 6);
  return { fromDate: isoDate(from), toDate: isoDate(now), merchantId: '' };
}

function bucketLabel(iso: string, interval: VolumeResponse['interval']): string {
  return interval === 'hour' ? iso.slice(0, 16).replace('T', ' ') + 'Z' : iso.slice(0, 10);
}

function QueryState({ isLoading, error, children }: { isLoading: boolean; error: Error | null; children: React.ReactNode }) {
  if (isLoading) return <div className="skeleton" role="status" aria-label="Loading" />;
  if (error) return <p role="alert" className="error">Could not load: {error.message}</p>;
  return <>{children}</>;
}

export function Dashboard({ initialFilters = defaultFilters(), pollMs = POLL_MS }: { initialFilters?: Filters; pollMs?: number }) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const page = cursors.length - 1;
  const problem = rangeProblem(filters);
  // Never query with an invalid range; keep showing the last good data.
  const params = problem ? null : windowParams(filters);
  const fromId = useId();
  const toId = useId();
  const merchantId = useId();
  const opts = { refetchInterval: pollMs, placeholderData: keepPreviousData, enabled: params !== null } as const;
  const p = params ?? {};

  const volume = useQuery({ queryKey: ['volume', params], queryFn: () => getJson<VolumeResponse>('volume', p), ...opts });
  const rate = useQuery({ queryKey: ['rate', params], queryFn: () => getJson<SuccessRateResponse>('success-rate', p), ...opts });
  const avg = useQuery({ queryKey: ['avg', params], queryFn: () => getJson<AverageSizeResponse>('average-size', p), ...opts });
  const merchants = useQuery({ queryKey: ['merchants'], queryFn: () => getJson<{ data: string[] }>('merchants'), refetchInterval: pollMs });
  const table = useQuery({
    queryKey: ['payments', params, cursors[page]],
    queryFn: () => getJson<PaymentsResponse>('payments', { ...p, limit: '20', cursor: cursors[page] }),
    ...opts,
  });

  const updated = Math.max(volume.dataUpdatedAt, rate.dataUpdatedAt, avg.dataUpdatedAt, table.dataUpdatedAt);
  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setCursors([undefined]);
  };

  const chartData = (volume.data?.buckets ?? []).map((b) => ({
    label: bucketLabel(b.bucket, volume.data?.interval ?? 'day'),
    // Chart geometry only; every label and tooltip shows the exact string.
    value: Number(formatAmount(b.volume, DECIMALS)),
    exact: b.volume,
    count: b.count,
  }));

  return (
    <main className="dashboard">
      <header className="header">
        <div>
          <h1>Stellar Pay Analytics</h1>
          <p className="muted">
            Testnet · near real-time (refreshes every {Math.round(pollMs / 1000)} s) ·{' '}
            {updated > 0 ? (
              <span>
                last updated <time dateTime={new Date(updated).toISOString()}>{new Date(updated).toLocaleTimeString()}</time>
              </span>
            ) : (
              'loading…'
            )}
          </p>
        </div>
        <form className="filters" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor={fromId}>From (UTC)</label>
          <input id={fromId} type="date" value={filters.fromDate} max={filters.toDate} onChange={(e) => update({ fromDate: e.target.value })} />
          <label htmlFor={toId}>To (UTC)</label>
          <input id={toId} type="date" value={filters.toDate} min={filters.fromDate} onChange={(e) => update({ toDate: e.target.value })} />
          <label htmlFor={merchantId}>Merchant</label>
          <select id={merchantId} value={filters.merchantId} onChange={(e) => update({ merchantId: e.target.value })}>
            <option value="">All merchants</option>
            {(merchants.data?.data ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </form>
      </header>
      {problem && (
        <p role="alert" className="error">
          {problem}
        </p>
      )}

      <section className="cards" aria-label="Key metrics">
        <article className="card">
          <h2>Settled volume</h2>
          <QueryState isLoading={volume.isLoading} error={volume.error}>
            <p className="metric">{fmt(volume.data?.total)}</p>
            <p className="muted">{volume.data?.count ?? 0} settled payments</p>
          </QueryState>
        </article>
        <article className="card">
          <h2>Success rate</h2>
          <QueryState isLoading={rate.isLoading} error={rate.error}>
            <p className="metric">{rate.data?.successRate === null || rate.data === undefined ? '—' : `${rate.data.successRate}%`}</p>
            <p className="muted">
              {rate.data?.settled ?? 0} settled of {rate.data?.denominator ?? 0} finished ({rate.data?.inFlight ?? 0} in flight)
            </p>
          </QueryState>
        </article>
        <article className="card">
          <h2>Average payment</h2>
          <QueryState isLoading={avg.isLoading} error={avg.error}>
            <p className="metric">{fmt(avg.data?.average)}</p>
            <p className="muted">over {avg.data?.count ?? 0} settled payments</p>
          </QueryState>
        </article>
      </section>

      <section className="card" aria-labelledby="volume-title">
        <h2 id="volume-title">Settled volume per {volume.data?.interval ?? 'bucket'} (UTC)</h2>
        <QueryState isLoading={volume.isLoading} error={volume.error}>
          {chartData.every((d) => d.count === 0) ? (
            <p className="muted">No settled payments in this range.</p>
          ) : (
            <>
              <div role="img" aria-label={`Bar chart of settled volume, total ${fmt(volume.data?.total)}. The same data is in the table below.`}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" minTickGap={24} />
                    <YAxis />
                    <Tooltip formatter={(_v, _n, item) => [fmt((item.payload as { exact: string }).exact), 'Volume']} />
                    <Bar dataKey="value" name="Volume" fill="var(--chart, #1d4ed8)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details>
                <summary>Volume data table</summary>
                <table>
                  <caption className="visually-hidden">Settled volume per bucket</caption>
                  <thead>
                    <tr>
                      <th scope="col">Bucket</th>
                      <th scope="col">Volume</th>
                      <th scope="col">Payments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((d) => (
                      <tr key={d.label}>
                        <td>{d.label}</td>
                        <td>{fmt(d.exact)}</td>
                        <td>{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </QueryState>
      </section>

      <section className="card" aria-labelledby="payments-title">
        <h2 id="payments-title">Payments</h2>
        <QueryState isLoading={table.isLoading} error={table.error}>
          {(table.data?.data.length ?? 0) === 0 ? (
            <p className="muted">No payments in this range.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Created (UTC)</th>
                  <th scope="col">Status</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Payment id</th>
                </tr>
              </thead>
              <tbody>
                {table.data?.data.map((p) => (
                  <tr key={p.id}>
                    <td>{p.createdAt.replace('T', ' ').slice(0, 19)}</td>
                    <td>
                      <span className={`badge badge-${p.status}`}>{p.status}</span>
                    </td>
                    <td>{fmt(p.amount)}</td>
                    <td>{p.settleMode}</td>
                    <td className="mono" title={p.id}>
                      {p.id.slice(0, 10)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <nav className="pager" aria-label="Payments pages">
            <button type="button" onClick={() => setCursors((c) => c.slice(0, -1))} disabled={page === 0}>
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              type="button"
              onClick={() => table.data?.nextCursor && setCursors((c) => [...c, table.data?.nextCursor ?? undefined])}
              disabled={!table.data?.nextCursor}
            >
              Next
            </button>
          </nav>
        </QueryState>
      </section>
    </main>
  );
}
