# Roadmap

## v0.1.0 (current, testnet)

Aggregator that ingests payments from the Stellar Pay API and serves volume, success rate, average size, a payments
table and merchant list; a React dashboard with date and merchant filters that polls every 30 seconds. See the
[README](README.md#what-is-implemented).

## Open Wave issues

Deliberately left for contributors. Each has a `TODO(wave: analytics-N)` marker at its plug-in point.

| Id | Points | Issue | Starting point |
|---|---|---|---|
| analytics-1 | 4 | **Real-time updating:** SSE or WebSocket push from the aggregator, reconnection with backoff, fallback to polling, tests | `POLL_MS` in `web/src/Dashboard.tsx`, `aggregator/src/app.ts` |
| analytics-2 | 3 | **Currency breakdown:** per-token volume, count and average; aggregator endpoint, chart and table. Until the contract supports several tokens (stellar-pay-core core-1), build and test it with fixture data | `aggregator/src/stats.ts` |
| analytics-3 | 3 | **Export:** CSV and JSON export with the dashboard's filters, streamed for large result sets, tests | `aggregator/src/app.ts` (`/stats/payments`), `web/src/Dashboard.tsx` |
| analytics-4 | 2 | **Analytics best practices:** a guide to metric design, interpreting success rate, privacy, and common pitfalls | [docs/METRICS.md](docs/METRICS.md) |

## Not planned for v1

Reading directly from the chain (the API is the single source), geographic breakdowns (no IP-derived data, by
design), anomaly alerting, third-party analytics integrations.
