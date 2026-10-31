import { StellarPay, type FetchLike, type Payment } from 'stellar-pay-sdk';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { ingestSource, upsertPayments } from '../src/ingest.js';
import { payments } from '../src/schema.js';
import { autoInterval, averageSize, successRate, volume } from '../src/stats.js';
import { apiPayment, FIXTURE, MERCHANT_A, MERCHANT_B, silentLogger, testDb, WINDOW } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await testDb());
});
afterEach(async () => {
  await close();
});

async function loadFixture() {
  for (const m of [MERCHANT_A, MERCHANT_B]) {
    await upsertPayments(db, m, FIXTURE.filter((f) => f.merchant === m).map((f) => f.payment));
  }
}

describe('metrics (docs/METRICS.md worked example, reproduced exactly)', () => {
  it('volume: settled only, UTC day buckets, half-open window', async () => {
    await loadFixture();
    const v = await volume(db, WINDOW, 'day');
    expect(v.buckets).toEqual([
      { bucket: '2026-03-01T00:00:00Z', volume: '3500000', count: 2 },
      { bucket: '2026-03-02T00:00:00Z', volume: '10500001', count: 2 },
    ]);
    expect(v.total).toBe('14000001');
    expect(v.count).toBe(4);
  });

  it('volume per merchant, zero-filled hourly buckets', async () => {
    await loadFixture();
    const v = await volume(db, { ...WINDOW, merchantId: MERCHANT_A }, 'hour');
    expect(v.buckets).toHaveLength(48);
    expect(v.total).toBe('4000001');
    expect(v.buckets[0]).toEqual({ bucket: '2026-03-01T00:00:00Z', volume: '1000000', count: 1 });
    expect(v.buckets[23]).toEqual({ bucket: '2026-03-01T23:00:00Z', volume: '2500000', count: 1 });
    expect(v.buckets[24]).toEqual({ bucket: '2026-03-02T00:00:00Z', volume: '500001', count: 1 });
    expect(v.buckets.filter((b) => b.count === 0)).toHaveLength(45);
  });

  it('success rate: settled / (settled + refunded + cancelled + failed), in-flight excluded', async () => {
    await loadFixture();
    expect(await successRate(db, WINDOW)).toEqual({
      settled: 4, refunded: 1, cancelled: 1, failed: 1, inFlight: 1, denominator: 7, successRateBps: 5714, successRate: '57.14',
    });
    expect(await successRate(db, { ...WINDOW, merchantId: MERCHANT_A })).toMatchObject({ denominator: 5, successRateBps: 6000, successRate: '60.00' });
    expect(await successRate(db, { from: new Date('2020-01-01Z'), to: new Date('2020-01-02Z') })).toMatchObject({
      denominator: 0, successRate: null, successRateBps: null,
    });
  });

  it('average size: floor(sum / count) over settled, in base units', async () => {
    await loadFixture();
    expect(await averageSize(db, WINDOW)).toEqual({ count: 4, total: '14000001', average: '3500000' });
    expect(await averageSize(db, { ...WINDOW, merchantId: MERCHANT_A })).toEqual({ count: 3, total: '4000001', average: '1333333' });
    expect(await averageSize(db, { from: new Date('2020-01-01Z'), to: new Date('2020-01-02Z') })).toEqual({ count: 0, total: '0', average: null });
  });

  it('weekly buckets start on Monday (ISO, UTC)', async () => {
    await loadFixture();
    const v = await volume(db, { from: new Date('2026-02-23T00:00:00Z'), to: new Date('2026-03-09T00:00:00Z') }, 'week');
    // 2026-02-23 and 2026-03-02 are Mondays.
    expect(v.buckets.map((b) => [b.bucket, b.volume])).toEqual([
      ['2026-02-23T00:00:00Z', '3500001'],
      ['2026-03-02T00:00:00Z', '10501000'], // 500001 + 10000000 + 999 (03-03 is inside this window)
    ]);
  });

  it('handles i128-scale amounts without precision loss', async () => {
    const big = '170141183460469231731687303715884105727';
    await upsertPayments(db, MERCHANT_A, [apiPayment({ id: 'b1', amount: big, createdAt: '2026-03-01T01:00:00Z' })]);
    expect((await volume(db, WINDOW, 'day')).total).toBe(big);
  });

  it('picks the bucket size from the window length', () => {
    const d = (days: number) => ({ from: new Date(0), to: new Date(days * 86_400_000) });
    expect(autoInterval(d(7))).toBe('hour');
    expect(autoInterval(d(8))).toBe('day');
    expect(autoInterval(d(90))).toBe('day');
    expect(autoInterval(d(91))).toBe('week');
  });
});

/** Minimal fake of the API's /v1/merchant and `updated_since` feed. */
function fakeApi(merchantId: string, feed: () => Payment[]) {
  const calls: URL[] = [];
  const fetch: FetchLike = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (u.pathname === '/v1/merchant') return Response.json({ id: merchantId });
    const since = u.searchParams.get('updated_since') ?? '';
    const limit = Number(u.searchParams.get('limit'));
    const after = u.searchParams.get('cursor');
    const rows = feed()
      .filter((p) => p.updatedAt >= since)
      .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt < b.updatedAt ? -1 : 1));
    const start = after ? rows.findIndex((p) => `${p.updatedAt}|${p.id}` === after) + 1 : 0;
    const page = rows.slice(start, start + limit);
    const hasMore = start + limit < rows.length;
    const last = page[page.length - 1];
    return Response.json({ data: page, hasMore, nextCursor: hasMore && last ? `${last.updatedAt}|${last.id}` : null });
  };
  return { client: new StellarPay({ apiKey: 'sk_test_reader', baseUrl: 'https://api.example', fetch }), calls };
}

describe('ingestion', () => {
  it('pages through the updated_since feed and persists a cursor', async () => {
    const feed = Array.from({ length: 250 }, (_, i) =>
      apiPayment({ id: `i${i}`, amount: String(i + 1), createdAt: '2026-03-01T00:00:00Z', updatedAt: new Date(Date.UTC(2026, 2, 1, 0, 0, i)).toISOString() }),
    );
    const { client, calls } = fakeApi(MERCHANT_A, () => feed);
    const res = await ingestSource(db, client, silentLogger);
    expect(res).toMatchObject({ merchantId: MERCHANT_A, upserted: 250, pages: 3 });
    expect(res.updatedSince).toBe(feed[249]?.updatedAt);
    expect((await db.select().from(payments)).length).toBe(250);
    // Next run starts from the cursor and only re-reads the boundary row.
    calls.length = 0;
    const again = await ingestSource(db, client, silentLogger);
    expect(again.upserted).toBe(1);
    expect(calls.find((c) => c.pathname === '/v1/payments')?.searchParams.get('updated_since')).toBe(feed[249]?.updatedAt);
  });

  it('is idempotent and never regresses a payment to an older snapshot', async () => {
    const p = apiPayment({ id: 'x1', status: 'created', amount: '10', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' });
    await upsertPayments(db, MERCHANT_A, [p]);
    await upsertPayments(db, MERCHANT_A, [{ ...p, status: 'settled', fee: '0', updatedAt: '2026-03-01T00:05:00Z' }]);
    await upsertPayments(db, MERCHANT_A, [p]); // stale replay
    await upsertPayments(db, MERCHANT_A, [{ ...p, status: 'settled', fee: '0', updatedAt: '2026-03-01T00:05:00Z' }]); // duplicate
    const rows = await db.select().from(payments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'settled', amount: '10' });
    expect((await volume(db, WINDOW, 'day')).total).toBe('10');
  });

  it('stores no PII (payer, reference, metadata are dropped)', async () => {
    await upsertPayments(db, MERCHANT_A, [apiPayment({ id: 'p1', createdAt: '2026-03-01T00:00:00Z' })]);
    const raw = JSON.stringify(await db.select().from(payments));
    expect(raw).not.toContain('GPAYER');
    expect(raw).not.toContain('x@example.com');
    expect(raw).not.toContain('order');
  });

  it('records the error and keeps the cursor when the API fails mid-run', async () => {
    let fail = false;
    const feed = Array.from({ length: 150 }, (_, i) =>
      apiPayment({ id: `e${i}`, createdAt: '2026-03-01T00:00:00Z', updatedAt: new Date(Date.UTC(2026, 2, 1, 1, 0, i)).toISOString() }),
    );
    const base = fakeApi(MERCHANT_A, () => feed);
    let n = 0;
    const flaky: FetchLike = async (url, init) => {
      if (new URL(url).pathname === '/v1/payments' && ++n === 2 && fail) return Response.json({ error: { code: 'RPC', message: 'down' } }, { status: 503 });
      return (base.client as unknown as { http: { fetchImpl: FetchLike } }).http.fetchImpl(url, init);
    };
    fail = true;
    const client = new StellarPay({ apiKey: 'k', baseUrl: 'https://api.example', fetch: flaky });
    await expect(ingestSource(db, client, silentLogger)).rejects.toThrow('down');
    expect((await db.select().from(payments)).length).toBe(100);
    fail = false;
    await ingestSource(db, client, silentLogger);
    expect((await db.select().from(payments)).length).toBe(150);
  });
});

describe('HTTP API', () => {
  const TOKEN = 't'.repeat(40);
  const auth = { Authorization: `Bearer ${TOKEN}` };
  const app = () => createApp({ db, logger: silentLogger, token: TOKEN });
  const q = { from: WINDOW.from.toISOString(), to: WINDOW.to.toISOString() };

  it('requires the bearer token', async () => {
    expect((await request(app()).get('/stats/volume')).status).toBe(401);
    expect((await request(app()).get('/stats/volume').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app()).get('/health')).status).toBe(200);
  });

  it('serves the metrics with string amounts', async () => {
    await loadFixture();
    const v = await request(app()).get('/stats/volume').query({ ...q, interval: 'day' }).set(auth);
    expect(v.body).toMatchObject({ interval: 'day', total: '14000001', count: 4 });
    const auto = await request(app()).get('/stats/volume').query(q).set(auth);
    expect(auto.body.interval).toBe('hour');
    const sr = await request(app()).get('/stats/success-rate').query({ ...q, merchant_id: MERCHANT_B }).set(auth);
    expect(sr.body).toMatchObject({ settled: 1, failed: 1, denominator: 2, successRate: '50.00', merchantId: MERCHANT_B });
    const avg = await request(app()).get('/stats/average-size').query(q).set(auth);
    expect(avg.body).toMatchObject({ average: '3500000', count: 4 });
    expect((await request(app()).get('/stats/merchants').set(auth)).body.data).toEqual([MERCHANT_A, MERCHANT_B]);
  });

  it('paginates the payments table newest first', async () => {
    await loadFixture();
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await request(app()).get('/stats/payments').query({ ...q, limit: 3, ...(cursor ? { cursor } : {}) }).set(auth);
      expect(res.status).toBe(200);
      ids.push(...(res.body.data as { id: string }[]).map((p) => p.id.replace(/^0+/, '')));
      cursor = res.body.nextCursor as string | null;
    } while (cursor);
    expect(ids).toEqual(['8', '7', '6', '5', '4', '3', '2', '1']);
    const settled = await request(app()).get('/stats/payments').query({ ...q, status: 'settled' }).set(auth);
    expect(settled.body.data).toHaveLength(4);
  });

  it('validates input and bounds the work per request', async () => {
    const bad = async (query: Record<string, string>) => (await request(app()).get('/stats/volume').query(query).set(auth)).body.error.code as string;
    expect(await bad({ from: 'yesterday' })).toBe('VALIDATION_ERROR');
    expect(await bad({ from: q.to, to: q.from })).toBe('INVALID_WINDOW');
    expect(await bad({ merchant_id: "1' OR '1'='1" })).toBe('VALIDATION_ERROR');
    expect(await bad({ from: '2000-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z', interval: 'hour' })).toBe('TOO_MANY_BUCKETS');
    expect(await bad({ ...q, extra: '1' })).toBe('VALIDATION_ERROR');
    expect((await request(app()).get('/stats/payments').query({ cursor: '%%%' }).set(auth)).body.error.code).toBe('INVALID_CURSOR');
  });
});
