# stellar-pay-analytics

[![CI](https://github.com/Stellar-Payment-Infrastructure/stellar-pay-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/Stellar-Payment-Infrastructure/stellar-pay-analytics/actions/workflows/ci.yml)

**Status: testnet only · v0.1.0.**

Payment analytics for the [Stellar Pay API](https://github.com/Stellar-Payment-Infrastructure/stellar-pay-api):

- **`aggregator/`**: a service that ingests payments from the API (read-only API keys, `updated_since` cursor) into
  its own Postgres and serves aggregate metrics.
- **`web/`**: a React dashboard for those metrics.

Analytics reads only from the API, never directly from the chain. Metric definitions are in
[docs/METRICS.md](docs/METRICS.md).

## What is implemented

- **Ingest:** periodic pull of every configured merchant's payments through `stellar-pay-sdk`; idempotent upserts
  keyed by payment id that never move a payment backwards (out-of-order or replayed pages are safe). Payer
  addresses, merchant references and metadata are dropped, so the analytics database holds no personal data.
- **Stats endpoints** (bearer token, see below), all with a date range and optional merchant filter:

  | Endpoint | Returns |
  |---|---|
  | `GET /stats/volume` | Total settled volume and count, in time buckets |
  | `GET /stats/success-rate` | Share of payments that settled, per [METRICS.md](docs/METRICS.md) |
  | `GET /stats/average-size` | Average settled payment size |
  | `GET /stats/payments` | Payments table with status filter and cursor pagination |
  | `GET /stats/merchants` | Merchant ids seen by the aggregator |
  | `GET /health` | Health check (no auth) |

  Amounts are integer base units as decimal strings.
- **Dashboard:** date range and merchant filters, volume chart, success rate, average size, payments table with
  pagination, and a "last updated" time. It refreshes by polling every 30 seconds ("near real-time").
- The stats bearer token is added server-side (by the Vite dev proxy or by nginx in the container) and never ships
  in the browser bundle.

## Not implemented yet

- Push updates (SSE/WebSocket) instead of polling ([analytics-1](ROADMAP.md)).
- Per-token breakdown; v0.1.0 has one token ([analytics-2](ROADMAP.md)).
- CSV/JSON export ([analytics-3](ROADMAP.md)).
- An analytics best-practices guide ([analytics-4](ROADMAP.md)).
- No geographic breakdown (by design: no IP-derived data), no alerting, no third-party analytics integrations.
- Not deployed to a public URL yet.

## Run locally

Requirements: Node 22+, pnpm 9, Postgres 16 (or Docker), and a running stellar-pay-api with at least one merchant
key that has the `payments:read` scope.

```bash
pnpm install

# aggregator
cd aggregator
cp .env.example .env                       # API_BASE_URL, API_KEYS, STATS_BEARER_TOKEN, DATABASE_URL
pnpm exec tsx watch --env-file=.env src/server.ts      # http://localhost:4000

# dashboard (another terminal)
cd web
AGGREGATOR_URL=http://localhost:4000 ANALYTICS_TOKEN=<STATS_BEARER_TOKEN> pnpm dev   # http://localhost:5173
```

Or everything in Docker from the repository root: see the header of [docker-compose.yml](docker-compose.yml).
`pnpm --dir aggregator seed:synthetic` loads synthetic payments for trying the dashboard without an API.

## Verify

```bash
cd aggregator && pnpm install --frozen-lockfile && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
cd ../web && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
```

The aggregator tests (15) check ingest idempotency and each metric against hand-computed expected values.

## Compatibility

| stellar-pay-analytics | stellar-pay-sdk | Stellar Pay API |
|---|---|---|
| 0.1.x | 0.1.x | `/v1` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the open Wave issues in [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE)
