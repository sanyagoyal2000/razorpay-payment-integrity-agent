# AI and policy boundaries

> Rules detect. AI investigates. Policy validates. APIs execute. Outcomes verify.

The AI never executes a financial or fulfilment action. It investigates, drafts and explains. A deterministic policy engine and a person decide what runs.

## What the agent does

| Task | Input sent | Output schema | Guardrails after the model |
|---|---|---|---|
| Investigate a case | The case's payment, webhook, merchant and observability events; payment amount, method and status. **No customer name, email or phone.** | `investigationSchema` (`src/services/investigation/schema.ts`) | Zod validation, including confidence between 0 and 1. Every cited ID, including those in hypotheses, must exist in the supplied events; unknown IDs are removed and the removal is shown. No verifiable evidence, or invalid output, becomes an escalation. |
| Investigate an incident | All incident cases' events plus post-incident outcomes; case IDs may be cited | same | same |
| Draft a customer message | Situation, product, amount and customer-safe facts | `messageDraftSchema` | Checked for confidence, AI or agent mentions, webhooks, HTTP codes, policies or thresholds, and system internals. Sending is blocked until the text is clean, and nothing sends without approval. |
| Draft an Outcome Contract | The merchant's description, product catalogue, services and global limit | `contractDraftSchema` | Unknown products removed, the limit clamped to the global maximum, an unknown service replaced, and assumptions and corrections listed for review. |
| Ask RAY (one incident) | The question; the incident's permitted evidence (the same filtered input as the investigator), its case IDs, and product-computed facts (recovery groups, held reasons, what approving the batch would start, service health) | `askAnswerSchema` | Citations must be evidence, case or fact IDs of this incident; others are removed, and an in-scope answer with none is marked unverified. Out-of-scope questions are declined. It can point to where to act (recovery, investigation, evidence) but never executes. The audit entry stores a fingerprint of the question, not its text. |
| Explain earned autonomy | Approvals, executed, verified, failed and wrong counts, the deterministic eligibility decision and unmet criteria, and edit and rejection reasons | `autonomyExplanationSchema` | The eligibility decision is fixed before the call and overrides any suggested mode. Limits are clamped to global controls. It never changes a setting. |

## Providers

- **Default: the Claude CLI.** Signed in with the user's Claude account; no API key. It runs headless with `--json-schema`, no tools, no MCP servers and no saved session.
- **Anthropic API.** Set `AGENT_PROVIDER=api` and `ANTHROPIC_API_KEY`. It uses `claude-opus-5`, the SDK's `messages.parse` with Zod, and the server-side refusal fallback.
- **Offline.** Deterministic fixtures and rules when no provider is available. This is also the fallback when a provider fails.

The main product views do not reveal which path produced a result. Each Audit Log entry records it in its detail, along with:
- the invocation ID and trigger
- the agent and policy versions
- the sources read
- FNV-1a fingerprints of the input and output (the contents themselves are not stored)
- the idempotency key and execution state for executions

## Observable progress

Investigations report five stages when each operation completes:
1. gather evidence
2. compare affected cases or the contract
3. check service state
4. validate citations
5. prepare the recommendation

Each stage reports counts and states read from real data. On failure, the deterministic stages still complete and the run ends with "Escalation prepared for manual review". The stage log is stored with the run. No model reasoning is displayed; see [Evaluation, autonomy and observable work](EVALUATION_AND_AUTONOMY.md).

## Policy engine

`evaluatePolicy(case, recommendation, currentState)` in `src/services/policy/evaluatePolicy.ts` is a pure function; the same inputs always give the same verdict. `buildCurrentState` re-fetches everything it depends on, and it runs again immediately before every execution.

The checks depend on the action:

- **Payment:** captured or authorised, capture deadline, not refunded.
- **Outcome:** still missing, no successful duplicate.
- **Inventory:** unchanged, valid replacement.
- **Dependencies:** fulfilment service healthy, outcome verification available, data fresh.
- **Execution:** idempotency key available.
- **Limits:** amount within limit, confidence threshold, exact record match.
- **Contract and incident:** contract active, case types that always need review, incident review required.
- **Permissions and controls:** permission scope granted, action mode, customer-communication approval, kill switch.

The result:

- **Blocked:** any `hard` check failed or unknown.
- **Approval required, individual:** any `review` check failed, or the mode is "always require approval".
- **Approval required, bulk:** the mode is "suggest only" and every check passed.
- **Allowed:** the mode is "automatic below thresholds" and every check passed.

The AI cannot bypass this: recommendations are inputs to policy, never instructions to execute.

Explanations that reach the merchant use each contract's own language, for example "Restore learning access", "Reconfirm booking" or "Activate membership". The Automations entry keeps the generic name "Retry provisioning", because it covers every contract.

## Context and authority

The agent may investigate broadly within connected, readable context. Acting is narrow: it needs a write grant for the integration, an Automations mode that allows it, a passing deterministic policy check, limits on amount and confidence, an audit entry and a verified Outcome Receipt. Model confidence and merchant agreement never unlock automation on their own.

## Earned autonomy

`evaluateAutonomyEligibility` decides, from verified outcomes only, whether limited automation may be suggested. It requires:
- at least 30 executed examples, with at least 98% verified
- no wrong actions and no unresolved failures
- exact matching still required
- a compatible action and contract with its write scope granted
- limits within global controls

The full formula is in [Evaluation, autonomy and observable work](EVALUATION_AND_AUTONOMY.md).
