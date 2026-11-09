# Contributing to stellar-pay-analytics

Thanks for helping. Two packages share one pnpm workspace: `aggregator/` (service) and `web/` (dashboard).

## Setup

Node 22+ and pnpm 9. Aggregator tests use an embedded Postgres, so no database is needed to run them.

```bash
pnpm install
cd aggregator && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
cd ../web && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
```

## Wave issues

Planned contributor issues are listed in [ROADMAP.md](ROADMAP.md) and labeled `wave` on GitHub. Ask to be assigned
on the issue before starting, keep to its scope, and resolve its `TODO(wave: analytics-N)` marker.

## Code rules

- Metric definitions live in [docs/METRICS.md](docs/METRICS.md). Change the doc and the code together, and test new
  metrics against hand-computed expected values.
- Amounts are integer base units: `bigint` in TypeScript, `numeric` in SQL, decimal strings in JSON. Chart geometry
  may use numbers; labels and tooltips must show the exact string.
- Store no personal data: no payer addresses, references, metadata or IP-derived location.
- The stats bearer token must never reach the browser bundle.
- Validate every query parameter with Zod and keep per-request work bounded.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(web): add CSV export button`), and add a line
to the package's `CHANGELOG.md` under `[Unreleased]`.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
