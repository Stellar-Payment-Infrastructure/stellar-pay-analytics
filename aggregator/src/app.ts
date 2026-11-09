import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Db } from './db.js';
import * as stats from './stats.js';

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

const iso = z.string().datetime({ offset: true });
const windowQuery = z
  .object({
    from: iso.optional(),
    to: iso.optional(),
    merchant_id: z.string().uuid().optional(),
    interval: z.enum(['hour', 'day', 'week']).optional(),
    status: z.enum(['pending', 'created', 'paid', 'settled', 'refunded', 'cancelled', 'failed']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

function parseWindow(query: unknown) {
  const r = windowQuery.safeParse(query);
  if (!r.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const q = r.data;
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 7 * 86_400_000);
  if (from >= to) throw new HttpError(400, 'INVALID_WINDOW', '`from` must be before `to`');
  return { q, w: { from, to, merchantId: q.merchant_id } };
}

function sha256(v: string): Buffer {
  return createHash('sha256').update(v).digest();
}

/** Static bearer token, compared in constant time. */
function bearerAuth(token: string) {
  const expected = sha256(token);
  return (req: Request, _res: Response, next: NextFunction) => {
    const m = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
    if (!m?.[1] || !timingSafeEqual(sha256(m[1]), expected)) {
      return next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token'));
    }
    next();
  };
}

const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

export function createApp(deps: { db: Db; logger: Logger; token: string; health?: () => Record<string, unknown> }): Express {
  const { db } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), ...(deps.health?.() ?? {}) });
  });

  const r = express.Router();
  r.use(bearerAuth(deps.token));

  r.get('/volume', wrap(async (req, res) => {
    const { q, w } = parseWindow(req.query);
    const interval = q.interval ?? stats.autoInterval(w);
    if (stats.bucketCount(w, interval) > stats.MAX_BUCKETS) {
      throw new HttpError(400, 'TOO_MANY_BUCKETS', `Window too long for interval ${interval}`, { max: stats.MAX_BUCKETS });
    }
    res.json({ from: w.from.toISOString(), to: w.to.toISOString(), interval, merchantId: w.merchantId ?? null, ...(await stats.volume(db, w, interval)) });
  }));

  r.get('/success-rate', wrap(async (req, res) => {
    const { w } = parseWindow(req.query);
    res.json({ from: w.from.toISOString(), to: w.to.toISOString(), merchantId: w.merchantId ?? null, ...(await stats.successRate(db, w)) });
  }));

  r.get('/average-size', wrap(async (req, res) => {
    const { w } = parseWindow(req.query);
    res.json({ from: w.from.toISOString(), to: w.to.toISOString(), merchantId: w.merchantId ?? null, ...(await stats.averageSize(db, w)) });
  }));

  // TODO(wave: analytics-3): CSV/JSON export with the same filters, streamed
  // for large result sets (and an export button in web/src/Dashboard.tsx).
  r.get('/payments', wrap(async (req, res) => {
    const { q, w } = parseWindow(req.query);
    const cursor = q.cursor ? stats.decodeCursor(q.cursor) : undefined;
    if (q.cursor && !cursor) throw new HttpError(400, 'INVALID_CURSOR', 'cursor is malformed');
    res.json(await stats.listPayments(db, w, { status: q.status, limit: q.limit, cursor: cursor ?? undefined }));
  }));

  r.get('/merchants', wrap(async (_req, res) => {
    res.json({ data: await stats.merchants(db) });
  }));

  app.use('/stats', r);
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) } });
      return;
    }
    deps.logger.error({ err: (err as Error).message }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
  return app;
}
