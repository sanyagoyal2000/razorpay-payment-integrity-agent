# Payment Integrity

Concept prototype of a Razorpay Agent Studio agent that checks every successful payment produced the outcome it promised. It runs entirely on simulated, deterministic data. No backend, API keys or network access are needed.

## Setup

The project uses **yarn** (v1), as in the Razorpay Blade installation guide. npm's automatic peer installation pulls in Blade's optional React Native peers.

```bash
yarn install
yarn dev            # http://localhost:3000 → /payment-integrity
yarn test           # unit tests (Vitest)
yarn typecheck      # TypeScript strict
yarn lint           # ESLint
yarn build          # production build
yarn fixtures       # regenerate src/fixtures/dataset.json from the seeded builder
```

## UI stack

- Next.js 14 App Router on React 18 (Blade is built against React 18 and supports only styled-components 5).
- Razorpay Blade (`@razorpay/blade` 12.127.0) with its pinned peers: styled-components 5.3.11, i18nify-js 1.9.3, i18nify-react 4.0.8, framer-motion 11.13.3.
- styled-components SSR registry in `src/app/registry.tsx`; `BladeProvider`, `LazyMotion` and the data provider in `src/ui/providers`.
- The i18nify locale is set to `en-IN`, so Blade `Amount` uses Indian digit grouping.
- Charts use Recharts 3.7.0 (Blade's own version) coloured with Blade theme tokens. Blade's chart wrappers bundle a Recharts build that logs a sizing warning on every mount, even in production.
- Known development-only console output from Blade internals, absent from production builds: framer-motion's `motion()` deprecation notice, and a React "Cannot update a component while rendering" warning raised by Blade's `TableHeaderRow`.

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
src/ui/                 Client components: shell, Overview, Incidents, shared pieces
src/app/                 Next.js routes (thin wrappers around src/ui)
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
