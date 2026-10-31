import pino from 'pino';
import { StellarPay } from 'stellar-pay-sdk';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, migrateDb } from './db.js';
import { ingestSource } from './ingest.js';

async function main() {
  const config = loadConfig();
  const logger = pino({
    level: config.LOG_LEVEL,
    redact: { paths: ['*.authorization', 'authorization', '*.API_KEYS', '*.STATS_BEARER_TOKEN', '*.DATABASE_URL'], censor: '[REDACTED]' },
    base: { service: 'stellar-pay-analytics-aggregator' },
  });
  if (config.MIGRATE_ON_START) await migrateDb(config.DATABASE_URL);
  const { db, close } = createDb(config.DATABASE_URL);
  const sources = config.apiKeys.map((apiKey) => new StellarPay({ apiKey, baseUrl: config.API_BASE_URL }));

  let lastIngestAt: string | null = null;
  let lastIngestError: string | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const loop = async () => {
    for (const source of sources) {
      try {
        await ingestSource(db, source, logger);
        lastIngestError = null;
      } catch (err) {
        lastIngestError = (err as Error).message;
        logger.warn({ err: lastIngestError }, 'ingestion failed; will retry');
      }
    }
    lastIngestAt = new Date().toISOString();
    if (!stopped) timer = setTimeout(() => void loop(), config.INGEST_INTERVAL_MS);
  };
  void loop();

  const app = createApp({ db, logger, token: config.STATS_BEARER_TOKEN, health: () => ({ lastIngestAt, lastIngestError }) });
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT, sources: sources.length }, 'aggregator listening'));
  const shutdown = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    server.close(() => void close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: Error) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
