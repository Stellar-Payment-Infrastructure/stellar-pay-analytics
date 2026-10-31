/**
 * SYNTHETIC DEMO DATA. Writes realistic-looking but fake payments straight into
 * the aggregator database so the dashboard has something to show. Never point
 * this at a database that holds real data.
 *
 *   DATABASE_URL=postgres://... pnpm seed:synthetic [--days 30] [--count 2000]
 *
 * Synthetic rows use two fixed merchant ids starting with 5e5e5e5e and payment
 * ids starting with "5e" so they are easy to find and delete.
 */
import { parseArgs } from 'node:util';
import type { Payment } from 'stellar-pay-sdk';
import { createDb, migrateDb } from '../src/db.js';
import { upsertPayments } from '../src/ingest.js';

const MERCHANTS = ['5e5e5e5e-0000-4000-8000-000000000001', '5e5e5e5e-0000-4000-8000-000000000002'];

/** Deterministic PRNG (mulberry32) so the demo dataset is reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { values } = parseArgs({ options: { days: { type: 'string', default: '30' }, count: { type: 'string', default: '2000' } } });
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  const days = Number(values.days);
  const count = Number(values.count);
  const rand = rng(42);
  const now = Date.now();
  const rows: { merchant: string; p: Payment }[] = [];
  for (let i = 0; i < count; i++) {
    const merchant = MERCHANTS[i % MERCHANTS.length] as string;
    const created = new Date(now - Math.floor(rand() * days * 86_400_000));
    const r = rand();
    const status = r < 0.78 ? 'settled' : r < 0.84 ? 'refunded' : r < 0.9 ? 'cancelled' : r < 0.93 ? 'failed' : r < 0.97 ? 'paid' : 'created';
    // 1 to 500 XLM in base units (7 decimals), integer math only.
    const amount = BigInt(1 + Math.floor(rand() * 500)) * 10_000_000n + BigInt(Math.floor(rand() * 10_000_000));
    rows.push({
      merchant,
      p: {
        id: `5e${i.toString(16).padStart(62, '0')}`,
        status,
        amount: amount.toString(),
        token: 'SYNTHETIC',
        settleMode: rand() < 0.5 ? 'auto' : 'manual',
        feeBps: 100,
        fee: status === 'settled' ? ((amount * 100n) / 10_000n).toString() : null,
        createdAt: created.toISOString(),
        updatedAt: new Date(created.getTime() + 60_000).toISOString(),
      } as Payment,
    });
  }
  await migrateDb(url);
  const { db, close } = createDb(url);
  try {
    for (const m of MERCHANTS) {
      const mine = rows.filter((r) => r.merchant === m).map((r) => r.p);
      for (let i = 0; i < mine.length; i += 500) await upsertPayments(db, m, mine.slice(i, i + 500));
    }
    console.log(`SYNTHETIC: wrote ${count} fake payments over ${days} days for merchants ${MERCHANTS.join(', ')}`);
  } finally {
    await close();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
