# Build Payment Integrity Agent as a production-quality product prototype

Build a polished, coherent web application called **Payment Integrity**, designed as a native agent within Razorpay Agent Studio.

This is a product prototype, not a scripted demo. It must look and behave like a credible product that a payments operations team could use every day.

Do not add:

- "Start demo" controls.
- Presenter modes.
- Guided tours.
- Artificial incident-arrival animations.
- Demo scripts inside the interface.
- Labels such as "simulated capability."
- A marketing landing page.
- A predetermined click path.
- Pitch-specific explanations in the product UI.

Use realistic seeded data because there is no production backend, but structure the application so the mock data layer could be replaced by real APIs later.

The product should remain understandable without narration. Every page, state and action should have a clear operational purpose.

---

# Product definition

## Product name

**Payment Integrity**

Navigation location:

```text
Agent Studio
└── Payment Integrity
```

## Product promise

> Ensure that every successful payment produces the business outcome it promised.

A payment can be captured successfully while the corresponding merchant outcome fails:

- A student pays but does not receive course access.
- A SaaS customer upgrades but their plan does not change.
- A customer buys credits but the wallet balance is not updated.
- A membership payment succeeds but the membership stays inactive.
- A booking payment succeeds but no booking is confirmed.
- A customer pays twice after the first successful payment appears unresolved.

Payment Integrity connects the payment state with the merchant's outcome state, detects inconsistencies, investigates their cause and enables the merchant to recover them safely.

## Core product principle

Make this separation explicit in the architecture and interface:

> **Rules detect. AI investigates. Policy validates. APIs execute. Outcomes verify.**

The AI never directly executes a financial or fulfilment action.

---

# Primary user

The primary user is a payments or operations manager at a mid-sized digital merchant.

Use the example merchant:

```text
Merchant: LearnLoop
Industry: Edtech
Primary user: Priya Sharma
Role: Payments Operations Manager
Environment: Live
Timezone: Asia/Kolkata
Currency: INR
```

LearnLoop sells digital courses from ₹999 to ₹9,999. It processes payments through Razorpay and uses an internal enrolment service to grant access.

Priya needs to:

- Know how much revenue is currently at risk.
- Find customers who paid but did not receive access.
- Understand why an incident occurred.
- Distinguish safe recoveries from ambiguous cases.
- Approve, edit or reject proposed actions.
- Control what the agent may automate.
- Verify that the customer eventually received access.
- Review every decision in an audit log.
- Identify recurring integration problems.

She does not need a chatbot or a generic analytics dashboard.

---

# Product architecture

Build the application around these domain objects.

## Payment

```ts
type Payment = {
  id: string;
  orderId: string;
  merchantOrderId: string;
  customerId: string;
  amount: number;
  currency: "INR";
  method: "upi" | "card" | "netbanking";
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  createdAt: string;
  capturedAt?: string;
  captureDeadline?: string;
};
```

## Customer

```ts
type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
};
```

## Payment event

```ts
type PaymentEvent = {
  id: string;
  paymentId: string;
  source: "razorpay";
  type:
    | "order.created"
    | "payment.authorized"
    | "payment.captured"
    | "order.paid"
    | "payment.refunded";
  occurredAt: string;
  metadata?: Record<string, unknown>;
};
```

## Webhook delivery

```ts
type WebhookDelivery = {
  id: string;
  eventId: string;
  endpoint: string;
  attempt: number;
  responseCode?: number;
  latencyMs?: number;
  status: "delivered" | "failed" | "pending";
  occurredAt: string;
};
```

## Merchant outcome event

```ts
type MerchantOutcomeEvent = {
  id: string;
  merchantOrderId: string;
  source: "learnloop";
  type:
    | "enrolment.requested"
    | "enrolment.failed"
    | "course_access_granted"
    | "course_access_revoked"
    | "inventory_changed";
  status: "pending" | "completed" | "failed";
  responseCode?: number;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};
```

## Outcome Contract

An Outcome Contract defines what a successful payment is expected to produce.

```ts
type OutcomeContract = {
  id: string;
  name: string;
  paymentType: string;
  expectedOutcome: string;
  matchingKey: string;
  deadlineSeconds: number;
  safeRecoveryAction: string;
  maxAutomaticValue: number;
  minimumConfidence: number;
  status: "active" | "paused" | "draft";
};
```

Example:

```text
Name: Course purchase
Expected outcome: course_access_granted
Matching key: merchant_order_id
Deadline: 2 minutes
Safe recovery: retry_provisioning
Maximum automatic value: ₹5,000
Minimum confidence: 95%
```

## Integrity case

```ts
type IntegrityCase = {
  id: string;
  paymentId: string;
  outcomeContractId: string;
  incidentId?: string;
  type:
    | "missing_outcome"
    | "duplicate_payment"
    | "late_authorization"
    | "inventory_conflict"
    | "delayed_processing";
  status:
    | "observing"
    | "open"
    | "review_required"
    | "approved"
    | "executing"
    | "resolved"
    | "rejected"
    | "escalated";
  amountAtRisk: number;
  detectedAt: string;
  deadline?: string;
  investigation?: Investigation;
  recommendation?: Recommendation;
  policyVerdict?: PolicyVerdict;
};
```

## Incident

```ts
type Incident = {
  id: string;
  title: string;
  status: "investigating" | "action_required" | "contained" | "resolved";
  severity: "low" | "medium" | "high" | "critical";
  caseIds: string[];
  startedAt: string;
  detectedAt: string;
  amountAtRisk: number;
  affectedCustomers: number;
  likelyCause?: string;
};
```

## Audit event

```ts
type AuditEvent = {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  targetType: "case" | "incident" | "policy" | "contract";
  targetId: string;
  result: string;
  evidenceIds?: string[];
};
```

---

# Seeded product state

Populate the product with several weeks of realistic data, not only one incident.

Include:

- Healthy payments with confirmed outcomes.
- Resolved integrity cases.
- Cases resolved automatically.
- Cases approved manually.
- Rejected recommendations.
- Waiting cases that never became incidents.
- A few webhook delivery failures.
- Late-authorisation cases.
- Duplicate-payment cases.
- One active systemic incident.

Use deterministic fixtures. Never generate random numbers when the application loads.

## Active incident

At 14:05, LearnLoop's deployment `v2.3` causes its internal enrolment service to fail.

The sequence is:

1. Payments are captured successfully.
2. Razorpay sends `order.paid`.
3. LearnLoop's webhook endpoint accepts the event with HTTP 200.
4. LearnLoop's downstream `/enroll` service returns HTTP 500.
5. No `course_access_granted` outcome appears within the two-minute SLA.
6. Payment Integrity detects missing outcomes.
7. Forty-three cases are clustered into one incident.
8. The enrolment service becomes healthy again at 14:18.
9. Eligible customers can now be recovered safely.

Incident totals:

```text
Total affected customers: 43
Total revenue at risk: ₹1,82,450

38 clean recovery cases: ₹1,51,955
3 duplicate-payment cases: ₹10,497
2 high-value cases: ₹19,998
```

The values must reconcile exactly across every screen.

## Refusal case

Include a separate event-ticket case:

- Payment captured.
- Original seat inventory changed.
- Merchant outcome cannot be safely completed.
- Automatic action is prohibited.
- Agent recommends human review.

## Waiting case

Include a case where processing is delayed by 70 seconds but remains within the merchant's learned normal range.

Status:

> Observing—within normal processing range.

The system should not recommend an action.

---

# Application structure

Build a complete application shell with functional navigation.

## Global navigation

Use:

- Overview
- Incidents
- Cases
- Outcome Contracts
- Automations
- Integrations
- Audit Log

Nest these under Payment Integrity in the Agent Studio section.

Other Razorpay navigation items may appear for context, but they do not need full implementations.

## Global capabilities

Include:

- Search by payment ID, order ID, customer name, email or phone.
- Date-range filtering.
- Status filtering.
- Case-type filtering.
- Amount filtering.
- Saved filter state.
- Consistent empty states.
- Loading states.
- Error states.
- Keyboard focus states.
- Toasts only for completed actions, not routine navigation.

Persist user changes in `localStorage`.

---

# Page 1: Overview

The Overview page should provide an operational summary without becoming a chart-heavy dashboard.

## Header

```text
Payment Integrity
Monitor and recover successful payments that have not completed their promised outcome.
```

Show:

- Merchant: LearnLoop.
- Live environment.
- Last data refresh.
- Agent status: Monitoring.
- Global automation status.

Do not show an "AI live" badge.

## Primary metrics

Use a restrained four-column metric row:

- Revenue currently at risk.
- Customers affected.
- Open incidents.
- Resolved before customer contact, trailing 30 days.

Amounts and counts must be traceable to the underlying cases.

Do not use oversized numbers or decorative charts.

## Active incidents

Show a table or structured list with:

- Incident.
- Started.
- Affected customers.
- Revenue at risk.
- Likely cause.
- Status.
- Required decision.

The active LearnLoop incident should be the first row.

## Cases requiring attention

Show:

- Late authorisation approaching its deadline.
- Duplicate payment requiring review.
- High-value recovery requiring approval.
- Inventory-conflict refusal.
- A waiting case.

Each row should explain why attention is or is not required.

## Integrity activity

Use a restrained recent-activity section:

- Outcomes verified.
- Cases resolved.
- Policies changed.
- Actions blocked.
- Incidents created.

Avoid a social-media-style activity feed.

## Performance summary

Use small, useful trends:

- Payment-to-outcome completion rate.
- Median outcome completion time.
- Cases resolved before customer contact.
- Avoidable refunds prevented.
- Wrong-action rate.

Charts should only appear when they communicate a trend. Use a line or bar chart sparingly and never more than two charts on the page.

---

# Page 2: Incidents

Display incidents in a dense, filterable table.

Columns:

- Incident.
- Status.
- Severity.
- Started.
- Cases.
- Customers.
- Revenue at risk.
- Likely cause.
- Owner.

Allow filtering by:

- Open/resolved.
- Severity.
- Outcome Contract.
- Date.
- Amount at risk.

Clicking an incident opens the incident workspace.

## Incident workspace

The incident page must support understanding and action.

### Summary header

Show:

- Incident title.
- Status.
- Severity.
- Revenue at risk.
- Affected customers.
- Start time.
- Detection time.
- Current system health.
- Owner.

### What happened

Use concise operational language:

> Payments continued succeeding, but LearnLoop's enrolment service stopped producing access confirmations after deployment v2.3.

### Evidence

Evidence must reference real fixture event IDs:

- Payment capture events.
- Successful webhook responses.
- Failed enrolment calls.
- Missing Outcome Receipts.
- Endpoint recovery.
- Similar case sequences.

Do not show unsupported AI claims.

### Uncertainties

Show what the system cannot safely infer:

- Whether duplicate payments were intentional.
- Whether high-value bundles require different access.
- Whether inventory remains valid for booking cases.

### Recovery groups

Group cases by recommended treatment:

| Group | Cases | Value | Recommendation | Policy |
|---|---:|---:|---|---|
| Safe to recover | 38 | ₹1,51,955 | Retry provisioning | Eligible after approval |
| Duplicate review | 3 | ₹10,497 | Grant once, review refund | Manual review |
| High value | 2 | ₹19,998 | Retry provisioning | Approval required |

Allow the merchant to select groups and preview the impact.

### Recovery plan

Show:

- Customers affected.
- Revenue addressed.
- Actions to be executed.
- Cases excluded.
- Customer communication.
- Verification method.
- Rollback or escalation behaviour.

The bulk action must never include duplicate or policy-blocked cases.

### Containment actions

Offer merchant decisions such as:

- Notify affected customers.
- Put new affected purchases into "access pending."
- Require review for new cases.
- Create an engineering incident.
- Monitor the next 50 matching purchases.

Do not automatically pause payments or disable checkout.

### Incident history

Show changes to:

- Case count.
- Revenue exposure.
- Root-cause confidence.
- System health.
- Actions taken.
- Customer outcomes.

---

# Page 3: Cases

Build a searchable, filterable case table.

Columns:

- Case ID.
- Customer.
- Payment ID.
- Order ID.
- Case type.
- Amount.
- Age.
- Recommendation.
- Policy state.
- Status.

Support bulk selection only when selected cases share the same safe action and policy eligibility.

## Case detail

Use a stable three-column structure:

### Left: Payment and customer

Show:

- Customer.
- Payment amount and method.
- Payment ID.
- Order ID.
- Payment state.
- Outcome Contract.
- Customer-contact state.
- Related attempts.

### Centre: Event timeline

Create a chronological payment-to-outcome timeline:

```text
14:07:02  Order created
14:07:08  Payment authorised
14:07:09  Payment captured
14:07:10  order.paid webhook sent
14:07:10  Merchant webhook returned HTTP 200
14:07:11  Enrolment request returned HTTP 500
14:09:11  Outcome deadline missed
14:09:12  Integrity case opened
14:18:40  Enrolment service recovered
```

Differentiate:

- Razorpay events.
- Merchant events.
- Agent events.
- Human actions.

Use subtle icons and labels, not multiple bright colours.

### Right: Decision panel

Separate three concepts:

#### Agent recommendation

- Proposed action.
- Summary.
- Confidence.
- Evidence references.
- Uncertainties.
- Customer impact.
- Consequence of inaction.

#### Policy verdict

Show every deterministic check:

- Payment captured.
- Payment not refunded.
- Outcome still missing.
- No successful duplicate.
- Enrolment service healthy.
- Idempotency key available.
- Amount within limit.
- Permission available.

Verdict must be one of:

- Allowed.
- Approval required.
- Blocked.

#### Merchant decision

Actions:

- Approve.
- Edit.
- Reject.
- Escalate.
- Wait and re-check.

Reject requires a reason.

Edit allows:

- Retry provisioning.
- Wait.
- Prepare refund.
- Review duplicate.
- Escalate.

Do not permit an action blocked by policy.

---

# Execution and verification

After approval, execute through a deterministic state machine.

States:

```text
approval_recorded
policy_rechecking
idempotency_reserved
action_started
awaiting_outcome
outcome_verified
resolved
```

Before execution:

- Re-fetch current payment state.
- Re-fetch current outcome state.
- Re-evaluate the policy.
- Stop if the case changed.
- Prevent duplicate execution.

After execution:

- Require an Outcome Receipt.
- Mark the case resolved only when the promised outcome is confirmed.
- Record every step in the audit log.
- Update all aggregate totals immediately.

Resolved state:

```text
Outcome confirmed
Course access granted at 14:22:10 IST.
Payment and merchant outcome are now consistent.
```

After the 38 safe incident cases are resolved:

```text
Initial amount at risk: ₹1,82,450
Resolved: ₹1,51,955
Remaining at risk: ₹30,495
Incident status: Contained
```

---

# Refusal state

The refusal case must look like a deliberate product decision, not a technical failure.

Show:

```text
No automatic action taken

The original inventory changed after payment. Completing this booking could create an overbooking. Human review is required.
```

Policy checks:

- Payment captured: Pass.
- Payment not refunded: Pass.
- Inventory unchanged: Fail.
- Valid replacement inventory: Unknown.
- Automatic fulfilment: Blocked.

Disable fulfilment approval.

Allow:

- Review alternate inventory.
- Contact customer.
- Prepare refund.
- Escalate.

Explain precisely why the system refused to act.

---

# Page 4: Outcome Contracts

Build a real management surface, not a static settings card.

Show all Outcome Contracts:

- Course purchase.
- SaaS upgrade.
- Wallet credit purchase.
- Membership activation.
- Event booking.

Each contract shows:

- Status.
- Connected payment type.
- Expected outcome.
- Deadline.
- Safe recovery.
- Automatic limit.
- Completion rate.
- Open cases.

## Contract editor

Support creating and editing:

- Contract name.
- Payment or product scope.
- Expected outcome.
- Matching identifier.
- Outcome deadline.
- Safe recovery action.
- Verification method.
- Maximum automatic value.
- Confidence requirement.
- Cases that always require review.
- Customer-notification template.
- Active/paused state.

Include field validation and a preview of the resulting logic.

Do not expose raw JSON as the primary configuration experience.

---

# Page 5: Automations and policies

Separate action permissions from Outcome Contracts.

## Action policies

Configure each action independently:

| Action | Default mode |
|---|---|
| Retry provisioning | Suggest only |
| Replay webhook | Suggest only |
| Capture payment | Always require approval |
| Prepare refund | Suggest only |
| Issue refund | Always require approval |
| Notify customer | Require approval |
| Escalate | Automatic |

Available modes:

- Suggest only.
- Automatic below value and confidence thresholds.
- Always require approval.
- Disabled.

## Earned autonomy

The system may recommend more automation based on merchant behaviour:

> Retry provisioning was approved without edits in 48 of the last 50 eligible cases.

The merchant must explicitly enable automation. Never change autonomy automatically.

## Global controls

- Maximum automatic value.
- Daily refund limit.
- Minimum confidence.
- Never act after inventory changes.
- Never act on low-confidence record matches.
- Require approval for customer communication.
- Pause all automated actions.

The kill switch:

- Stops new executions immediately.
- Does not stop monitoring or investigation.
- Leaves queued actions visible.
- Records the change in the audit log.

---

# Page 6: Integrations

Show connected systems and their purpose.

Connections:

- Razorpay Payments: Connected.
- LearnLoop Orders API: Connected, read-only.
- LearnLoop Enrolment API: Connected, scoped action permission.
- Customer communications: Connected.
- Slack or incident management: Connected.

For each integration show:

- Connection status.
- Permission scope.
- Last successful event.
- Recent error rate.
- Data accessed.
- Actions allowed.
- Revoke or reconnect.

## Integration health

Show meaningful operational indicators:

- Webhook delivery success.
- Outcome Receipt completion.
- Median event latency.
- Authentication errors.
- Schema errors.
- Permission failures.

Do not reduce everything to one unexplained health score.

## Permission model

Make permissions concrete:

```text
Read:
payment_status
order_status
course_access_status

Write:
grant_course_access

Not granted:
edit_customer
change_product
issue_refund
delete_order
```

Actions outside the granted scope must be impossible.

---

# Page 7: Audit Log

Create a finance-grade audit table.

Columns:

- Timestamp.
- Actor.
- Action.
- Target.
- Evidence.
- Policy result.
- Approval source.
- Outcome.

Actors include:

- Priya Sharma.
- Payment Integrity Agent.
- Deterministic policy engine.
- LearnLoop connector.

Support filtering by:

- Actor.
- Action type.
- Case.
- Incident.
- Outcome.
- Date.

Every material action must link back to its case, evidence and policy verdict.

Audit events should be immutable in the interface.

---

# Customer recovery page

Create a separate customer-facing route without an admin sidebar.

Title:

> Check my payment

Inputs:

- Phone number.
- Order ID.

Possible results:

### Resolved

> Your ₹2,499 payment was successful and your course access is now active.

### Recovery in progress

> We found your payment. Your access is being restored, and you will not be charged again.

### Under review

> Your payment is safe. A specialist is reviewing the order before any further action.

### Not found

> We couldn't find a matching payment. Check your details or contact LearnLoop support.

Do not expose:

- AI confidence.
- Internal errors.
- Webhook status.
- Policy thresholds.
- System architecture.

---

# AI investigation layer

Implement one AI boundary:

```ts
investigateCase(input): Promise<Investigation>
investigateIncident(input): Promise<Investigation>
```

Use deterministic fixture responses by default.

Optionally support a live Anthropic adapter when a key is configured, but the entire application must work without network access or an API key.

Do not display whether the recommendation came from fixture or live mode in the product UI. That information may appear in developer documentation.

## Structured response

```ts
type Investigation = {
  summary: string;
  likelyCause: string;
  evidenceIds: string[];
  uncertainties: string[];
  recommendedAction:
    | "wait"
    | "replay_webhook"
    | "retry_provisioning"
    | "capture"
    | "prepare_refund"
    | "refund_duplicate"
    | "escalate";
  confidence: number;
  customerImpact: string;
  consequenceOfInaction: string;
  customerMessageDraft?: string;
};
```

Validate live responses with Zod.

Requirements:

- Confidence must be between zero and one.
- Every evidence ID must exist in the supplied event set.
- Unsupported evidence is removed.
- Invalid output results in escalation.
- API failure produces a rule-based alert.
- The recommendation cannot bypass the policy engine.

The language model receives only data required for the case. Do not include unrelated customer information.

---

# Deterministic policy engine

Implement:

```ts
evaluatePolicy(
  caseData: IntegrityCase,
  action: Recommendation,
  currentState: CurrentMerchantState
): PolicyVerdict
```

```ts
type PolicyCheck = {
  id: string;
  label: string;
  status: "passed" | "failed" | "unknown";
  explanation: string;
};

type PolicyVerdict = {
  result: "allowed" | "requires_approval" | "blocked";
  checks: PolicyCheck[];
  evaluatedAt: string;
};
```

Policy logic must include:

- Current payment state.
- Current refund state.
- Outcome state.
- Duplicate detection.
- Inventory state.
- Merchant permission.
- Value threshold.
- Confidence threshold.
- Integration health.
- Idempotency.
- Global kill switch.

Always re-evaluate immediately before execution.

---

# Data and state behaviour

Use:

- Seeded JSON fixtures.
- A repository layer that abstracts data access.
- `localStorage` persistence.
- A reset-data option under developer settings, not in the primary interface.
- Predictable state transitions.
- No random data generation after initial seeding.

All actions must update:

- Case state.
- Incident totals.
- Overview metrics.
- Audit events.
- Related outcome records.
- Customer recovery status.

The product should feel internally consistent. Never update one screen without updating related screens.

---

# Technical stack

Use:

- Next.js with App Router.
- TypeScript.
- Tailwind CSS.
- shadcn/ui selectively.
- Lucide icons.
- Zod.
- Recharts only for genuinely useful trends.
- Local application state plus `localStorage`.
- No database.
- No authentication.
- No real Razorpay calls.

Structure the code so that these adapters are replaceable:

```text
repositories/
  payments
  outcomes
  incidents
  audit

services/
  investigation
  policy
  execution
  verification

adapters/
  demo
  anthropic
  merchant
```

Avoid a single oversized page component containing business logic.

---

# Visual direction

The product should communicate **quiet operational confidence**.

It should resemble a mature fintech operations tool, not a SaaS landing page or an AI concept mock-up.

## Application shell

- Desktop-first.
- 240px dark navy sidebar.
- Compact 60–64px top bar.
- Light neutral application canvas.
- Maximum content width around 1440px.
- Eight-pixel spacing system.
- Strong table alignment.
- Sticky filters and table headers where useful.
- Responsive down to tablet widths.
- Customer recovery page responsive to mobile.

## Typography

Use Inter or a similarly restrained sans-serif.

- Page title: 24px semibold.
- Primary financial number: 28–32px semibold.
- Section title: 15–16px semibold.
- Body: 14px.
- Metadata: 12–13px.
- Tabular numerals for amounts and timestamps.

Do not use oversized marketing typography inside the product.

## Surfaces

- White primary surfaces.
- Neutral one-pixel borders.
- Four- to eight-pixel corner radius.
- Almost no shadows.
- Clear divisions and alignment instead of excessive cards.
- Drawers for supporting detail.
- Full pages for consequential decisions.

## Colour

- Dark navy navigation.
- Razorpay-like blue for primary actions and selected navigation.
- Amber for revenue risk and approval-required states.
- Red only for blocked or destructive actions.
- Green only for verified outcomes.
- Grey for waiting, paused and informational states.

Use colour sparingly. The interface must remain understandable in greyscale.

## Icons

Use simple 16px Lucide icons.

Never use:

- Sparkles.
- Robot icons.
- Brains.
- Magic wands.
- AI orbs.
- 3D illustrations.
- Emojis in the product interface.

## Motion

Use motion only to communicate state:

- Drawer transitions.
- Execution progress.
- Metric updates.
- Status changes.
- Loading skeletons.

Do not use:

- Confetti.
- Pulsing glows.
- Animated gradients.
- Parallax.
- Decorative number counting.
- Auto-playing product tours.

---

# Anti-slop requirements

Do not create:

- A gradient hero section.
- Glassmorphism.
- A bento-grid homepage.
- A giant empty dashboard centred on one number.
- A chatbot as the primary interface.
- Generic AI copy.
- Decorative charts.
- Fake testimonials.
- Fake company logos.
- Excessive status pills.
- Every piece of content inside a rounded card.
- Purple-blue gradients.
- Floating action bubbles.
- "Good morning, Priya."
- "Unlock insights."
- "Supercharge your revenue."
- "Powered by advanced AI."
- An unexplained health score.
- A UI that narrates the product pitch to the user.
- Elements whose only purpose is to make a screenshot look busy.

Every interface element must help answer at least one question:

1. What revenue is at risk?
2. Which customers are affected?
3. What happened?
4. What evidence supports that conclusion?
5. What action is safe?
6. What requires human judgment?
7. Did the customer receive the promised outcome?

---

# Empty, loading and failure states

Build complete product states.

## No open incidents

> No active integrity incidents. Payment and outcome flows are operating normally.

Show the most recent monitoring time and access to resolved incidents.

## No matching cases

Explain which filters are active and provide a clear reset action.

## Outcome integration unavailable

Continue showing payment-side monitoring, but state:

> Merchant outcome verification is temporarily unavailable. No recovery actions will be executed until the connection is restored.

## AI investigation unavailable

Show:

> Automated investigation unavailable. Deterministic detection remains active.

Default recommendation:

> Escalate for review.

## Policy service unavailable

Block every execution action.

## Stale data

Show the last successful update and prevent consequential actions until state is refreshed.

---

# Accessibility and product quality

- Meet WCAG AA contrast.
- Support keyboard navigation.
- Provide visible focus states.
- Use semantic tables and headings.
- Explain disabled actions.
- Do not rely on colour alone.
- Format amounts using Indian numbering.
- Display time in IST.
- Make destructive actions visually distinct.
- Confirm refunds and irreversible actions.
- Avoid horizontal scrolling at standard desktop widths.
- Ensure there are no console errors.
- Ensure every primary route loads directly.
- Ensure browser refresh preserves current product state.

---

# Product acceptance criteria

The application is complete when:

1. Overview metrics reconcile with underlying incidents and cases.
2. Users can search and filter cases.
3. Users can inspect a payment-to-outcome timeline.
4. AI recommendations cite existing evidence.
5. Policy verdicts are deterministic and visible.
6. Safe cases can be approved and resolved.
7. Outcome verification is required before resolution.
8. Duplicate executions are prevented.
9. Duplicate-payment cases cannot enter bulk recovery.
10. High-value cases require approval.
11. Inventory-conflict cases are blocked.
12. Waiting cases do not generate unnecessary actions.
13. The kill switch prevents execution while preserving monitoring.
14. Outcome Contracts can be created, edited, paused and resumed.
15. Integration permissions affect available actions.
16. Every material action creates an audit event.
17. Changes persist across browser refreshes.
18. The app works without an external AI key.
19. Empty, loading, stale and unavailable states are implemented.
20. The visual system is consistent across every page.

---

# Deliverables

Produce:

- A complete working application.
- Realistic deterministic fixtures.
- Maintainable component and service architecture.
- README with setup instructions.
- Architecture documentation.
- Data-model documentation.
- Explanation of the AI and policy boundaries.
- List of simulated integrations.
- List of deliberate non-goals.
- Basic tests for policy decisions and state transitions.

The README may explain that this is a product concept using simulated data. Do not place prototype disclaimers throughout the actual product interface.

The finished application should feel like a merchant could use it continuously—not like a sequence of screens prepared for a presentation.

The central product truth must remain visible throughout:

> A successful payment is not successful commerce until the customer receives what they paid for.