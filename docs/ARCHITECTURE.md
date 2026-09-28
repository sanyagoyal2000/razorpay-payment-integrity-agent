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

## Data flow

1. On first load, `DataProvider` (client-only, after mount) imports `dataset.json`. It then creates the `DataStore`, which shifts every fixture timestamp by whole minutes so the latest event sits about a minute before now. The offset is persisted immediately.
2. Changes are written through repositories. The store keeps an overlay of changed entities and saves it to `localStorage`, so a refresh restores exactly the same state.
3. Pages build view models with `useModel`, which recomputes when the store changes or the 15-second clock ticks. Each tick also syncs data from the (simulated) feed; stale data blocks consequential actions.

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
| `MerchantAdapter`, `PaymentGateway` (`src/adapters/merchant/types.ts`) | `createDemoMerchant`, `createDemoGateway` | LearnLoop Enrolment API, Razorpay APIs |
| `AgentGateway` (`src/services/agent/contracts.ts`) | fixtures and rules | already live via `/api/agent/*` |

Wiring lives in `src/services/container.ts`.

## UI system

- Razorpay Blade 12.127.0 with styled-components 5 (SSR registry in `src/app/registry.tsx`) on React 18.
- Recharts 3.7.0 is used for the one trend chart, coloured with Blade tokens.
- A local patch (`patches/`) fixes three Blade Table and Checkbox accessibility bugs.
