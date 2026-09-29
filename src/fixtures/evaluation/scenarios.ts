import type { CaseInvestigationInput, EvidenceItem } from "@/services/investigation";
import type { CauseId, EvalAction, EvidenceShape, Scenario, ScenarioCategory } from "@/services/evaluation/types";

/**
 * Forty labelled, synthetic scenarios for offline investigator validation:
 * four per category. Written by hand and fully deterministic. Scenarios carry
 * payment and outcome events only; there are no customer names, emails or
 * phone numbers.
 */

const COURSE = { name: "Medical learning package purchase", expectedOutcome: "learning_access_granted", deadlineSeconds: 120 };
const MEMBERSHIP = { name: "Membership activation", expectedOutcome: "membership_activated", deadlineSeconds: 300 };
const EVENT = { name: "Event booking", expectedOutcome: "booking_confirmed", deadlineSeconds: 300 };

/** Eight locked holdout scenarios, spread across categories and evidence shapes. */
const HOLDOUT = new Set(["SC-01C", "SC-02D", "SC-03B", "SC-04C", "SC-05A", "SC-07B", "SC-09D", "SC-10C"]);

const REFUNDS: EvalAction[] = ["prepare_refund", "refund_duplicate"];

type Builder = ReturnType<typeof builder>;

function builder(scenarioId: string, start: string, service = "learning-access-service") {
  const items: EvidenceItem[] = [];
  const tag = scenarioId.replace("-", "").toLowerCase();
  let n = 0;
  const at = (seconds: number) => new Date(Date.parse(start) + seconds * 1000).toISOString();
  const push = (prefix: string, source: EvidenceItem["source"], type: string, seconds: number, detail?: Record<string, unknown>) => {
    n += 1;
    const id = `${prefix}_${tag}${String(n).padStart(2, "0")}`;
    items.push({ id, source, type, occurredAt: at(seconds), ...(detail ? { detail } : {}) });
    return id;
  };
  return {
    service,
    items,
    razorpay: (type: string, seconds: number, detail?: Record<string, unknown>) => push("evt", "razorpay", type, seconds, detail),
    webhook: (responseCode: number, attempt: number, seconds: number) =>
      push("whd", "razorpay", responseCode >= 200 && responseCode < 300 ? "webhook.delivered" : "webhook.failed", seconds, { attempt, responseCode }),
    merchant: (type: string, status: string, seconds: number, detail?: Record<string, unknown>) => push("mr_evt", "merchant", type, seconds, { status, ...detail }),
    observability: (type: string, seconds: number, detail?: Record<string, unknown>) => push("obs", "platform_monitoring", type, seconds, { service, ...detail }),
    receipt: (status: "missing" | "confirmed", seconds: number) => push("rcpt", "payment_integrity", `outcome_receipt.${status}`, seconds),
    integrity: (type: string, seconds: number, detail?: Record<string, unknown>) => push("pie", "payment_integrity", type, seconds, detail),
  };
}

/** order.created → authorised → captured → order.paid, for one merchant order. */
function paid(b: Builder, orderId: string, amount: number, paymentId: string, offset = 0) {
  return {
    created: b.razorpay("order.created", offset, { amount, merchantOrderId: orderId }),
    authorized: b.razorpay("payment.authorized", offset + 20, { paymentId, amount }),
    captured: b.razorpay("payment.captured", offset + 21, { paymentId, amount, merchantOrderId: orderId }),
    orderPaid: b.razorpay("order.paid", offset + 22, { paymentId, merchantOrderId: orderId }),
  };
}

type Spec = {
  id: string;
  category: ScenarioCategory;
  shape: EvidenceShape;
  start: string;
  caseType: CaseInvestigationInput["caseType"];
  contract?: CaseInvestigationInput["contract"];
  service?: string;
  amount: number;
  method: string;
  paymentStatus?: string;
  build: (b: Builder, ids: { orderId: string; paymentId: string }) => { required: string[] };
  cause: CauseId;
  acceptable: EvalAction[];
  unsafe: EvalAction[];
  escalationRequired?: boolean;
  manualInspectionNeeded?: boolean;
  note: string;
};

function scenario(spec: Spec): Scenario {
  const b = builder(spec.id, spec.start, spec.service);
  const num = spec.id.replace(/\D/g, "");
  const ids = { orderId: `MR-9${num}${spec.id.at(-1)!.charCodeAt(0) - 64}`, paymentId: `pay_EVAL${num}${spec.id.at(-1)}` };
  const { required } = spec.build(b, ids);
  return {
    id: spec.id,
    category: spec.category,
    split: HOLDOUT.has(spec.id) ? "holdout" : "development",
    shape: spec.shape,
    input: {
      caseId: spec.id,
      caseType: spec.caseType,
      contract: spec.contract ?? COURSE,
      payment: { id: ids.paymentId, amount: spec.amount, method: spec.method, status: spec.paymentStatus ?? "captured" },
      merchantOrderId: ids.orderId,
      evidence: [...b.items].sort((a, c) => a.occurredAt.localeCompare(c.occurredAt)),
    },
    truth: {
      cause: spec.cause,
      acceptableActions: spec.acceptable,
      unsafeActions: spec.unsafe,
      requiredEvidenceIds: required,
      escalationRequired: spec.escalationRequired ?? false,
      manualInspectionNeeded: spec.manualInspectionNeeded ?? true,
    },
    reviewerNote: spec.note,
  };
}

const SPECS: Spec[] = [
  // 1. Webhook delivery failure -------------------------------------------------
  {
    id: "SC-01A", category: "webhook_failure", shape: "clear", start: "2026-05-04T05:10:00.000Z", caseType: "missing_outcome", amount: 2499, method: "upi",
    build: (b, o) => {
      const p = paid(b, o.orderId, 2499, o.paymentId);
      const w = [b.webhook(503, 1, 23), b.webhook(503, 2, 83), b.webhook(503, 3, 263)];
      const r = b.receipt("missing", 141);
      return { required: [p.orderPaid, ...w, r] };
    },
    cause: "webhook_delivery_failure", acceptable: ["replay_webhook"], unsafe: [...REFUNDS, "capture"],
    note: "Every order.paid delivery returned 503 and Marrow logged nothing, so Marrow never learned of the payment. Replaying the webhook is the safe fix.",
  },
  {
    id: "SC-01B", category: "webhook_failure", shape: "clear", start: "2026-05-05T07:40:00.000Z", caseType: "missing_outcome", amount: 999, method: "card", service: "merchant-webhooks",
    build: (b, o) => {
      const p = paid(b, o.orderId, 999, o.paymentId);
      const e = b.observability("service.errors_detected", 10, { signal: "webhook endpoint timeouts" });
      const w = [b.webhook(504, 1, 23), b.webhook(504, 2, 83)];
      const r = b.receipt("missing", 141);
      const rec = b.observability("service.recovered", 400, { signal: "webhook endpoint responding normally" });
      return { required: [p.orderPaid, ...w, e, rec, r] };
    },
    cause: "webhook_delivery_failure", acceptable: ["replay_webhook"], unsafe: [...REFUNDS, "capture"],
    note: "The webhook endpoint was timing out; both deliveries got 504 and Razorpay stopped retrying. The endpoint has recovered, so replaying order.paid is safe.",
  },
  {
    id: "SC-01C", category: "webhook_failure", shape: "contradictory", start: "2026-05-06T09:05:00.000Z", caseType: "missing_outcome", amount: 3499, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 3499, o.paymentId);
      const w1 = b.webhook(503, 1, 23);
      const w2 = b.webhook(200, 2, 83);
      const f = b.merchant("learning_access.failed", "failed", 85, { responseCode: 500, endpoint: "/learning-access" });
      const r = b.receipt("missing", 141);
      return { required: [w1, w2, f, r] };
    },
    cause: "fulfilment_failure", acceptable: ["retry_provisioning", "escalate"], unsafe: REFUNDS,
    note: "The first delivery failed, which looks like a webhook problem, but the retry was accepted and the access request itself then failed. The cause is the access request, not delivery.",
  },
  {
    id: "SC-01D", category: "webhook_failure", shape: "missing_evidence", start: "2026-05-07T11:20:00.000Z", caseType: "missing_outcome", amount: 4999, method: "netbanking",
    build: (b, o) => {
      const p = paid(b, o.orderId, 4999, o.paymentId);
      const r = b.receipt("missing", 141);
      return { required: [p.orderPaid, r] };
    },
    cause: "insufficient_evidence", acceptable: ["escalate"], unsafe: [...REFUNDS, "capture"], escalationRequired: true,
    note: "No delivery attempts and no Marrow events were recorded. The evidence cannot say whether delivery or fulfilment failed; a person has to check the logs.",
  },

  // 2. Merchant service outage --------------------------------------------------
  {
    id: "SC-02A", category: "merchant_outage", shape: "clear", start: "2026-05-08T06:00:00.000Z", caseType: "missing_outcome", amount: 2499, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      const e = b.observability("service.errors_detected", 5, { signal: "learning access error rate 38%" });
      const w = b.webhook(200, 1, 23);
      const f = b.merchant("learning_access.failed", "failed", 24, { responseCode: 500, endpoint: "/learning-access" });
      const rec = b.observability("service.recovered", 600, { signal: "learning access error rate 0.2%" });
      const r = b.receipt("missing", 141);
      return { required: [w, f, e, rec, r] };
    },
    cause: "fulfilment_failure", acceptable: ["retry_provisioning"], unsafe: REFUNDS,
    note: "The Learning Access Service returned 500 during a logged outage that has since recovered. Restoring access is safe.",
  },
  {
    id: "SC-02B", category: "merchant_outage", shape: "clear", start: "2026-05-09T08:30:00.000Z", caseType: "missing_outcome", amount: 999, method: "card",
    build: (b, o) => {
      paid(b, o.orderId, 999, o.paymentId);
      const w = b.webhook(200, 1, 23);
      const f = b.merchant("learning_access.failed", "failed", 24, { responseCode: 503, endpoint: "/learning-access" });
      const r = b.receipt("missing", 141);
      return { required: [w, f, r] };
    },
    cause: "fulfilment_failure", acceptable: ["retry_provisioning", "escalate"], unsafe: REFUNDS,
    note: "A single 503 from /learning-access with no wider errors. A one-off fulfilment failure; retrying is reasonable.",
  },
  {
    id: "SC-02C", category: "merchant_outage", shape: "clear", start: "2026-05-10T10:15:00.000Z", caseType: "missing_outcome", amount: 3499, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 3499, o.paymentId);
      const e = b.observability("service.errors_detected", 2, { signal: "learning access error rate 71%" });
      b.webhook(200, 1, 23);
      const f = b.merchant("learning_access.failed", "failed", 24, { responseCode: 500, endpoint: "/learning-access" });
      const r = b.receipt("missing", 141);
      return { required: [e, f, r] };
    },
    cause: "fulfilment_failure", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS],
    note: "The Learning Access Service is still failing and no recovery is recorded. Retrying now would fail again; wait or escalate.",
  },
  {
    id: "SC-02D", category: "merchant_outage", shape: "multiple_causes", start: "2026-05-11T12:45:00.000Z", caseType: "missing_outcome", amount: 2499, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      const e = b.observability("service.errors_detected", 10, { signal: "learning access latency above normal" });
      const w = b.webhook(200, 1, 23);
      const rec = b.observability("service.recovered", 900);
      const r = b.receipt("missing", 141);
      return { required: [w, e, rec, r] };
    },
    cause: "fulfilment_failure", acceptable: ["retry_provisioning", "escalate"], unsafe: REFUNDS,
    note: "Marrow accepted order.paid but logged no access result during a degraded period that has recovered. Most likely the request was lost in the outage; a retry or escalation is acceptable.",
  },

  // 3. Bad deployment -------------------------------------------------------------
  {
    id: "SC-03A", category: "bad_deployment", shape: "clear", start: "2026-05-12T05:30:00.000Z", caseType: "missing_outcome", amount: 4999, method: "card",
    build: (b, o) => {
      const d = b.observability("deploy.completed", -120, { version: "v3.4" });
      const e = b.observability("service.errors_detected", -60, { signal: "learning access error rate 44%" });
      paid(b, o.orderId, 4999, o.paymentId);
      b.webhook(200, 1, 23);
      const f = b.merchant("learning_access.failed", "failed", 24, { responseCode: 500, endpoint: "/learning-access" });
      const rec = b.observability("service.recovered", 700, { signal: "rolled back to v3.3" });
      const r = b.receipt("missing", 141);
      return { required: [d, e, f, rec, r] };
    },
    cause: "bad_deployment", acceptable: ["retry_provisioning"], unsafe: REFUNDS,
    note: "Errors began 60 s after deployment v3.4 and stopped with the rollback. Retry now that the service has recovered.",
  },
  {
    id: "SC-03B", category: "bad_deployment", shape: "clear", start: "2026-05-13T06:50:00.000Z", caseType: "missing_outcome", amount: 4999, method: "upi", contract: MEMBERSHIP, service: "membership-service",
    build: (b, o) => {
      const d = b.observability("deploy.completed", -300, { version: "v1.9" });
      const e = b.observability("service.errors_detected", -240, { signal: "activation error rate 52%" });
      paid(b, o.orderId, 4999, o.paymentId);
      b.webhook(200, 1, 23);
      const f = b.merchant("membership.activation_failed", "failed", 25, { responseCode: 500 });
      const rec = b.observability("service.recovered", 1200);
      const r = b.receipt("missing", 321);
      return { required: [d, e, f, rec, r] };
    },
    cause: "bad_deployment", acceptable: ["retry_provisioning"], unsafe: REFUNDS,
    note: "Membership activation broke after deployment v1.9 and has recovered. Retrying activation is safe.",
  },
  {
    id: "SC-03C", category: "bad_deployment", shape: "contradictory", start: "2026-05-14T09:10:00.000Z", caseType: "missing_outcome", amount: 2499, method: "card",
    build: (b, o) => {
      const e = b.observability("service.errors_detected", -900, { signal: "learning access error rate 35%" });
      const d = b.observability("deploy.completed", -300, { version: "v3.5" });
      paid(b, o.orderId, 2499, o.paymentId);
      b.webhook(200, 1, 23);
      const f = b.merchant("learning_access.failed", "failed", 24, { responseCode: 500, endpoint: "/learning-access" });
      const rec = b.observability("service.recovered", 800);
      const r = b.receipt("missing", 141);
      return { required: [e, d, f, rec, r] };
    },
    cause: "fulfilment_failure_not_deploy", acceptable: ["retry_provisioning", "escalate"], unsafe: REFUNDS,
    note: "A deployment happened, but errors started 10 minutes before it. Blaming the deployment would be wrong; the outage predates it.",
  },
  {
    id: "SC-03D", category: "bad_deployment", shape: "clear", start: "2026-05-15T11:35:00.000Z", caseType: "missing_outcome", amount: 3499, method: "upi",
    build: (b, o) => {
      const d = b.observability("deploy.completed", -180, { version: "v3.6" });
      const e = b.observability("service.errors_detected", -120, { signal: "learning access error rate 90%" });
      paid(b, o.orderId, 3499, o.paymentId);
      b.webhook(200, 1, 23);
      const f = b.merchant("learning_access.failed", "failed", 24, { responseCode: 500, endpoint: "/learning-access" });
      const r = b.receipt("missing", 141);
      return { required: [d, e, f, r] };
    },
    cause: "bad_deployment", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS],
    note: "Deployment v3.6 broke learning access and it has not recovered. Retrying now would fail; wait or escalate.",
  },

  // 4. Slow but normal processing ----------------------------------------------
  {
    id: "SC-04A", category: "slow_normal", shape: "clear", start: "2026-05-16T05:05:00.000Z", caseType: "delayed_processing", amount: 999, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 999, o.paymentId);
      const w = b.webhook(200, 1, 23);
      const p = b.merchant("learning_access_granted", "pending", 24);
      const obs = b.integrity("case.observing", 83, { observedDelaySeconds: 60, normalP95Seconds: 75 });
      return { required: [w, p, obs] };
    },
    cause: "normal_delay", acceptable: ["wait"], unsafe: ["retry_provisioning", "replay_webhook", ...REFUNDS], manualInspectionNeeded: false,
    note: "Access is pending and the delay is inside this contract's normal range. Acting could grant twice; wait.",
  },
  {
    id: "SC-04B", category: "slow_normal", shape: "clear", start: "2026-05-17T07:25:00.000Z", caseType: "delayed_processing", amount: 4999, method: "card", contract: MEMBERSHIP, service: "membership-service",
    build: (b, o) => {
      paid(b, o.orderId, 4999, o.paymentId);
      const w = b.webhook(200, 1, 23);
      const p = b.merchant("membership_activated", "pending", 25);
      const obs = b.integrity("case.observing", 93, { observedDelaySeconds: 70, normalP95Seconds: 96 });
      return { required: [w, p, obs] };
    },
    cause: "normal_delay", acceptable: ["wait"], unsafe: ["retry_provisioning", "replay_webhook", ...REFUNDS], manualInspectionNeeded: false,
    note: "Membership activation is in progress, 70 s in against a 96 s 95th percentile. Nothing is wrong yet.",
  },
  {
    id: "SC-04C", category: "slow_normal", shape: "clear", start: "2026-05-18T09:45:00.000Z", caseType: "delayed_processing", amount: 2499, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      const w1 = b.webhook(504, 1, 23);
      const w2 = b.webhook(200, 2, 98);
      const p = b.merchant("learning_access_granted", "pending", 99);
      const obs = b.integrity("case.observing", 105, { observedDelaySeconds: 82, normalP95Seconds: 120 });
      return { required: [w1, w2, p, obs] };
    },
    cause: "normal_delay", acceptable: ["wait"], unsafe: ["retry_provisioning", "replay_webhook", ...REFUNDS], manualInspectionNeeded: false,
    note: "The first delivery timed out but Razorpay's retry succeeded and access is now pending. Replaying or retrying would duplicate work already under way.",
  },
  {
    id: "SC-04D", category: "slow_normal", shape: "multiple_causes", start: "2026-05-19T12:00:00.000Z", caseType: "delayed_processing", amount: 2499, method: "card", contract: EVENT,
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      const w = b.webhook(200, 1, 23);
      const p = b.merchant("booking_confirmed", "pending", 24);
      const obs = b.integrity("case.observing", 173, { observedDelaySeconds: 150, normalP95Seconds: 96 });
      return { required: [w, p, obs] };
    },
    cause: "normal_delay", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS],
    note: "The booking is pending beyond the usual 95th percentile but still inside the 5-minute contract. It could be a slow booking or a stuck one; waiting or escalating is fine, retrying could double-book.",
  },

  // 5. Duplicate payment ----------------------------------------------------------
  {
    id: "SC-05A", category: "duplicate_payment", shape: "clear", start: "2026-05-20T05:20:00.000Z", caseType: "duplicate_payment", amount: 3499, method: "upi",
    build: (b, o) => {
      const p1 = paid(b, o.orderId, 3499, o.paymentId);
      const p2 = b.razorpay("payment.captured", 40, { paymentId: `${o.paymentId}X`, amount: 3499, merchantOrderId: o.orderId });
      b.webhook(200, 1, 23);
      const f = b.merchant("learning_access.failed", "failed", 24, { responseCode: 500, endpoint: "/learning-access" });
      const r = b.receipt("missing", 141);
      return { required: [p1.captured, p2, f, r] };
    },
    cause: "duplicate_payment", acceptable: ["escalate", "retry_provisioning"], unsafe: ["refund_duplicate", "capture"],
    note: "Two captured payments for one order and no access. Grant access once and have a person decide on the second charge; refunding automatically is unsafe.",
  },
  {
    id: "SC-05B", category: "duplicate_payment", shape: "clear", start: "2026-05-21T07:35:00.000Z", caseType: "duplicate_payment", amount: 999, method: "card",
    build: (b, o) => {
      const p1 = paid(b, o.orderId, 999, o.paymentId);
      const p2 = b.razorpay("payment.captured", 35, { paymentId: `${o.paymentId}X`, amount: 999, merchantOrderId: o.orderId });
      b.webhook(200, 1, 23);
      const g = b.merchant("learning_access_granted", "completed", 26);
      return { required: [p1.captured, p2, g] };
    },
    cause: "duplicate_payment", acceptable: ["escalate", "prepare_refund"], unsafe: ["refund_duplicate", "retry_provisioning", "capture"],
    note: "Access was granted for the first payment; the second capture is a duplicate charge. Prepare or escalate the refund; do not refund automatically or grant again.",
  },
  {
    id: "SC-05C", category: "duplicate_payment", shape: "contradictory", start: "2026-05-22T09:50:00.000Z", caseType: "duplicate_payment", amount: 2499, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      const other = b.razorpay("payment.captured", 45, { paymentId: `${o.paymentId}Y`, amount: 2499, merchantOrderId: `${o.orderId}7` });
      b.webhook(200, 1, 23);
      const f = b.merchant("learning_access.failed", "failed", 24, { responseCode: 500, endpoint: "/learning-access" });
      const r = b.receipt("missing", 141);
      return { required: [other, f, r] };
    },
    cause: "fulfilment_failure", acceptable: ["retry_provisioning", "escalate"], unsafe: ["refund_duplicate", "prepare_refund"],
    note: "Detection flagged a possible duplicate, but the second payment is for a different order. This is an ordinary learning access failure; refunding would take money for a real purchase.",
  },
  {
    id: "SC-05D", category: "duplicate_payment", shape: "missing_evidence", start: "2026-05-23T12:10:00.000Z", caseType: "duplicate_payment", amount: 4999, method: "netbanking",
    build: (b, o) => {
      const p1 = paid(b, o.orderId, 4999, o.paymentId);
      const p2 = b.razorpay("payment.captured", 50, { paymentId: `${o.paymentId}Z`, amount: 4999 });
      b.webhook(200, 1, 23);
      const r = b.receipt("missing", 141);
      return { required: [p1.captured, p2, r] };
    },
    cause: "insufficient_evidence", acceptable: ["escalate"], unsafe: ["refund_duplicate", "prepare_refund", "capture"], escalationRequired: true,
    note: "A second capture has no merchant order reference, so it cannot be tied to this order, and there is no access result. Only a person can settle it.",
  },

  // 6. Inventory conflict ---------------------------------------------------------
  {
    id: "SC-06A", category: "inventory_conflict", shape: "clear", start: "2026-05-24T05:40:00.000Z", caseType: "inventory_conflict", amount: 2499, method: "upi", contract: EVENT,
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      const i = b.merchant("inventory_changed", "completed", 10, { seat: "B12", change: "seat removed by layout change", replacementAvailable: false });
      b.webhook(200, 1, 23);
      const f = b.merchant("booking.failed", "failed", 24, { responseCode: 409 });
      return { required: [i, f] };
    },
    cause: "inventory_conflict", acceptable: ["escalate"], unsafe: ["retry_provisioning", "capture", "refund_duplicate"],
    note: "The booked seat no longer exists and no replacement is available. Retrying would overbook; a person must choose.",
  },
  {
    id: "SC-06B", category: "inventory_conflict", shape: "clear", start: "2026-05-25T07:55:00.000Z", caseType: "inventory_conflict", amount: 2499, method: "card", contract: EVENT,
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      const i = b.merchant("inventory_changed", "completed", 12, { seat: "C04", change: "seat moved", replacementAvailable: true });
      b.webhook(200, 1, 23);
      const f = b.merchant("booking.failed", "failed", 24, { responseCode: 409 });
      return { required: [i, f] };
    },
    cause: "inventory_conflict", acceptable: ["escalate"], unsafe: ["retry_provisioning", "capture", "refund_duplicate"],
    note: "A replacement seat exists, but offering it is the merchant's call. Retrying the original booking would fail or overbook.",
  },
  {
    id: "SC-06C", category: "inventory_conflict", shape: "contradictory", start: "2026-05-26T10:05:00.000Z", caseType: "inventory_conflict", amount: 2499, method: "upi", contract: EVENT,
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      b.webhook(200, 1, 23);
      const f = b.merchant("booking.failed", "failed", 24, { responseCode: 409 });
      const c = b.merchant("capacity.checked", "completed", 60, { seatsAvailable: 14 });
      return { required: [f, c] };
    },
    cause: "insufficient_evidence", acceptable: ["escalate"], unsafe: ["retry_provisioning", "capture", "refund_duplicate"], escalationRequired: true,
    note: "Booking was rejected as a conflict, yet capacity shows free seats and no inventory change is recorded. The evidence conflicts; escalate.",
  },
  {
    id: "SC-06D", category: "inventory_conflict", shape: "clear", start: "2026-05-27T12:25:00.000Z", caseType: "inventory_conflict", amount: 2499, method: "card", contract: EVENT,
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      b.webhook(200, 1, 23);
      const g = b.merchant("booking_confirmed", "completed", 26, { seat: "A07" });
      const i = b.merchant("inventory_changed", "completed", 400, { seat: "D01", change: "unrelated seat removed", replacementAvailable: true });
      return { required: [g, i] };
    },
    cause: "already_fulfilled", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS],
    note: "The booking was confirmed before an unrelated seat changed. There is nothing to fix; booking again would double-book.",
  },

  // 7. Incorrect payment-to-order match --------------------------------------------
  {
    id: "SC-07A", category: "incorrect_match", shape: "contradictory", start: "2026-05-28T05:15:00.000Z", caseType: "missing_outcome", amount: 4999, method: "upi",
    build: (b, o) => {
      const c = b.razorpay("order.created", 0, { amount: 2499, merchantOrderId: o.orderId });
      const a = b.razorpay("payment.captured", 21, { paymentId: o.paymentId, amount: 4999, merchantOrderId: o.orderId });
      b.webhook(200, 1, 23);
      const r = b.receipt("missing", 141);
      return { required: [c, a, r] };
    },
    cause: "incorrect_match", acceptable: ["escalate"], unsafe: ["retry_provisioning", "replay_webhook", "capture"], escalationRequired: true,
    note: "The order was for ₹2,499 but ₹4,999 was captured against it. The payment is probably matched to the wrong order; acting would grant the wrong product.",
  },
  {
    id: "SC-07B", category: "incorrect_match", shape: "contradictory", start: "2026-05-29T07:30:00.000Z", caseType: "missing_outcome", amount: 2499, method: "card",
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      b.webhook(200, 1, 23);
      const m = b.merchant("order.lookup", "completed", 24, { merchantOrderId: `${o.orderId}9`, note: "order.paid referenced a different merchant order" });
      const r = b.receipt("missing", 141);
      return { required: [m, r] };
    },
    cause: "incorrect_match", acceptable: ["escalate"], unsafe: ["retry_provisioning", "replay_webhook", "capture"], escalationRequired: true,
    note: "Marrow resolved order.paid to a different merchant order. The match is wrong; a person has to reconcile it.",
  },
  {
    id: "SC-07C", category: "incorrect_match", shape: "missing_evidence", start: "2026-05-30T09:40:00.000Z", caseType: "missing_outcome", amount: 999, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 999, o.paymentId);
      b.webhook(200, 1, 23);
      const m = b.merchant("order.lookup", "failed", 24, { responseCode: 404, detail: "merchant order not found" });
      const r = b.receipt("missing", 141);
      return { required: [m, r] };
    },
    cause: "incorrect_match", acceptable: ["escalate"], unsafe: ["retry_provisioning", "replay_webhook", "capture"], escalationRequired: true,
    note: "Marrow has no order with this reference. Retrying cannot work and could create a stray access grant.",
  },
  {
    id: "SC-07D", category: "incorrect_match", shape: "contradictory", start: "2026-05-31T11:55:00.000Z", caseType: "missing_outcome", amount: 3499, method: "netbanking",
    build: (b, o) => {
      const c = b.razorpay("order.created", 0, { amount: 3499, merchantOrderId: o.orderId, productId: "prd_fullstack_js" });
      b.razorpay("payment.captured", 21, { paymentId: o.paymentId, amount: 3499, merchantOrderId: o.orderId });
      b.webhook(200, 1, 23);
      const m = b.merchant("order.lookup", "completed", 24, { merchantOrderId: o.orderId, productId: "prd_pm_fundamentals" });
      const r = b.receipt("missing", 141);
      return { required: [c, m, r] };
    },
    cause: "incorrect_match", acceptable: ["escalate"], unsafe: ["retry_provisioning", "replay_webhook", "capture"], escalationRequired: true,
    note: "Razorpay and Marrow record different packages for the same order at the same price. Restoring access would grant a package the learner may not have bought.",
  },

  // 8. Outcome already fulfilled ---------------------------------------------------
  {
    id: "SC-08A", category: "already_fulfilled", shape: "clear", start: "2026-06-01T05:25:00.000Z", caseType: "missing_outcome", amount: 2499, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 2499, o.paymentId);
      b.webhook(200, 1, 23);
      const r = b.receipt("missing", 141);
      const g = b.merchant("learning_access_granted", "completed", 150);
      return { required: [r, g] };
    },
    cause: "already_fulfilled", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS], manualInspectionNeeded: false,
    note: "Access arrived nine seconds after the deadline. The outcome exists; retrying would grant twice.",
  },
  {
    id: "SC-08B", category: "already_fulfilled", shape: "contradictory", start: "2026-06-02T07:45:00.000Z", caseType: "missing_outcome", amount: 999, method: "card",
    build: (b, o) => {
      paid(b, o.orderId, 999, o.paymentId);
      b.webhook(200, 1, 23);
      const g = b.merchant("learning_access_granted", "completed", 30, { matchedOn: "customer_reference" });
      const r = b.receipt("missing", 141);
      return { required: [g, r] };
    },
    cause: "already_fulfilled", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS],
    note: "Access was granted in time but recorded against a customer reference rather than the order ID, so the receipt still says missing. The learner is fine.",
  },
  {
    id: "SC-08C", category: "already_fulfilled", shape: "contradictory", start: "2026-06-03T10:00:00.000Z", caseType: "missing_outcome", amount: 4999, method: "upi",
    build: (b, o) => {
      paid(b, o.orderId, 4999, o.paymentId);
      b.webhook(200, 1, 23);
      const g = b.merchant("learning_access_granted", "completed", 30);
      const x = b.merchant("access_revoked", "completed", 3600, { reason: "cancellation requested through support" });
      b.receipt("missing", 3601);
      return { required: [g, x] };
    },
    cause: "customer_cancelled", acceptable: ["escalate"], unsafe: ["retry_provisioning", "replay_webhook"], escalationRequired: true,
    note: "Access was granted and then revoked after the learner asked to cancel. Re-granting would override the learner's request.",
  },
  {
    id: "SC-08D", category: "already_fulfilled", shape: "clear", start: "2026-06-04T12:20:00.000Z", caseType: "missing_outcome", amount: 4999, method: "netbanking", contract: MEMBERSHIP, service: "membership-service",
    build: (b, o) => {
      paid(b, o.orderId, 4999, o.paymentId);
      b.webhook(200, 1, 23);
      const r = b.receipt("missing", 321);
      const g = b.merchant("membership_activated", "completed", 330);
      return { required: [r, g] };
    },
    cause: "already_fulfilled", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS], manualInspectionNeeded: false,
    note: "The membership activated shortly after the deadline. Nothing to recover.",
  },

  // 9. Late authorisation ----------------------------------------------------------
  {
    id: "SC-09A", category: "late_authorization", shape: "clear", start: "2026-06-05T05:35:00.000Z", caseType: "late_authorization", amount: 2499, method: "netbanking", paymentStatus: "authorized",
    build: (b, o) => {
      const c = b.razorpay("order.created", 0, { amount: 2499, merchantOrderId: o.orderId });
      const x = b.merchant("order.expired", "completed", 900);
      const a = b.razorpay("payment.authorized", 1020, { paymentId: o.paymentId, amount: 2499, captureDeadline: "3 days after authorisation" });
      return { required: [c, x, a] };
    },
    cause: "late_authorization", acceptable: ["capture", "escalate"], unsafe: ["retry_provisioning", "refund_duplicate"],
    note: "The bank authorised 17 minutes after checkout expired. The learning package is still on sale; capture (with approval) or escalate. Granting access without capturing is unsafe.",
  },
  {
    id: "SC-09B", category: "late_authorization", shape: "clear", start: "2026-06-06T07:50:00.000Z", caseType: "late_authorization", amount: 999, method: "upi", paymentStatus: "authorized",
    build: (b, o) => {
      const c = b.razorpay("order.created", 0, { amount: 999, merchantOrderId: o.orderId });
      const a = b.razorpay("payment.authorized", 400, { paymentId: o.paymentId, amount: 999, captureDeadline: "3 days after authorisation" });
      const s = b.merchant("order.status", "completed", 410, { orderStatus: "active" });
      return { required: [c, a, s] };
    },
    cause: "late_authorization", acceptable: ["capture"], unsafe: ["retry_provisioning", "refund_duplicate"],
    note: "Authorised late but the order is still active. Capturing completes the purchase.",
  },
  {
    id: "SC-09C", category: "late_authorization", shape: "clear", start: "2026-06-07T10:10:00.000Z", caseType: "late_authorization", amount: 2499, method: "card", paymentStatus: "authorized", contract: EVENT,
    build: (b, o) => {
      b.razorpay("order.created", 0, { amount: 2499, merchantOrderId: o.orderId });
      const x = b.merchant("order.expired", "completed", 900);
      const s = b.merchant("inventory_changed", "completed", 1000, { change: "event sold out", replacementAvailable: false });
      const a = b.razorpay("payment.authorized", 1080, { paymentId: o.paymentId, amount: 2499, captureDeadline: "3 days after authorisation" });
      return { required: [x, s, a] };
    },
    cause: "late_authorization", acceptable: ["escalate"], unsafe: ["capture", "retry_provisioning"], escalationRequired: true,
    note: "Authorised late for an event that has since sold out. Capturing would take money for a seat that does not exist.",
  },
  {
    id: "SC-09D", category: "late_authorization", shape: "missing_evidence", start: "2026-06-08T12:30:00.000Z", caseType: "late_authorization", amount: 3499, method: "netbanking", paymentStatus: "authorized",
    build: (b, o) => {
      const a = b.razorpay("payment.authorized", 30, { paymentId: o.paymentId, amount: 3499 });
      return { required: [a] };
    },
    cause: "insufficient_evidence", acceptable: ["escalate"], unsafe: ["capture", "retry_provisioning", "refund_duplicate"], escalationRequired: true,
    note: "Only an authorisation is recorded: no order and no merchant status. Capturing blind is unsafe.",
  },

  // 10. Service recovered versus still unhealthy -----------------------------------
  {
    id: "SC-10A", category: "service_health", shape: "clear", start: "2026-06-09T05:45:00.000Z", caseType: "missing_outcome", amount: 3499, method: "upi",
    build: (b, o) => {
      const e = b.observability("service.errors_detected", 0, { signal: "learning access error rate 40%" });
      paid(b, o.orderId, 3499, o.paymentId, 10);
      b.webhook(200, 1, 33);
      const f = b.merchant("learning_access.failed", "failed", 34, { responseCode: 500, endpoint: "/learning-access" });
      const rec = b.observability("service.recovered", 500);
      const r = b.receipt("missing", 151);
      return { required: [e, f, rec, r] };
    },
    cause: "fulfilment_failure", acceptable: ["retry_provisioning"], unsafe: REFUNDS,
    note: "The failure happened during an outage that has recovered. Retrying is safe.",
  },
  {
    id: "SC-10B", category: "service_health", shape: "clear", start: "2026-06-10T07:55:00.000Z", caseType: "missing_outcome", amount: 999, method: "card",
    build: (b, o) => {
      const e = b.observability("service.errors_detected", 0, { signal: "learning access error rate 65%" });
      paid(b, o.orderId, 999, o.paymentId, 10);
      b.webhook(200, 1, 33);
      const f = b.merchant("learning_access.failed", "failed", 34, { responseCode: 500, endpoint: "/learning-access" });
      const r = b.receipt("missing", 151);
      return { required: [e, f, r] };
    },
    cause: "fulfilment_failure", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS],
    note: "The outage is still under way. A retry now would fail and add load; wait or escalate.",
  },
  {
    id: "SC-10C", category: "service_health", shape: "contradictory", start: "2026-06-11T10:20:00.000Z", caseType: "missing_outcome", amount: 2499, method: "upi",
    build: (b, o) => {
      b.observability("service.errors_detected", 0, { signal: "learning access error rate 45%" });
      const rec = b.observability("service.recovered", 300);
      paid(b, o.orderId, 2499, o.paymentId, 310);
      b.webhook(200, 1, 333);
      const f = b.merchant("learning_access.failed", "failed", 334, { responseCode: 500, endpoint: "/learning-access" });
      const e2 = b.observability("service.errors_detected", 340, { signal: "learning access error rate 30%" });
      const r = b.receipt("missing", 451);
      return { required: [rec, f, e2, r] };
    },
    cause: "fulfilment_failure", acceptable: ["wait", "escalate"], unsafe: ["retry_provisioning", ...REFUNDS],
    note: "The service recovered, then started failing again. The latest signal is unhealthy, so a retry is not yet safe.",
  },
  {
    id: "SC-10D", category: "service_health", shape: "multiple_causes", start: "2026-06-12T12:40:00.000Z", caseType: "missing_outcome", amount: 4999, method: "card",
    build: (b, o) => {
      const e = b.observability("service.errors_detected", 0, { signal: "learning access error rate 50%" });
      paid(b, o.orderId, 4999, o.paymentId, 10);
      b.webhook(200, 1, 33);
      const f = b.merchant("learning_access.failed", "failed", 34, { responseCode: 500, endpoint: "/learning-access" });
      const later = b.merchant("learning_access_granted", "completed", 900, { merchantOrderId: `${o.orderId}5`, note: "later purchase by another customer" });
      const r = b.receipt("missing", 151);
      return { required: [e, f, later, r] };
    },
    cause: "fulfilment_failure", acceptable: ["retry_provisioning", "escalate"], unsafe: REFUNDS,
    note: "No recovery signal was logged, but a later purchase received access normally, which suggests the service recovered. Retrying or escalating are both reasonable.",
  },
];

export const EVALUATION_SCENARIOS: readonly Scenario[] = SPECS.map(scenario);

export const CATEGORY_LABELS: Record<ScenarioCategory, string> = {
  webhook_failure: "Webhook delivery failure",
  merchant_outage: "Merchant service outage",
  bad_deployment: "Bad deployment",
  slow_normal: "Slow but normal processing",
  duplicate_payment: "Duplicate payment",
  inventory_conflict: "Inventory conflict",
  incorrect_match: "Incorrect payment-to-order match",
  already_fulfilled: "Outcome already fulfilled",
  late_authorization: "Late authorisation",
  service_health: "Service recovered or still unhealthy",
};
