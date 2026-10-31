/** Typed client for the aggregator's /stats endpoints (served under /api). */

export interface VolumeResponse {
  from: string;
  to: string;
  interval: 'hour' | 'day' | 'week';
  total: string;
  count: number;
  buckets: { bucket: string; volume: string; count: number }[];
}

export interface SuccessRateResponse {
  settled: number;
  refunded: number;
  cancelled: number;
  failed: number;
  inFlight: number;
  denominator: number;
  successRateBps: number | null;
  successRate: string | null;
}

export interface AverageSizeResponse {
  count: number;
  total: string;
  average: string | null;
}

export interface PaymentRow {
  id: string;
  merchantId: string;
  status: string;
  amount: string;
  settleMode: string;
  fee: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentsResponse {
  data: PaymentRow[];
  nextCursor: string | null;
}

export class StatsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'StatsError';
  }
}

export interface Filters {
  /** Inclusive start date, YYYY-MM-DD (UTC). */
  fromDate: string;
  /** Inclusive end date, YYYY-MM-DD (UTC). */
  toDate: string;
  merchantId: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Why the filters cannot be queried, or null if they are fine. */
export function rangeProblem(f: Filters): string | null {
  const ok = (d: string) => DATE_RE.test(d) && !Number.isNaN(new Date(`${d}T00:00:00.000Z`).getTime());
  if (!ok(f.fromDate) || !ok(f.toDate)) return 'Choose a valid start and end date.';
  if (f.fromDate > f.toDate) return 'The start date must not be after the end date.';
  return null;
}

/** Inclusive UTC calendar dates -> half-open ISO window [from, to+1d). Call only when `rangeProblem` is null. */
export function windowParams(f: Filters): Record<string, string> {
  const from = new Date(`${f.fromDate}T00:00:00.000Z`);
  const to = new Date(`${f.toDate}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    ...(f.merchantId ? { merchant_id: f.merchantId } : {}),
  };
}

export async function getJson<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const res = await fetch(`/api/stats/${path}${qs.size ? `?${qs.toString()}` : ''}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new StatsError(res.status, body?.error?.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}
