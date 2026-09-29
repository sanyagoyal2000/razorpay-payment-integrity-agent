# Data model

All types are in `src/domain/types.ts`. Types from the specification keep its fields. Additions are listed here with the reason for each.

## Payment side (Razorpay)

| Type | Purpose |
|---|---|
| `Payment` | A Razorpay payment. `captureDeadline` is set for authorised payments: creation + 3 days, Razorpay's default auto-refund window. |
| `PaymentEvent` | `order.created`, `payment.authorized`, `payment.captured`, `order.paid`, `payment.refunded`. |
| `WebhookDelivery` | Each `order.paid` delivery attempt to Marrow's endpoint, with response code and latency. |

## Merchant side (Marrow, simulated)

| Type | Purpose |
|---|---|
| `MerchantOrder` | The Marrow order, keyed by `merchant_order_id` (e.g. `MR-4301232`). |
| `Customer` | **Extended** with `emailOptOut`. Opted-out customers are never messaged; one fixture customer in INC-0017 is opted out. Operations views show email and phone masked (`domain/privacy.ts`). |
| `MerchantOutcomeEvent` | Fulfilment events. Request and failure event types follow each contract's fulfilment service (`domain/fulfilment.ts`): learning access, booking, membership activation, wallet credit, plan upgrade. **Extended** beyond learning package access with `booking_confirmed`, `booking.failed`, `membership_activated`, `wallet_credited` and `plan_upgraded`, so the non-course contracts have outcomes. |
| `ObservabilityEvent` | **Added.** Platform Monitoring: `deploy.completed` (v2.3), `service.errors_detected`, `service.recovered`. This is the only source for mentioning the deployment. |
| `ScheduledPurchase` | **Added.** Healthy purchases after the fixture horizon. They become visible as real time passes, which feeds "Monitor the next 50 purchases". |

## Payment Integrity

| Type | Purpose |
|---|---|
| `OutcomeContract` | What a payment must produce. **Extended** with the editor's fields: product scope, fulfilment service, verification method, always-review case types, inventory check and notification template. |
| `OutcomeReceipt` | **Added.** Records whether a captured payment's outcome was `confirmed` or `missing` at its deadline. |
| `IntegrityCase` | **Extended**: `amountAtRisk` (the original payment only), `refundExposure` (duplicate charges), `defaultOutcome` (`auto_refund` / `customer_contact` / `none`, used by Value delivered), `customerContact`, `observation`, `decisions`, `resolution`, `followUps`, `investigationRun`, and `version` (used to stop execution if the case changed). |
| `IncidentRecord` / `Incident` | Stored incident plus the spec's computed view. `amountAtRisk` and `affectedCustomers` are always computed from cases, never stored. **Extended** with `containment` decisions and `investigationRun`. |
| `IncidentUpdate` | History snapshots: case count, exposure, root-cause confidence, system health. |
| `Investigation` | The spec's structured response, **extended** with `hypotheses` (each cause with a `supported` / `ruled_out` / `inconclusive` verdict and its evidence). |
| `Recommendation` | The action currently proposed; `origin` is investigation, rule fallback or merchant edit. |
| `PolicyVerdict` / `PolicyCheck` | The spec's shape, **extended** with the action evaluated, `approvalScope` (`bulk` / `individual`) and each check's `enforcement` (`hard` blocks, `review` requires individual approval). |
| `Execution` | One run of the state machine: steps with times, idempotency key, the verdict from the pre-execution re-check, the receipt, and any failure. |
| `AuditEvent` | Append-only. **Extended** with policy result, approval source, and case and incident links, plus an optional `detail` (`AuditDetail`): invocation ID, trigger, agent and policy versions, sources read, what produced the result, input and output fingerprints, idempotency key, execution state and failure. It never holds customer contact details or model reasoning. |
| `InvestigationRun` | **Extended** with `casesCompared`, `serviceHealth` and `stages`: the observable stage log. `eventsExamined` counts events only; cases are counted separately. |
| `Integration.writeAuthority` | **Added.** Write authority is recorded separately from the connection. Reconnecting sets it to `not_granted`; only an explicit, audited grant restores it. Undefined means granted. |
| `ActionPolicy`, `GlobalControls`, `Integration`, `ConnectorLog`, `SystemFlags` | Automations modes, global limits and the kill switch, connections and scopes, connector errors, and simulated dependency health. |
| `DailyOutcomeStat` | Aggregates for high-volume healthy traffic (about 2,000 learning package purchases a day). Each stat carries the IDs of its cases, so completion rates reconcile with the case list exactly. |

## Invariants (tested)

- Incident totals, recovery groups, Overview figures and Value delivered always equal the sum of the cases behind them, before and after recovery (`tests/reconciliation.test.ts`).
- The incident is ₹1,82,457: 38 safe cases = ₹1,51,962, 3 duplicates = ₹10,497 (originals only), 2 high-value = ₹19,998. After the safe cases are recovered, ₹30,495 remains.
- Every evidence ID cited anywhere resolves to a recorded event.
- Generated text never contains wall-clock times, so anchoring to the real clock cannot contradict it.
