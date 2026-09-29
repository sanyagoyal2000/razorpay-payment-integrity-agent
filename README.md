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

## Positioning

Payment Integrity is presented as a specialist Agent Studio worker: *a specialist Agent Studio worker that continuously protects the gap between a successful payment and the merchant's intended customer outcome.* It is a concept prototype aligned with Razorpay's intent-driven direction, not an announced or available Razorpay product. Strategic reference: an AIM Network interview with Razorpay CPO Khilan Haria (https://www.youtube.com/watch?v=Rr1nUlyRqJg). It informed the positioning and is not a product specification.
- **Top bar product tabs** follow Razorpay's pattern, using Blade `TabNav`: **Payment Integrity** (the workspace) and **Agent details** (`/payment-integrity/agent`), each with a leading Blade icon. The selected tab comes from the route: it is bright, with a blue indicator, and `aria-current`. The other is muted. The search box collapses before the tabs do; below 768 px both tabs move into the account menu, labelled.
- **Agent details** shows its purpose, lifecycle state, connected systems, permission mode, outcome metrics, and Context & authority for each contract.
- An **Outcome Contract** is the merchant's machine-readable intent for a payment. An **Outcome Receipt** is proof that the outcome happened.
- The **RAY AI** identity (mint) marks AI-assisted content only.
- The top bar uses Razorpay's official wordmark (`public/brand/razorpay.svg`, subject to Razorpay's Usage Agreement) in a reversed copy, `razorpay-wordmark-white.svg`: the navy text is recoloured white so it reads on black, and the blue mark is unchanged. If the file is missing, the top bar shows plain text.

## What needs attention

The Overview opens with a briefing that answers "What needs my attention today?". It is built from active incidents, validated findings, service health, recovery groups under current policy, system blockers and data freshness. Incidents are ranked by:
1. capture deadline
2. severity
3. revenue at risk
4. customers at risk
5. age

It covers these states:
- one or several incidents
- investigation in progress
- a failing service
- stale data or another system-wide block
- investigator unavailable
- nothing to do

Its buttons only navigate; recovery is approved on the incident.

Incident pages put the decision first:
1. status and required decision
2. what happened
3. "Why the agent was needed": what the fixed rule found, what the investigation added, and the safe and held cases, with "How this is calculated"
4. recovery
5. investigation detail
6. evidence
7. containment
8. history

## The Payment Integrity Agent (AI)

The agent investigates, drafts and explains. It never executes: the deterministic policy engine and a person decide what runs.

| Task | Where it shows | Guardrails |
|---|---|---|
| Investigate a case or incident | "Investigation" panels on case detail and the incident workspace, with **Re-investigate** | Zod-validated structured output. Every cited event ID, including those inside each hypothesis, is checked against the events actually sent; unknown IDs are removed and the removal is shown. Invalid output or an unreachable model produces an escalation, not an action. |
| Draft customer messages | "Contact customer" on inventory-conflict cases; "Notify affected customers" on incidents | A deterministic check blocks confidence scores, webhooks/HTTP codes, policies, AI/agent mentions and system internals. Nothing is sent until a person approves the text. |
| Draft Outcome Contracts | Outcome Contracts → New contract → "Draft fields" | Fields are validated against the catalogue and global limits; assumptions and corrections are listed for review. |
| Explain earned autonomy | Automations → Earned autonomy | Eligibility is decided by fixed criteria over verified outcomes, not approvals. The explanation cannot override it, and suggestions are clamped to global limits. Automation changes only after explicit, audited confirmation. |

**Where agent requests go.** Requests run server-side from `/api/agent/*` route handlers. Nothing model-related runs in the browser.

- **Default: the Claude CLI (no API key).** The server runs the local `claude` CLI (Claude Code) headless, signed in with your Claude account: `claude -p --output-format json --json-schema … --tools "" --strict-mcp-config --no-session-persistence --model claude-opus-5`, from a temporary directory. The CLI must be on the server's `PATH`, or set `CLAUDE_CLI_PATH`. Typical responses take 7–40 seconds.
- **Anthropic API.** Set these in `.env.local`:

  ```bash
  AGENT_PROVIDER=api
  ANTHROPIC_API_KEY=sk-ant-...
  ```

  This uses the SDK's structured outputs (`messages.parse` with Zod schemas) on `claude-opus-5`, a 60-second timeout, and Anthropic's server-side refusal fallback (`fallbacks: "default"`).

Both paths validate output with the same Zod schemas and guardrails. If neither is available, or a request fails, the app uses deterministic fixture investigations and rule-based drafts, so it works fully offline. The main product views do not show which path produced a result. Each Audit Log entry's detail records it (model and provider, or the deterministic fallback), along with the sources read and fingerprints of the input and output.

Investigations report five observable stages as each operation completes. Afterwards, "How this investigation was produced" shows events, sources, cases compared, service health, causes evaluated and citations checked. No model reasoning is shown.

**Ask RAY** (incident page → Ask RAY) answers questions about that incident only. It offers suggested questions worded from the current state (for example "Why are 5 cases held?"). Each answer cites the evidence, cases or product facts it rests on and can link to recovery, the investigation or the evidence. It never approves or executes anything; actions still go through policy and your approval. Offline, the same three kinds of question are answered deterministically from product facts.

**Investigator validation** (Developer settings → Open investigator validation) compares the investigator with a fixed-rule baseline on 40 labelled synthetic scenarios, using committed outputs captured from the real investigator (`yarn evaluation:capture`). See [Evaluation, autonomy and observable work](docs/EVALUATION_AND_AUTONOMY.md) for what it does and does not show.

The model receives only what each task needs: payment and outcome events for the case, never customer names, emails or phone numbers.

## Privacy

- Operations views show customer email and phone masked. **Show contact details** reveals them for one case, for the Payments Operations Manager role only, and records the reveal in the audit log.
- Customer messages go by email only. Before sending, the dialog shows the channel, the consent basis (transactional), the recipient count, opt-outs (excluded, never messaged), whether the text is the contract template or free-form, and whether approval is required.
- The agent never receives customer names, emails or phone numbers. Audit entries store no contact details, and **Export JSON** on the Audit Log downloads the filtered entries in a machine-readable form.

## Customer page

`/check-payment` is the customer-facing page (no admin navigation). A customer enters the phone number they paid with and their order ID (for example `LL-4301232`, shown on each case's detail page). The result is one of: resolved, recovery in progress, under review, or not found. A second charge is explained as under review, and a refunded payment says so. A wrong phone number gets the same "not found" answer as an unknown order. No confidence, internal errors, webhook status, thresholds or architecture are shown.

## Degraded states and developer settings

Open **Developer settings** from the avatar menu (top right). It is deliberately outside the main navigation. From there you can:

- turn off the data feed, outcome verification, automated investigation or the policy service. Each shows a banner with the specified wording and blocks what it should.
- make data stale immediately. Data older than 2 minutes blocks every consequential action until **Refresh data** succeeds.
- reset all data, re-seeding the fixtures anchored to the current time.

## Accessibility

Checked with axe-core (WCAG 2.1 A/AA) on every page, plus keyboard and 375 px checks on the customer page:

- Skip link, visible focus, labelled controls, live regions for status changes and results.
- Amber statuses use an indicator plus text, because Blade's amber badges fall below 4.5:1 at badge size.
- Key-value summaries use a valid `dl`, instead of Blade InfoGroup, whose markup nests `dt`/`dd` too deeply.
- **Local Blade patch** (`patches/@razorpay+blade+12.127.0.patch`, applied on install by `patch-package`): Blade's Table header row uses `role="row"` instead of `role="rowheader"`; `aria-multiselectable` is no longer set on `role="table"`; and Checkbox passes its `aria-label` to the input, so Table's selection checkboxes have accessible names. With the patch, axe reports no violations on any page. Remove the patch once Blade fixes these upstream.

## Boundaries

Rules detect. AI investigates. Policy validates. APIs execute. Outcomes verify.

- Investigator output is validated with Zod. Unknown evidence IDs are removed, invalid output becomes an escalation, and an unavailable investigator produces a rule-based alert.
- `evaluatePolicy` is pure and deterministic, and it runs again immediately before every execution.
- Cases resolve only once an Outcome Receipt is confirmed. Idempotency keys (`payment:action`) prevent duplicate execution.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): layers, data flow, the execution state machine, and how to replace the demo layer
- [Data model](docs/DATA_MODEL.md): entities, what was added to the specification and why, and tested invariants
- [AI and policy boundaries](docs/AI_AND_POLICY.md): what the agent sees and produces, guardrails, providers, and the policy engine
- [Simulated integrations and non-goals](docs/INTEGRATIONS_AND_NON_GOALS.md)
- [Acceptance criteria](docs/ACCEPTANCE.md): each of the specification's 20 criteria mapped to its implementation and tests
- [Evaluation, autonomy and observable work](docs/EVALUATION_AND_AUTONOMY.md): investigator validation, the autonomy eligibility formula, and how observable progress differs from chain-of-thought
