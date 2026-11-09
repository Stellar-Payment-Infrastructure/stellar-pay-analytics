# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - not yet tagged

First release, testnet only.

### Added

- Ingest from the Stellar Pay API through the `updated_since` feed, with idempotent upserts that never regress a
  payment and drop personal data.
- Stats endpoints behind a bearer token: volume, success rate, average size, payments table, merchants.
- Synthetic data seed script for demos, and a Docker image.

### Security

- `drizzle-orm` 0.45.4; overrides pin `follow-redirects`, `qs` and `body-parser`; the image runs as `node`.
