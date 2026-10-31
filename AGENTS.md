# AGENTS.md — stellar-pay-analytics

## Package: stellar-pay-analytics

Analytics aggregator service + React dashboard for Stellar payments.

### Structure

```
stellar-pay-analytics/
├── aggregator/    # Node/TS ingestion service
├── web/           # React dashboard
└── docs/METRICS.md
```

### Verify Commands

```bash
# Aggregator
cd aggregator && pnpm install --frozen-lockfile && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build

# Web
cd web && pnpm install --frozen-lockfile && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
```

### Aggregator (`aggregator/`)

- **Ingestion:** Polls API `/v1/payments?updated_since=` every 60s, upserts to own Postgres
- **API:** Express server with Bearer token auth
- **Endpoints:**
  - `GET /stats/volume` — time-bucketed volume
  - `GET /stats/success-rate` — settled / (settled + refunded)
  - `GET /stats/average-size` — mean settled amount
  - `GET /stats/payments` — paginated table
- **Schema:** `payments` table (id, merchant_id, status, amount, token, payer, reference, metadata, created_at, updated_at) + `aggregator_state` (cursor)

### Web (`web/`)

- **Stack:** React + Vite + TanStack Query + Recharts + TanStack Table
- **Dashboard:** date range, merchant filter, volume chart, success rate, avg size, payments table
- **Polling:** 30s refresh, "last updated" timestamp
- **A11y:** charts have text alternatives/adjacent data tables

### Metrics Definitions

See `docs/METRICS.md` for exact formulas:
- Volume: SUM(amount) for settled payments
- Success Rate: settled / (settled + refunded)
- Average Size: AVG(amount) for settled
- Time buckets: hourly (≤7d), daily (≤90d), weekly (>90d)
- UTC timestamps, base units, display formatting only at presentation layer

### Rules

- Money: `bigint` base units in DB, decimal strings in API, format in UI
- No PII in aggregator (only payment IDs, amounts, status, merchant IDs)
- Single token per deployment (MVP)
- Push updates (SSE/WebSocket) are a Wave issue