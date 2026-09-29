# Acceptance criteria

Each criterion from the specification, where it is implemented, and the automated check that covers it. Browser checks (console, axe-core and responsive layout) were run against production builds.

| # | Criterion | Where | Covered by |
|---|---|---|---|
| 1 | Overview metrics reconcile with incidents and cases | `services/metrics`, Overview | `reconciliation.test.ts`, `views.test.ts` |
| 2 | Search and filter cases | Cases page, top-bar search | `cases.test.ts` (Case list) |
| 3 | Payment-to-outcome timeline | Case detail, centre column | `cases.test.ts` (timeline in order, by source) |
| 4 | AI recommendations cite existing evidence | Investigation panels; `validateInvestigation` | `investigation.test.ts`, `agent.test.ts`, `fixtures.test.ts` |
| 5 | Policy verdicts deterministic and visible | Case decision panel, recovery groups | `policy.test.ts` ("is deterministic" and each rule) |
| 6 | Safe cases can be approved and resolved | Incident bulk recovery, case approval | `reconciliation.test.ts`, `cases.test.ts` |
| 7 | Outcome verification required before resolution | Execution `awaiting_outcome` step | `execution.test.ts` (pending, not verified leads to escalation) |
| 8 | Duplicate executions prevented | Idempotency reservation, demo merchant | `execution.test.ts` (racing executions) |
| 9 | Duplicate payments cannot enter bulk recovery | `planBulkRecovery` | `reconciliation.test.ts`, `cases.test.ts` |
| 10 | High-value cases require approval | Amount check (individual approval) | `policy.test.ts` |
| 11 | Inventory-conflict cases blocked | Inventory checks, refusal state | `policy.test.ts`, `cases.test.ts` |
| 12 | Waiting cases generate no actions | Observing case has no recommendation until its contract deadline; then it becomes an open missing-outcome case and is investigated (`services/observation.ts`) | `policy.test.ts`, `fixtures.test.ts`, `cases.test.ts`, `observation.test.ts` |
| 13 | Kill switch prevents execution, keeps monitoring | Automations; `kill_switch` check | `policy.test.ts`, `configuration.test.ts`, `execution.test.ts` |
| 14 | Contracts can be created, edited, paused and resumed | Outcome Contracts editor | `configuration.test.ts` |
| 15 | Integration permissions affect available actions | Revoke or reconnect; `permission_available` | `configuration.test.ts`, `policy.test.ts` |
| 16 | Every material action creates an audit event | Services append to the append-only audit log | assertions throughout; `cases.test.ts` (append-only) |
| 17 | Changes persist across refreshes | `DataStore` overlay in `localStorage` | `execution.test.ts` (reload), browser reload checks |
| 18 | Works without an external AI key | Claude CLI default, offline fallback | `agent.test.ts`; full browser runs with and without the live agent |
| 19 | Empty, loading, stale and unavailable states | Skeletons, empty states, status banners, developer settings | `states.test.ts`, `views.test.ts` |
| 20 | Consistent visual system | Blade components and tokens on every page | axe-core: no violations on all 12 pages; no horizontal scroll at 768–1440 px |

## Additions from CLAUDE.md

| Requirement | Covered by |
|---|---|
| Value delivered (trailing 30 days), each figure linked to its cases, with a calculation tooltip | Overview; `reconciliation.test.ts` |
| Deploy evidence from LearnLoop Observability (`deploy.completed` v2.3) | `fixtures.test.ts` |
| Exact arithmetic from real course prices | `fixtures.test.ts`, `reconciliation.test.ts` |
| Single footer disclaimer; official Razorpay wordmark (text fallback until the file is present) | App shell |
| No hydration warnings or console errors | Production browser runs on every route |

## Additions from the implementation brief

| Requirement | Where | Covered by |
|---|---|---|
| Proactive briefing (one or several incidents, investigating, unhealthy service, blocker, investigator unavailable, clear) with a deterministic priority | `views/briefing.ts`, Overview | `briefing.test.ts` |
| "Why the agent was needed", every figure derived, with failure states | `views/agentContribution.ts`, incident page | `briefing.test.ts` |
| Decision before deep evidence on incident pages | `IncidentWorkspacePage` | `briefing.test.ts` (section order) |
| Observable stages without chain-of-thought; failure never reported as success | `agent/progress.ts`, `InvestigationPanel` | `briefing.test.ts`, `agent.test.ts` |
| Earned autonomy from verified outcomes; deterministic eligibility; audited confirmation | `autonomyEligibility.ts`, `metrics/autonomy.ts`, `EarnedAutonomy` | `autonomy.test.ts` |
| Offline investigator validation with a fair baseline and development/holdout split | `evaluation/`, `/developer/evaluations` | `evaluation.test.ts` |
| Contract-specific language; no enrolment terms on bookings | `actionLabel`, `domain/fulfilment.ts` | `configuration.test.ts` |
| Masked contact details with audited reveal; communication details; opt-outs | `privacy.ts`, `communication.ts` | `privacy.test.ts`, `views.test.ts` |
| Audit detail and machine-readable export | `AuditDetail`, `auditExport`, Audit Log drawer | `privacy.test.ts` |
| No horizontal scroll at 1280 px on changed pages; mobile usable | Overview, incident, Automations, validation and Audit Log pages | Browser checks at 1280 px and 390 px |

## Agent Studio addendum

| Question the product must answer | Where | Covered by |
|---|---|---|
| What specialist job is this agent responsible for? | Agent details (top bar, avatar menu): purpose, state, connected systems, permission mode, outcome metric | `agentStudio.test.ts` |
| What context did it use for this incident? | Incident page → Context & authority; "How this investigation was produced" | `agentStudio.test.ts` |
| What actions is it allowed to take, and which need approval? | Context & authority: Suggest only / Approval required / Automatic within limits / Not permitted, per contract | `agentStudio.test.ts` |
| What lifecycle state is it in? | Briefing, incident header, agent details; derived, never stored | `agentStudio.test.ts` |
| What verified outcome did it produce? | Agent details (GMV resolved before refund or dispute), Value delivered, Recovered metric | `agentStudio.test.ts`, `reconciliation.test.ts` |
| Official Razorpay asset, not recreated text? | `public/brand/razorpay-wordmark-white.svg` (the official SVG with its text reversed to white); plain text if missing | Browser check |
| RAY green limited to AI identity? | `ui/ray/*`; colours only in `ui/ray/theme.ts` | `agentStudio.test.ts` (static checks) |
| Transactional CTAs keep Blade styling? | Buttons use Blade variants only | `agentStudio.test.ts` (static checks) |
| Connecting a source never grants write access | `services/permissions.ts`, `setWriteAuthority` | `configuration.test.ts`, `agentStudio.test.ts` |
| Ask RAY: incident-scoped, cites visible evidence, same source permissions, prepares but never executes | `services/agent/ask.ts`, `AskRayDrawer` | `askRay.test.ts` |
