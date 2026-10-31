import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import pino from 'pino';
import type { Payment } from 'stellar-pay-sdk';
import { type Db, MIGRATIONS_DIR } from '../src/db.js';
import * as schema from '../src/schema.js';

export async function testDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Db, close: () => client.close() };
}

export const silentLogger = pino({ level: 'silent' });

export const MERCHANT_A = '11111111-1111-4111-8111-111111111111';
export const MERCHANT_B = '22222222-2222-4222-8222-222222222222';

let n = 0;
export function apiPayment(over: Partial<Payment> & { createdAt: string }): Payment {
  n++;
  const id = (over.id ?? n.toString(16)).padStart(64, '0');
  return {
    object: 'payment',
    status: 'settled',
    amount: '1',
    token: 'CTOKEN',
    tokenCode: 'XLM',
    decimals: 7,
    merchantId: MERCHANT_A,
    merchantAddress: 'GMERCHANT',
    settleMode: 'manual',
    payer: 'GPAYER',
    reference: 'order',
    metadata: { email: 'x@example.com' },
    successUrl: null,
    cancelUrl: null,
    feeBps: 100,
    fee: null,
    checkoutUrl: '',
    transactions: { create: null, pay: null, settle: null, refund: null, cancel: null },
    updatedAt: over.updatedAt ?? over.createdAt,
    ...over,
    id,
  } as Payment;
}

/**
 * The fixture documented in docs/METRICS.md ("Worked example"). Window:
 * [2026-03-01T00:00Z, 2026-03-03T00:00Z).
 */
export const FIXTURE: { merchant: string; payment: Payment }[] = [
  { merchant: MERCHANT_A, payment: apiPayment({ id: '01', status: 'settled', amount: '1000000', createdAt: '2026-03-01T00:00:00.000Z' }) },
  { merchant: MERCHANT_A, payment: apiPayment({ id: '02', status: 'settled', amount: '2500000', createdAt: '2026-03-01T23:59:59.999Z' }) },
  { merchant: MERCHANT_A, payment: apiPayment({ id: '03', status: 'settled', amount: '500001', createdAt: '2026-03-02T00:00:00.000Z' }) },
  { merchant: MERCHANT_A, payment: apiPayment({ id: '04', status: 'refunded', amount: '700000', createdAt: '2026-03-02T10:00:00.000Z' }) },
  { merchant: MERCHANT_A, payment: apiPayment({ id: '05', status: 'cancelled', amount: '100', createdAt: '2026-03-02T11:00:00.000Z' }) },
  { merchant: MERCHANT_A, payment: apiPayment({ id: '06', status: 'paid', amount: '900', createdAt: '2026-03-02T12:00:00.000Z' }) },
  { merchant: MERCHANT_B, payment: apiPayment({ id: '07', status: 'settled', amount: '10000000', createdAt: '2026-03-02T13:00:00.000Z', merchantId: MERCHANT_B }) },
  { merchant: MERCHANT_B, payment: apiPayment({ id: '08', status: 'failed', amount: '5', createdAt: '2026-03-02T14:00:00.000Z', merchantId: MERCHANT_B }) },
  // Outside the window: `to` is exclusive, `from` inclusive.
  { merchant: MERCHANT_A, payment: apiPayment({ id: '09', status: 'settled', amount: '999', createdAt: '2026-03-03T00:00:00.000Z' }) },
  { merchant: MERCHANT_A, payment: apiPayment({ id: '0a', status: 'settled', amount: '1', createdAt: '2026-02-28T23:59:59.999Z' }) },
];

export const WINDOW = { from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-03-03T00:00:00Z') };
