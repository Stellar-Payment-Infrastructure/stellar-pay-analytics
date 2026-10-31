import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  /** Stellar Pay API origin. */
  API_BASE_URL: z.string().url(),
  /** Comma-separated read-only secret keys (`payments:read`), one per merchant to ingest. */
  API_KEYS: z.string().min(1),
  /** Static bearer token required on /stats/* (v1). At least 32 characters. */
  STATS_BEARER_TOKEN: z.string().min(32),
  INGEST_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  MIGRATE_ON_START: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema> & { apiKeys: string[] };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Invalid configuration: ${fields.join(', ')}`);
  }
  return { ...r.data, apiKeys: r.data.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean) };
}
