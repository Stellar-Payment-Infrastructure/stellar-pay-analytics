/**
 * Aggregations. Definitions are in docs/METRICS.md; every number here is
 * computed with integer arithmetic on base units (no floats).
 */
import { and, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db.js';
import { rowsOf } from './db.js';
import { payments } from './schema.js';

export type Interval = 'hour' | 'day' | 'week';
const INTERVAL_MS: Record<Interval, number> = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
export const MAX_BUCKETS = 2_000;

export interface Window {
  from: Date;
  to: Date;
  merchantId?: string;
}

/** Default bucket size by window length (METRICS.md): ≤7d hour, ≤90d day, else week. */
export function autoInterval(w: Window): Interval {
  const days = (w.to.getTime() - w.from.getTime()) / 86_400_000;
  if (days <= 7) return 'hour';
  if (days <= 90) return 'day';
  return 'week';
}

export function bucketCount(w: Window, interval: Interval): number {
  return Math.ceil((w.to.getTime() - w.from.getTime()) / INTERVAL_MS[interval]) + 1;
}

function windowWhere(w: Window, extra: SQL[] = []): SQL {
  const conds: SQL[] = [gte(payments.createdAt, w.from), lt(payments.createdAt, w.to), ...extra];
  if (w.merchantId) conds.push(eq(payments.merchantId, w.merchantId));
  return and(...conds) as SQL;
}

export interface VolumeBucket {
  bucket: string;
  volume: string;
  count: number;
}

/** Settled volume per UTC bucket, zero-filled across the whole window. */
// TODO(wave: analytics-2): per-token breakdown (volume, count, average by
// token). v0.1.0 has a single token; use fixture data until core-1 lands.
export async function volume(db: Db, w: Window, interval: Interval): Promise<{ total: string; count: number; buckets: VolumeBucket[] }> {
  const merchantCond = w.merchantId ? sql`AND p.merchant_id = ${w.merchantId}` : sql``;
  const res = await db.execute(sql`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${interval}, ${w.from.toISOString()}::timestamptz AT TIME ZONE 'UTC'),
        (${w.to.toISOString()}::timestamptz AT TIME ZONE 'UTC') - interval '1 microsecond',
        ('1 ' || ${interval})::interval
      ) AS bucket
    )
    SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket,
           COALESCE(SUM(p.amount), 0)::text AS volume,
           COUNT(p.id)::int AS count
    FROM buckets b
    LEFT JOIN payments p
      ON p.status = 'settled'
     AND date_trunc(${interval}, p.created_at AT TIME ZONE 'UTC') = b.bucket
     AND p.created_at >= ${w.from.toISOString()}::timestamptz
     AND p.created_at < ${w.to.toISOString()}::timestamptz
     ${merchantCond}
    GROUP BY b.bucket
    ORDER BY b.bucket
  `);
  const buckets = rowsOf<{ bucket: string; volume: string; count: number }>(res).map((r) => ({
    bucket: r.bucket,
    volume: String(r.volume),
    count: Number(r.count),
  }));
  const total = buckets.reduce((acc, b) => acc + BigInt(b.volume), 0n);
  return { total: total.toString(), count: buckets.reduce((a, b) => a + b.count, 0), buckets };
}

export interface SuccessRate {
  settled: number;
  refunded: number;
  cancelled: number;
  failed: number;
  inFlight: number;
  denominator: number;
  /** settled / denominator in basis points (floor), null when denominator is 0. */
  successRateBps: number | null;
  /** Percentage with two decimals, e.g. "83.33"; null when denominator is 0. */
  successRate: string | null;
}

export async function successRate(db: Db, w: Window): Promise<SuccessRate> {
  const rows = await db
    .select({ status: payments.status, count: sql<number>`count(*)::int` })
    .from(payments)
    .where(windowWhere(w))
    .groupBy(payments.status);
  const n = (s: string) => Number(rows.find((r) => r.status === s)?.count ?? 0);
  const settled = n('settled');
  const refunded = n('refunded');
  const cancelled = n('cancelled');
  const failed = n('failed');
  const inFlight = n('pending') + n('created') + n('paid');
  const denominator = settled + refunded + cancelled + failed;
  if (denominator === 0) {
    return { settled, refunded, cancelled, failed, inFlight, denominator, successRateBps: null, successRate: null };
  }
  const bps = Math.floor((settled * 10_000) / denominator);
  return {
    settled, refunded, cancelled, failed, inFlight, denominator,
    successRateBps: bps,
    successRate: `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`,
  };
}

export async function averageSize(db: Db, w: Window): Promise<{ count: number; total: string; average: string | null }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${payments.amount}), 0)::text` })
    .from(payments)
    .where(windowWhere(w, [eq(payments.status, 'settled')]));
  const count = Number(row?.count ?? 0);
  const total = BigInt(row?.total ?? '0');
  // Floor division in base units.
  return { count, total: total.toString(), average: count === 0 ? null : (total / BigInt(count)).toString() };
}

export interface PaymentRowOut {
  id: string;
  merchantId: string;
  status: string;
  amount: string;
  token: string;
  settleMode: string;
  fee: string | null;
  createdAt: string;
  updatedAt: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
}

export function decodeCursor(c: string): { createdAt: Date; id: string } | null {
  try {
    const [t, id] = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as [string, string];
    const createdAt = new Date(t);
    if (typeof id !== 'string' || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Newest first, keyset-paginated. */
export async function listPayments(
  db: Db,
  w: Window,
  opts: { status?: string; limit: number; cursor?: { createdAt: Date; id: string } },
): Promise<{ data: PaymentRowOut[]; nextCursor: string | null }> {
  const extra: SQL[] = [];
  if (opts.status) extra.push(eq(payments.status, opts.status));
  if (opts.cursor) {
    extra.push(
      or(
        lt(payments.createdAt, opts.cursor.createdAt),
        and(eq(payments.createdAt, opts.cursor.createdAt), lt(payments.id, opts.cursor.id)),
      ) as SQL,
    );
  }
  const rows = await db
    .select()
    .from(payments)
    .where(windowWhere(w, extra))
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  return {
    data: page.map((r) => ({
      id: r.id,
      merchantId: r.merchantId,
      status: r.status,
      amount: r.amount,
      token: r.token,
      settleMode: r.settleMode,
      fee: r.fee,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > opts.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function merchants(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ id: payments.merchantId }).from(payments).orderBy(payments.merchantId);
  return rows.map((r) => r.id);
}
