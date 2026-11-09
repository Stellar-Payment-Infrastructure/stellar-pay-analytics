# Metric definitions

Exact definitions of every number the Stellar Pay Analytics dashboard shows,
so results are reproducible. The worked example at the end is asserted by
`aggregator/test/aggregator.test.ts`; if code and this page disagree, the
test fails.

## Common rules

- **Source.** Payments ingested from the Stellar Pay API (`GET /v1/payments?updated_since=…`)
  into the aggregator's own database. The aggregator never reads the chain
  directly in v1.
- **Window.** Half-open `[from, to)` on the payment's **`created_at`**
  timestamp (when the merchant created it). Default: the last 7 days.
- **Time zone.** All timestamps and bucket boundaries are **UTC**.
- **Units.** Amounts are integers in token base units (7 decimals for XLM
  and classic assets), carried as decimal strings. No floating point is used
  in any aggregation. Display formatting happens only in the dashboard.
- **One token.** v1 deployments accept a single token, so there is no
  currency breakdown (Wave issue analytics-2).
- **Statuses.** `pending` (create not confirmed yet), `created` (awaiting
  payment), `paid` (in escrow), `settled`, `refunded` (operator refund or
  payer reclaim), `cancelled` (before payment), `failed` (the on-chain create
  never landed).

## Volume

`SUM(amount)` of payments with `status = 'settled'` whose `created_at` is in
the window, grouped into buckets of `date_trunc(interval, created_at)` (UTC).
Buckets with no payments are returned with volume `0`, so series have no gaps.

## Success rate

```
success_rate = settled / (settled + refunded + cancelled + failed)
```

- **Denominator:** payments in the window that reached a final outcome.
- **Excluded:** in-flight payments (`pending`, `created`, `paid`), because
  their outcome is not known yet. They are reported separately as `inFlight`.
- **Why cancelled counts as unsuccessful:** a checkout that was started and
  then cancelled is a payment that did not happen.
- Returned as `successRateBps = floor(settled × 10000 / denominator)` and as a
  percentage string with two decimals (`"57.14"`, floor). `null` when the
  denominator is 0.

## Average size

`floor(SUM(amount) / COUNT(*))` over settled payments in the window, in base
units (integer division rounds down). `null` when there are none.

## Buckets

| `interval` | bucket start |
|---|---|
| `hour` | top of the hour, UTC |
| `day` | 00:00 UTC |
| `week` | Monday 00:00 UTC (ISO week) |

If `interval` is not given: windows ≤ 7 days use `hour`, ≤ 90 days `day`,
longer windows `week`. At most 2,000 buckets per request.

## Freshness

The aggregator ingests every `INGEST_INTERVAL_MS` (default 60 s) and the
dashboard polls every 30 s, so numbers are **near real-time** (typically
under ~2 minutes behind the API). Push updates are Wave issue analytics-1.

## Worked example

Window `[2026-03-01T00:00Z, 2026-03-03T00:00Z)`, merchants A and B:

| id | merchant | status | amount | created_at (UTC) |
|---|---|---|---|---|
| 01 | A | settled | 1,000,000 | 03-01 00:00:00.000 (start: included) |
| 02 | A | settled | 2,500,000 | 03-01 23:59:59.999 |
| 03 | A | settled | 500,001 | 03-02 00:00:00.000 |
| 04 | A | refunded | 700,000 | 03-02 10:00 |
| 05 | A | cancelled | 100 | 03-02 11:00 |
| 06 | A | paid | 900 | 03-02 12:00 |
| 07 | B | settled | 10,000,000 | 03-02 13:00 |
| 08 | B | failed | 5 | 03-02 14:00 |
| 09 | A | settled | 999 | 03-03 00:00:00.000 (end: excluded) |
| 0a | A | settled | 1 | 02-28 23:59:59.999 (before: excluded) |

Results (all merchants):

- Volume by day: `2026-03-01` → **3,500,000** (2 payments); `2026-03-02` → **10,500,001** (2). Total **14,000,001**.
- Success rate: settled 4, refunded 1, cancelled 1, failed 1 (in flight: 1) → 4 / 7 = **5714 bps = "57.14"**.
- Average size: 14,000,001 / 4 = **3,500,000** (floor of 3,500,000.25).

Merchant A only: total volume **4,000,001**; success 3 / 5 = **"60.00"**;
average 4,000,001 / 3 = **1,333,333**.

<!-- TODO(wave: analytics-4): a best-practices guide (metric design, interpreting success rate, privacy,
     pitfalls) that builds on these definitions. -->
