# Architecture

Payment Integrity is a Next.js 14 (App Router) application. Everything runs in the browser against a deterministic, in-memory data store, except the agent's model calls, which run in server-side route handlers.

```text
Rules detect → AI investigates → Policy validates → APIs execute → Outcomes verify
   (fixtures)    (agent gateway)   (evaluatePolicy)   (adapters)     (verification)
```

## Layers

| Layer | Folder | Responsibility | May depend on |
|---|---|---|---|
| Domain | `src/domain` | Types, money formatting (Indian grouping), IST time helpers | nothing |
| Fixtures | `src/fixtures` | Seeded builder, committed `dataset.json`, minute-level anchoring to the real clock | domain |
| Repositories | `src/repositories` | `DataStore` (fixtures + persisted overlay) and repository interfaces per aggregate | domain, fixtures |
| Services | `src/services` | All business logic: policy, investigation, execution, verification, decisions, containment, configuration, metrics, view models | domain, repositories, adapter interfaces |
| Adapters | `src/adapters` | Replaceable edges: demo merchant and gateway, fixture investigator, live agent gateway | services' interfaces |
| Server | `src/server` | Agent providers: Claude CLI (default) and Anthropic API | services' schemas |
| UI | `src/ui` | Client components built with Razorpay Blade; render view models, call services | services |
| Routes | `src/app` | Thin Next.js pages and the `/api/agent/*` route handlers | ui, server |

Components contain no business logic. Every figure on screen comes from a service computing over the store.

View models added for the briefing, contribution, autonomy and validation work:
- `views/briefing.ts`: the Overview briefing and the incident priority.
- `views/agentContribution.ts`: "Why the agent was needed".
- `views/investigation.ts`: stage views and the "How this investigation was produced" disclosure. The stages are built in `agent/progress.ts`.
- `autonomyEligibility.ts` and `metrics/autonomy.ts`: earned autonomy.
- `evaluation/` and `views/evaluation.ts`: investigator validation. This is offline and never imports execution or adapters.
- `communication.ts` and `privacy.ts`: message details and contact masking.
- `versions.ts`: the agent and policy versions and the fingerprints recorded in audit detail.

## Data flow

1. On first load, `DataProvider` (client-only, after mount) imports `dataset.json`. It then creates the `DataStore`, which shifts every fixture timestamp by whole minutes so the latest event sits about a minute before now. The offset is persisted immediately.
2. Changes are written through repositories. The store keeps an overlay of changed entities and saves it to `localStorage`, so a refresh restores exactly the same state.
3. Pages build view models with `useModel`, which recomputes when the store changes or the 15-second clock ticks. Each tick also syncs data from the (simulated) feed; stale data blocks consequential actions.
4. Each tick also checks observed cases. One whose contract deadline passes without the outcome becomes an open missing-outcome case, and the agent investigates it. This check is skipped while data is stale.

## Execution

`approveAndStart` records the approval and creates an execution. `advanceExecution` then moves it through:

```text
approval_recorded → policy_rechecking → idempotency_reserved → action_started → awaiting_outcome → outcome_verified → resolved
```

- **Policy re-check** re-fetches payment and outcome state, stops if the case version changed, and re-runs `evaluatePolicy`.
- **Idempotency** is a key of `payment:action`. It is reserved before acting, and the demo merchant also ignores repeated keys.
- **Verification** requires the contracted outcome event after the action; otherwise the case escalates when the contract deadline passes.
- **Every step is audited**, and incident status is recomputed on resolution.

## Replacing the demo layer

| Interface | Demo implementation | Production replacement |
|---|---|---|
| Repository interfaces (`src/repositories/index.ts`) | `DataStore` over fixtures | API-backed repositories |
| `MerchantAdapter`, `PaymentGateway` (`src/adapters/merchant/types.ts`) | `createDemoMerchant`, `createDemoGateway` | Learning Access Service, Razorpay APIs |
| `AgentGateway` (`src/services/agent/contracts.ts`) | fixtures and rules | already live via `/api/agent/*` |

Wiring lives in `src/services/container.ts`.

## UI system

- Razorpay Blade 12.127.0 with styled-components 5 (SSR registry in `src/app/registry.tsx`) on React 18.
- Recharts 3.7.0 is used for the one trend chart, coloured with Blade tokens.
- A local patch (`patches/`) fixes three Blade Table and Checkbox accessibility bugs.

## Agent Studio layer

- **Permissions** (`services/permissions.ts`): context (read scopes of connected integrations) and authority (write scopes that also have an explicit write grant) come from separate records. Reconnecting an integration restores context only; write access is granted with `setWriteAuthority`, and the grant is audited.
- **Lifecycle** (`services/lifecycle.ts`): Monitoring, Investigating, Awaiting approval, Executing, Verifying outcome, Resolved or Blocked. It is derived each time from executions, investigations, policy verdicts, receipts, service health and system blockers, and is never stored.
- **Agent details** (`views/agentProfile.ts`): the agent's purpose, its lifecycle state, connected systems, permission mode, outcome metrics, and Context & authority for each contract.
- **RAY visual layer** (`ui/ray/`): `RayIdentity`, `RaySurface`, `RayProgress` and `RayInsight`. Colours live only in `ui/ray/theme.ts`, mapped to Blade's "on sea" and "sea"/"cloud" tokens; the one custom value (the mint border) is a prototype approximation. RAY green marks AI identity and AI work only, never success. Buttons stay on Blade's standard variants.
- **Brand**: the shell shows `public/brand/razorpay-wordmark-white.svg`, a copy of the supplied official `razorpay.svg` with only the navy text recoloured white for the black bar. It is sized from the SVG `viewBox` (1896 × 401) at 22 px tall, and falls back to plain text if the file is missing.
- **Ask RAY** (`services/agent/ask.ts`, `askSuggestions.ts`, `ui/agent/AskRayDrawer.tsx`): bounded questions about one incident. The input is the investigator's permitted evidence plus facts the product computes from current policy (`askFacts`). Answers are validated and their citations checked; offline, `askByRule` answers deterministically. It is a drawer on the incident page, not a primary navigation or chat surface.
- **Permitted evidence** (`permittedEvidence` in `services/permissions.ts`): investigator and Ask RAY inputs include only sources whose read scopes are connected.
- **Top bar**: the official wordmark, then RAY AI, then product tabs (Blade `TabNav`; `PRODUCT_TABS` and `activeProductTab` in `ui/shell/nav.ts`), with search and account controls on the right. Selection is derived from the pathname on every render, so it survives refresh and history navigation. Search is shown from 1200 px, and merchant and environment from 1024 px. Below 768 px the tabs, "Search cases" and the merchant move into the account menu. Blade's tab link is 36 px tall inside the 56 px bar.
- **Incident tabs** (`views/incidentDecision.ts`, `IncidentWorkspacePage`): `parseIncidentTab` reads `?tab=`, and `incidentSectionHref` builds links that open the tab holding a section. `decisionSummary`, `recommendationReasons`, `recoveryAuthority`, `recoveryConfidence` and `evidenceCounts` derive everything the tabs show; `recoveryFacts` (in `views/incidents.ts`) compresses the recovery plan. Tab panels are lazy, so the Decision tab never renders the event log.
