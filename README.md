# Payment Integrity

Concept prototype of a Razorpay Agent Studio agent that checks every successful payment produced the outcome it promised. It runs entirely on simulated, deterministic data. No backend, API keys or network access are needed.

## Setup

```bash
npm install
npm test            # unit tests (Vitest)
npm run typecheck   # TypeScript strict
npm run lint        # ESLint
npm run fixtures    # regenerate src/fixtures/dataset.json from the seeded builder
```

## Layout

```text
src/domain/          Types, money (Indian grouping) and IST time helpers
src/fixtures/        Seeded fixture builder, committed dataset.json, day rebasing
src/repositories/    DataStore (fixtures + persisted overlay) and repository interfaces
src/services/
  policy/            evaluatePolicy (pure) and current-state re-fetch
  investigation/     AI boundary, Zod validation, rule-based fallback
  execution/         Approval → verified-outcome state machine, bulk approval
  verification/      Outcome Receipt confirmation
  recovery/          Recovery groups and bulk eligibility
  metrics/           Aggregates, Value delivered, earned autonomy
  incidents.ts       Incident status derivation
src/adapters/
  demo/              Fixture investigator, simulated LearnLoop and Razorpay
  merchant/          Merchant and gateway adapter interfaces
tests/               Policy, execution, investigation, fixture and reconciliation tests
```

## Data and time

- `dataset.json` is generated once by a seeded PRNG and committed. The app never generates random data.
- Fixture timestamps are shifted by whole days on first load, so the latest fixture event falls within the last 24 hours of the real clock. Wall-clock times stay the same, for example the v2.3 deploy at 14:04 IST. The offset is persisted, so it stays stable across reloads.
- Changes are persisted as an overlay on top of the fixtures (`localStorage`, loaded client-side only).

## Boundaries

Rules detect. AI investigates. Policy validates. APIs execute. Outcomes verify.

- Investigator output is validated with Zod. Unknown evidence IDs are removed, invalid output becomes an escalation, and an unavailable investigator produces a rule-based alert.
- `evaluatePolicy` is pure and deterministic, and it runs again immediately before every execution.
- Cases resolve only once an Outcome Receipt is confirmed. Idempotency keys (`payment:action`) prevent duplicate execution.
