## Summary

What does this change and why?

Closes #

## Checklist

- [ ] The verify command passes locally:
      `cd aggregator && pnpm install --frozen-lockfile && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build (and the same in web/)`
- [ ] Tests cover the change (a happy path and at least one failure path)
- [ ] Docs updated (README, docs/, CHANGELOG `[Unreleased]`) where behavior changed
- [ ] No secrets, keys or seed phrases in code, logs, fixtures or screenshots
- [ ] Amounts are integer base units (never floats); testnet only
- [ ] For a Wave issue: stays inside the scope in the issue, and the `TODO(wave: …)` marker is resolved
