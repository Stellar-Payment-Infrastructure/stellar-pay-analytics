import { index, integer, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Normalized payment facts copied from the API. Deliberately no payer,
 * reference or metadata: the aggregator needs no PII.
 */
export const payments = pgTable(
  'payments',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    merchantId: uuid('merchant_id').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    /** Token base units; numeric(39,0) covers i128. */
    amount: numeric('amount', { precision: 39, scale: 0 }).notNull(),
    token: varchar('token', { length: 56 }).notNull(),
    settleMode: varchar('settle_mode', { length: 8 }).notNull(),
    feeBps: integer('fee_bps'),
    fee: numeric('fee', { precision: 39, scale: 0 }),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    ingestedAt: ts('ingested_at').defaultNow().notNull(),
  },
  (t) => ({
    merchantCreated: index('agg_payments_merchant_created_idx').on(t.merchantId, t.createdAt),
    statusCreated: index('agg_payments_status_created_idx').on(t.status, t.createdAt),
  }),
);

/** One ingestion cursor per source (API key / merchant). */
export const ingestState = pgTable('ingest_state', {
  key: varchar('key', { length: 128 }).primaryKey(),
  /** ISO timestamp passed as `updated_since` on the next run. */
  updatedSince: text('updated_since').notNull(),
  lastRunAt: ts('last_run_at').defaultNow().notNull(),
  lastError: text('last_error'),
});
