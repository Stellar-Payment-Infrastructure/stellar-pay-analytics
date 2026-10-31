import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Payment, StellarPay } from 'stellar-pay-sdk';
import type { Db } from './db.js';
import { ingestState, payments } from './schema.js';

export const EPOCH = '1970-01-01T00:00:00.000Z';
const PAGE_SIZE = 100;

export interface IngestResult {
  merchantId: string;
  upserted: number;
  pages: number;
  updatedSince: string;
}

/**
 * Idempotent upsert keyed by payment id. A row is only overwritten by a
 * snapshot that is at least as new (`updated_at`), so out-of-order or replayed
 * pages can never move a payment backwards.
 */
export async function upsertPayments(db: Db, merchantId: string, rows: Payment[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((p) => ({
    id: p.id,
    merchantId,
    status: p.status,
    amount: p.amount,
    token: p.token,
    settleMode: p.settleMode,
    feeBps: p.feeBps,
    fee: p.fee,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  }));
  const res = await db
    .insert(payments)
    .values(values)
    .onConflictDoUpdate({
      target: payments.id,
      set: {
        status: sql`excluded.status`,
        amount: sql`excluded.amount`,
        feeBps: sql`excluded.fee_bps`,
        fee: sql`excluded.fee`,
        updatedAt: sql`excluded.updated_at`,
        ingestedAt: sql`now()`,
      },
      setWhere: sql`${payments.updatedAt} <= excluded.updated_at`,
    })
    .returning({ id: payments.id });
  return res.length;
}

/**
 * Pulls everything updated since the stored cursor from the API's
 * `updated_since` feed (oldest update first) and advances the cursor after
 * each page. Boundary rows sharing the cursor timestamp are re-read on the
 * next run, which is harmless because upserts are idempotent.
 */
export async function ingestSource(
  db: Db,
  client: StellarPay,
  logger: Logger,
  opts: { maxPages?: number } = {},
): Promise<IngestResult> {
  const merchant = await client.merchant();
  const key = `payments:${merchant.id}`;
  const [state] = await db.select().from(ingestState).where(eq(ingestState.key, key)).limit(1);
  const since = state?.updatedSince ?? EPOCH;
  let cursor: string | undefined;
  let upserted = 0;
  let pages = 0;
  let next = since;
  try {
    do {
      // Within one run the API's keyset cursor is relative to the same `updated_since`.
      const page = await client.payments.list({ updated_since: since, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      pages++;
      upserted += await upsertPayments(db, merchant.id, page.data);
      const last = page.data[page.data.length - 1];
      if (last) next = last.updatedAt;
      await db
        .insert(ingestState)
        .values({ key, updatedSince: next, lastRunAt: new Date(), lastError: null })
        .onConflictDoUpdate({ target: ingestState.key, set: { updatedSince: next, lastRunAt: new Date(), lastError: null } });
      cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
    } while (cursor && pages < (opts.maxPages ?? 50));
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await db
      .insert(ingestState)
      .values({ key, updatedSince: next, lastRunAt: new Date(), lastError: message })
      .onConflictDoUpdate({ target: ingestState.key, set: { lastRunAt: new Date(), lastError: message } });
    throw err;
  }
  if (upserted > 0) logger.info({ merchantId: merchant.id, upserted, pages }, 'ingested payments');
  return { merchantId: merchant.id, upserted, pages, updatedSince: next };
}
