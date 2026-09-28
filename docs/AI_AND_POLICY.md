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
| Explain earned autonomy | Counts of past decisions, reversals, and edit and rejection reasons | `autonomyExplanationSchema` | Suggestions clamped to global limits. It never changes a setting. |

## Providers

- **Default: the Claude CLI.** Signed in with the user's Claude account; no API key. It runs headless with `--json-schema`, no tools, no MCP servers and no saved session.
- **Anthropic API.** Set `AGENT_PROVIDER=api` and `ANTHROPIC_API_KEY`. It uses `claude-opus-5`, the SDK's `messages.parse` with Zod, and the server-side refusal fallback.
- **Offline.** Deterministic fixtures and rules when no provider is available. This is also the fallback when a provider fails.

The product UI does not reveal which path produced a result.

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
