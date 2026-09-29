import { FULFILMENT_REQUEST_TYPES } from "@/domain/fulfilment";
import { maskedContact } from "@/services/privacy";
import type { ActionType, CaseStatus, CaseType, Execution, IntegrityCase, PolicyVerdict } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import { istDate } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { customerStatus } from "@/services/customerStatus";
import { decisionOption, EDIT_ACTIONS, isOpenForDecision, REFUSAL_ACTIONS, type DecisionOption } from "@/services/decisions";
import { isAtRisk } from "@/services/metrics/cases";
import { actionLabel, serviceLabel } from "@/services/policy/actions";
import { evaluateCase, requireContract } from "@/services/policy/currentState";
import { assessCase, planBulkRecovery } from "@/services/recovery/groups";
import { describeCaseInvestigation } from "@/services/agent";
import { groupEvidence, resolveEvidence } from "./evidence";
import { investigationView } from "./investigation";
import { AMOUNT_BANDS, type AmountBand } from "./incidents";
import { CASE_TYPE_LABELS } from "./overview";

// ---------------------------------------------------------------------------
// Case list
// ---------------------------------------------------------------------------

export type CaseRow = {
  id: string;
  customer: string;
  email: string;
  phone: string;
  paymentId: string;
  relatedPaymentIds: string[];
  orderId: string;
  razorpayOrderId: string;
  type: CaseType;
  typeLabel: string;
  amount: number;
  detectedAt: string;
  recommendation: string;
  recommendedAction?: ActionType;
  policyState: PolicyVerdict["result"] | "not_applicable";
  policyLabel: string;
  bulkEligible: boolean;
  status: CaseStatus;
  incidentId?: string;
};

const POLICY_LABELS: Record<PolicyVerdict["result"], string> = {
  allowed: "Allowed",
  requires_approval: "Approval required",
  blocked: "Blocked",
};

export function caseRows(repos: Repositories, asOf: string): CaseRow[] {
  return repos.cases
    .list()
    .map((c): CaseRow => {
      const payment = repos.payments.get(c.paymentId)!;
      const customer = repos.payments.customer(c.customerId)!;
      const assessment = isAtRisk(c) ? assessCase(repos, c, asOf) : undefined;
      const verdict = assessment?.verdict;
      const row: CaseRow = {
        id: c.id,
        customer: customer.name,
        email: customer.email,
        phone: customer.phone,
        paymentId: c.paymentId,
        relatedPaymentIds: c.relatedPaymentIds,
        orderId: payment.merchantOrderId,
        razorpayOrderId: payment.orderId,
        type: c.type,
        typeLabel: CASE_TYPE_LABELS[c.type],
        amount: c.amountAtRisk,
        detectedAt: c.detectedAt,
        recommendation: c.recommendation ? actionLabel(c.recommendation.action, repos.config.contract(c.outcomeContractId)) : c.status === "observing" ? "None: observing" : "None",
        policyState: verdict?.result ?? "not_applicable",
        policyLabel: verdict ? (verdict.result === "requires_approval" && verdict.approvalScope === "bulk" ? "Approval required" : POLICY_LABELS[verdict.result]) : "–",
        bulkEligible: assessment?.group === "safe",
        status: c.status,
      };
      if (c.recommendation) row.recommendedAction = c.recommendation.action;
      if (c.incidentId) row.incidentId = c.incidentId;
      return row;
    })
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

export type CaseFilters = {
  query: string;
  statuses: CaseStatus[];
  types: CaseType[];
  from?: string;
  to?: string;
  amount: AmountBand;
};

export const DEFAULT_CASE_FILTERS: CaseFilters = { query: "", statuses: [], types: [], amount: "any" };

/** Matches payment ID, order ID (LearnLoop or Razorpay), customer name, email or phone. */
export function matchesQuery(row: CaseRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  const haystack = [row.id, row.paymentId, ...row.relatedPaymentIds, row.orderId, row.razorpayOrderId, row.customer, row.email].map((v) => v.toLowerCase());
  if (haystack.some((v) => v.includes(q))) return true;
  return digits.length >= 4 && row.phone.replace(/\D/g, "").includes(digits);
}

function inBand(amount: number, band: AmountBand): boolean {
  switch (band) {
    case "any":
      return true;
    case "none":
      return amount === 0;
    case "under_10k":
      return amount > 0 && amount < 10_000;
    case "10k_1l":
      return amount >= 10_000 && amount <= 100_000;
    case "over_1l":
      return amount > 100_000;
  }
}

export function filterCases(rows: readonly CaseRow[], filters: CaseFilters): CaseRow[] {
  return rows.filter((row) => {
    if (!matchesQuery(row, filters.query)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(row.status)) return false;
    if (filters.types.length > 0 && !filters.types.includes(row.type)) return false;
    const detected = istDate(row.detectedAt);
    if (filters.from && detected < filters.from) return false;
    if (filters.to && detected > filters.to) return false;
    return inBand(row.amount, filters.amount);
  });
}

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  observing: "Observing",
  open: "Open",
  review_required: "Review required",
  approved: "Approved",
  executing: "Executing",
  resolved: "Resolved",
  rejected: "Rejected",
  escalated: "Escalated",
};

export function describeCaseFilters(filters: CaseFilters): string[] {
  const parts: string[] = [];
  if (filters.query.trim()) parts.push(`Search "${filters.query.trim()}"`);
  if (filters.statuses.length > 0) parts.push(`Status: ${filters.statuses.map((s) => CASE_STATUS_LABELS[s]).join(", ")}`);
  if (filters.types.length > 0) parts.push(`Type: ${filters.types.map((t) => CASE_TYPE_LABELS[t]).join(", ")}`);
  if (filters.from || filters.to) parts.push(`Detected ${filters.from ?? "any time"} to ${filters.to ?? "today"}`);
  if (filters.amount !== "any") parts.push(AMOUNT_BANDS.find((b) => b.value === filters.amount)!.label);
  return parts;
}

/**
 * Bulk selection is allowed only when every selected case shares the same safe
 * action and bulk policy eligibility. Explains why when it is not.
 */
export function bulkSelection(repos: Repositories, caseIds: readonly string[], asOf: string) {
  const plan = planBulkRecovery(repos, caseIds, asOf);
  const allowed = caseIds.length > 0 && plan.excluded.length === 0;
  return {
    allowed,
    plan,
    reason: caseIds.length === 0 ? "Select cases to approve together." : allowed ? undefined : `Bulk approval needs every selected case to be safe to recover. ${plan.excluded.length} of ${caseIds.length} are not.`,
  };
}

// ---------------------------------------------------------------------------
// Case detail
// ---------------------------------------------------------------------------

export type TimelineSource = "razorpay" | "merchant" | "agent" | "human";

export type TimelineEntry = {
  id: string;
  at: string;
  source: TimelineSource;
  title: string;
  detail?: string;
  tone?: "failure" | "success";
};

const PAYMENT_EVENT_TITLES: Record<string, string> = {
  "order.created": "Order created",
  "payment.authorized": "Payment authorised",
  "payment.captured": "Payment captured",
  "order.paid": "order.paid webhook sent",
  "payment.refunded": "Payment refunded",
};

const INTEGRITY_TITLES: Record<string, string> = {
  "outcome.deadline_missed": "Outcome deadline missed",
  "case.opened": "Integrity case opened",
  "case.observing": "Outcome slower than usual; observing",
  "case.clustered": "Grouped into incident",
  "incident.created": "Incident created",
  "outcome.verified": "Outcome verified",
  "outcome.arrived_late": "Outcome arrived; case closed",
};

function outcomeTitle(type: string, responseCode?: number): string {
  const titles: Record<string, string> = {
    "enrolment.requested": "Enrolment requested",
    "enrolment.failed": "Enrolment request failed",
    "booking.requested": "Booking requested",
    "membership.activation_requested": "Membership activation requested",
    "membership.activation_failed": "Membership activation failed",
    "wallet.credit_requested": "Wallet credit requested",
    "wallet.credit_failed": "Wallet credit failed",
    "plan.upgrade_requested": "Plan upgrade requested",
    "plan.upgrade_failed": "Plan upgrade failed",
    course_access_granted: "Course access granted",
    course_access_revoked: "Course access revoked",
    inventory_changed: "Seat inventory changed",
    booking_confirmed: "Booking confirmed",
    "booking.failed": "Booking failed",
    membership_activated: "Membership activated",
    wallet_credited: "Wallet credited",
    plan_upgraded: "Plan upgraded",
  };
  const title = titles[type] ?? type;
  return responseCode && responseCode >= 400 ? `${title}: HTTP ${responseCode}` : title;
}

/** Chronological payment-to-outcome timeline, tagged by who produced each entry. */
export function caseTimeline(repos: Repositories, c: IntegrityCase, asOf: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const contract = requireContract(repos, c.outcomeContractId);
  const paymentIds = [c.paymentId, ...c.relatedPaymentIds];
  for (const [index, paymentId] of paymentIds.entries()) {
    const payment = repos.payments.get(paymentId);
    if (!payment) continue;
    const suffix = index > 0 ? " (second payment)" : "";
    for (const e of repos.payments.events(paymentId)) {
      entries.push({ id: e.id, at: e.occurredAt, source: "razorpay", title: `${PAYMENT_EVENT_TITLES[e.type] ?? e.type}${suffix}`, detail: paymentId });
    }
    for (const d of repos.payments.deliveriesForPayment(paymentId)) {
      const ok = d.status === "delivered";
      entries.push({
        id: d.id,
        at: d.occurredAt,
        source: "merchant",
        title: `Merchant webhook returned ${d.responseCode ? `HTTP ${d.responseCode}` : "no response"}${suffix}`,
        detail: `Attempt ${d.attempt}`,
        ...(ok ? {} : { tone: "failure" as const }),
      });
    }
    for (const e of repos.outcomes.events(payment.merchantOrderId)) {
      if (e.status === "pending" && !FULFILMENT_REQUEST_TYPES.has(e.type) && e.type !== contract.expectedOutcome) continue;
      entries.push({
        id: e.id,
        at: e.occurredAt,
        source: "merchant",
        title: `${outcomeTitle(e.type, e.responseCode)}${e.status === "pending" && e.type === contract.expectedOutcome ? ": in progress" : ""}${suffix}`,
        ...(e.metadata?.["initiatedBy"] === "payment_integrity" ? { detail: "Requested by Payment Integrity" } : e.metadata?.["change"] ? { detail: String(e.metadata["change"]) } : {}),
        ...(e.status === "failed" ? { tone: "failure" as const } : e.type === contract.expectedOutcome && e.status === "completed" ? { tone: "success" as const } : {}),
      });
    }
  }
  const first = entries.map((e) => e.at).sort()[0] ?? c.detectedAt;
  const last = c.resolution?.resolvedAt ?? asOf;
  // Service health is shown when it bears on this case: before detection, or
  // afterwards for cases in an incident caused by that service.
  const incident = c.incidentId ? repos.incidents.get(c.incidentId) : undefined;
  const followsService = incident?.affectedService === contract.fulfilmentService;
  for (const e of repos.outcomes.observability(contract.fulfilmentService)) {
    if (e.type === "deploy.completed" || e.occurredAt < first || e.occurredAt > last) continue;
    if (e.occurredAt > c.detectedAt && !followsService) continue;
    entries.push({
      id: e.id,
      at: e.occurredAt,
      source: "merchant",
      title: e.type === "service.recovered" ? `${serviceLabel(e.service)} recovered` : `${serviceLabel(e.service)} errors detected`,
      ...(e.type === "service.recovered" ? {} : { tone: "failure" as const }),
    });
  }
  for (const e of repos.outcomes.integrityEvents({ caseId: c.id })) {
    entries.push({
      id: e.id,
      at: e.occurredAt,
      source: "agent",
      title: e.type === "case.clustered" && e.incidentId ? `Grouped into incident ${e.incidentId}` : INTEGRITY_TITLES[e.type] ?? e.type,
      ...(e.type === "outcome.verified" || e.type === "outcome.arrived_late" ? { tone: "success" as const } : {}),
    });
  }
  for (const e of repos.audit.forCase(c.id)) {
    if (e.actor === ACTORS.operator) entries.push({ id: e.id, at: e.occurredAt, source: "human", title: e.action, detail: e.result });
    else if (e.actor === ACTORS.policy && e.policyResult === "blocked") entries.push({ id: e.id, at: e.occurredAt, source: "agent", title: "Policy blocked recovery", detail: e.result, tone: "failure" });
    else if (e.actor === ACTORS.agent && (e.action === "Recommended action" || e.action === "Escalated case")) entries.push({ id: e.id, at: e.occurredAt, source: "agent", title: e.action, detail: e.result });
  }
  // Stable sort: events in the same second keep the order they were recorded in.
  return entries.filter((e) => e.at <= asOf).sort((a, b) => a.at.localeCompare(b.at));
}

export function caseDetail(repos: Repositories, caseId: string, asOf: string) {
  const c = repos.cases.get(caseId);
  if (!c) return undefined;
  const payment = repos.payments.get(c.paymentId)!;
  const customer = repos.payments.customer(c.customerId)!;
  const order = repos.payments.order(payment.merchantOrderId);
  const product = order ? repos.payments.product(order.productId) : undefined;
  const contract = requireContract(repos, c.outcomeContractId);
  const incident = c.incidentId ? repos.incidents.get(c.incidentId) : undefined;
  const related = c.relatedPaymentIds.map((id) => repos.payments.get(id)).filter((p) => p !== undefined);
  const otherAttempts = repos.payments
    .list()
    .filter((p) => p.customerId === c.customerId && p.id !== c.paymentId && !c.relatedPaymentIds.includes(p.id));

  const open = isOpenForDecision(c);
  const refusal = c.type === "inventory_conflict";
  const recommended = c.recommendation?.action;
  // Policy is shown for the action that would change the payment or outcome.
  const primaryAction: ActionType | undefined =
    recommended && !["escalate", "wait", "review_alternate_inventory", "notify_customer", "prepare_refund"].includes(recommended)
      ? recommended
      : recommended
        ? contract.safeRecoveryAction
        : undefined;
  const primary: DecisionOption | undefined = primaryAction ? decisionOption(repos, c, primaryAction, asOf) : undefined;
  const liveVerdict = primary?.verdict ?? (c.recommendation ? evaluateCase(repos, c, c.recommendation, asOf) : undefined);
  const lastVerdictEvent = repos.audit.forCase(c.id).filter((e) => e.policyResult).at(-1);
  const executions = repos.executions.forCase(c.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const receipt = repos.outcomes.receiptForPayment(c.paymentId);
  const outcomeEvent = receipt?.outcomeEventId ? repos.outcomes.event(receipt.outcomeEventId) : undefined;
  const evidence = groupEvidence(repos, c.recommendation?.evidenceIds ?? []);

  return {
    caseData: c,
    typeLabel: CASE_TYPE_LABELS[c.type],
    payment,
    // Contact details are masked; the full values are shown only through an audited reveal.
    customer: { id: customer.id, name: customer.name, ...maskedContact(repos, customer.id), emailOptOut: customer.emailOptOut === true },
    order,
    product,
    contract,
    incident,
    related,
    otherAttempts,
    customerView: customerStatus(repos, c),
    timeline: caseTimeline(repos, c, asOf),
    investigation: investigationView(repos, c.investigation, describeCaseInvestigation(repos, c, asOf), "case"),
    recommendation: c.recommendation,
    evidence,
    evidenceCount: evidence.reduce((n, g) => n + g.items.length, 0),
    unresolvedEvidence: (c.recommendation?.evidenceIds ?? []).filter((id) => !resolveEvidence(repos, id)),
    open,
    refusal,
    primary,
    verdict: open ? liveVerdict : undefined,
    recordedPolicyResult: lastVerdictEvent?.policyResult,
    recordedPolicySummary: lastVerdictEvent?.result,
    editOptions: open ? EDIT_ACTIONS.map((a) => decisionOption(repos, c, a, asOf)) : [],
    refusalOptions: open && refusal ? REFUSAL_ACTIONS.map((a) => decisionOption(repos, c, a, asOf)) : [],
    escalateOption: open ? decisionOption(repos, c, "escalate", asOf) : undefined,
    latestExecution: executions.at(-1) as Execution | undefined,
    executions,
    outcome: c.status === "resolved" ? { event: outcomeEvent, receipt, expectedOutcome: contract.expectedOutcome } : undefined,
  };
}

export type CaseDetailModel = NonNullable<ReturnType<typeof caseDetail>>;
