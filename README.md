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
  containment.ts     Incident containment decisions and their effects
  decisions.ts       Merchant decisions outside the state machine (reject, escalate, refund draft, ...)
  customerStatus.ts  What a customer sees when they check a payment
  views/             View models for each screen (Overview, Incidents, Cases, Audit Log)
src/ui/                 Client components: shell, Overview, Incidents, shared pieces
src/app/                 Next.js routes (thin wrappers around src/ui):
                           /payment-integrity, /incidents, /incidents/[id], /cases, /cases/[id], /audit-log
src/adapters/
  demo/              Fixture investigator, simulated LearnLoop and Razorpay
  merchant/          Merchant and gateway adapter interfaces
tests/               Policy, execution, investigation, fixture and reconciliation tests
```

## Data and time

- `dataset.json` is generated once by a seeded PRNG and committed. The app never generates random data.
- On first load, fixture timestamps shift by whole minutes so the latest event falls about a minute before the real clock. Relative timing is exact: the deploy happens 20 minutes 41 seconds before the latest event, as in the fixture file, where it is recorded at 14:04 IST. The offset is saved immediately, so times don't move on reload.
- The fixtures also hold a fixed stream of healthy purchases after the latest event. They become visible as real time passes, which is how "Monitor the next 50 matching purchases" makes progress.
- Changes are persisted as an overlay on top of the fixtures (`localStorage`, loaded client-side only).

## The Payment Integrity Agent (AI)

The agent investigates, drafts and explains. It never executes: the deterministic policy engine and a person decide what runs.

| Task | Where it shows | Guardrails |
|---|---|---|
| Investigate a case or incident | "Investigation" panels on case detail and the incident workspace, with **Re-investigate** | Zod-validated structured output. Every cited event ID, including those inside each hypothesis, is checked against the events actually sent; unknown IDs are removed and the removal is shown. Invalid output or an unreachable model produces an escalation, not an action. |
| Draft customer messages | "Contact customer" on inventory-conflict cases; "Notify affected customers" on incidents | A deterministic check blocks confidence scores, webhooks/HTTP codes, policies, AI/agent mentions and system internals. Nothing is sent until a person approves the text. |
| Draft Outcome Contracts | Outcome Contracts → New contract → "Draft fields" | Fields are validated against the catalogue and global limits; assumptions and corrections are listed for review. |
| Explain earned autonomy | Automations → Earned autonomy | Suggestions are clamped to global limits. Automation changes only when a person switches it on. |

**Live model (optional).** Put a key in `.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

With a key, `/api/agent/*` route handlers (server-side only; the key never reaches the browser) call `claude-opus-5` using the SDK's structured outputs (`messages.parse` with Zod schemas), a 60-second timeout, and Anthropic's server-side refusal fallback (`fallbacks: "default"`). Without a key, or if the model fails, the app uses deterministic fixture investigations and rule-based drafts, so it works fully offline. The product UI does not show which path produced a result.

The model receives only what each task needs: payment and outcome events for the case, never customer names, emails or phone numbers.

## Boundaries

Rules detect. AI investigates. Policy validates. APIs execute. Outcomes verify.

- Investigator output is validated with Zod. Unknown evidence IDs are removed, invalid output becomes an escalation, and an unavailable investigator produces a rule-based alert.
- `evaluatePolicy` is pure and deterministic, and it runs again immediately before every execution.
- Cases resolve only once an Outcome Receipt is confirmed. Idempotency keys (`payment:action`) prevent duplicate execution.
