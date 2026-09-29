# Simulated integrations

No real Razorpay, Marrow, messaging or Slack calls are made. Marrow is the merchant in a simulated scenario: its systems, services and incidents here are fictional. Each integration is simulated in `src/adapters/demo`, or is data in the fixtures.

| Integration | Access | Simulated behaviour |
|---|---|---|
| Razorpay Payments | Read payment, order and webhook data; write `capture_payment`, `replay_webhook`; `issue_refund` not granted | Capture emits `payment.captured` and `order.paid` plus a delivery. Replay emits a new delivery. Both then ask LearnLoop to fulfil. |
| Merchant Orders API | Read-only | Merchant orders in fixtures. |
| Learning Access Service | Read access status; write `grant_learning_access` | Grants access 2 s after a request while `learning-access-service` is healthy; otherwise returns HTTP 500. Repeated idempotency keys are ignored. |
| Customer communications | Write `send_customer_message` | Email only. Messages are recorded on the case or incident and in the audit log, not delivered. Opted-out customers are excluded. |
| Slack incident management | Write `create_incident`, `post_message` | Escalations and engineering incidents are recorded with references, not posted. |
| Platform Monitoring | Read-only | Deploy events and service errors or recoveries in fixtures; the source for "deployment v2.3". |

Revoking an integration removes its scopes, and policy then blocks every action that needs them. Reconnecting restores read context only: write access must be granted again separately on the Integrations page, and that grant is audited.

The event-booking contract is fulfilled by the merchant's booking service, which has no connected integration. Its `confirm_booking` scope is therefore not granted, so booking retries are always blocked by policy and come to a person. Membership activation (`activate_membership`) works the same way.

# Deliberate non-goals

- **No backend or database.** State lives in the browser (`localStorage`). Data is per browser and is not shared between users.
- **No authentication.** The operator is Priya Sharma (Payments Operations Manager). The only role check is the one that allows revealing customer contact details.
- **No real payments, refunds, messages or Slack posts.** Refunds are only prepared for merchant finance, because Payment Integrity has no refund permission.
- **No live detection engine.** Cases and incidents come from fixtures. New healthy purchases arrive on a fixed schedule; no new failures are generated.
- **No chatbot.** The agent's work appears inside the workflows (investigations, drafts, explanations), not as a conversation.
- **No automatic autonomy changes.** The agent only suggests.
- **No demo controls in the product.** Failure simulation and data reset are in Developer settings (avatar menu), outside the main navigation.
- **Mobile layout only for the customer page.** The admin console is desktop-first and supports tablet widths.
