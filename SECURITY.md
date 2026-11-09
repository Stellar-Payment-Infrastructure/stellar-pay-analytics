# Security policy

## Status

stellar-pay-analytics is **testnet-only** and has not had a professional security review.

| Version | Supported |
|---|---|
| 0.1.x | Yes (testnet) |

## Reporting a vulnerability

Please report privately through GitHub:
[Report a vulnerability](https://github.com/Stellar-Payment-Infrastructure/stellar-pay-analytics/security/advisories/new).
Do not open a public issue. We aim to acknowledge reports within 3 business days.

## Operating it safely

- The aggregator's `API_KEYS` should be keys with only the `payments:read` scope.
- `STATS_BEARER_TOKEN` must be at least 32 random characters. The dashboard never sees it: the Vite dev proxy or
  nginx adds it server-side, so do not expose the aggregator's `/stats` routes publicly without that proxy.
- The aggregator drops payer addresses, references and metadata at ingest, so its database holds no personal data.
