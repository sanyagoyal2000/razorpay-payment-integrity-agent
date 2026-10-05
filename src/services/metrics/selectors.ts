/**
 * Single source of truth for counts and statuses shown on more than one
 * screen. Every figure is derived from the current case, payment, customer and
 * contract records at `asOf`; nothing is cached or copied from seed text, so a
 * case that changes state changes every screen at once.
 */
import type { IntegrityCase } from "@/domain/types";
import { formatINR, sum } from "@/domain/money";
import { MS_PER_DAY, secondsBetween } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { assessCase } from "@/services/recovery/groups";
import { isAtRisk } from "./cases";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Open cases and approvals
// ---------------------------------------------------------------------------

/** Cases whose outcome is owed and whose money is at risk (open, review required, approved, executing, escalated). */
export function openCases(repos: Repositories): IntegrityCase[] {
  return repos.cases.list().filter(isAtRisk);
}

/** Cases being observed: slower than usual but not yet past their contract deadline. Not at risk. */
export function observingCases(repos: Repositories): IntegrityCase[] {
  return repos.cases.list().filter((c) => c.status === "observing");
}

/**
 * Open cases with a recommendation that policy says needs merchant approval
 * now. Allowed (automatic) and blocked recommendations are not waiting for
 * approval.
 */
export function pendingApprovalCaseIds(repos: Repositories, asOf: string, cases: readonly IntegrityCase[] = openCases(repos)): string[] {
  return cases.filter((c) => assessCase(repos, c, asOf).verdict?.result === "requires_approval").map((c) => c.id);
}

export type CaseCounts = {
  /** Open (at-risk) cases. */
  open: number;
  /** Open cases with a recommendation waiting for merchant approval. */
  pendingApproval: number;
  /** Cases observed, not yet at risk. */
  observing: number;
  openCaseIds: string[];
  pendingApprovalCaseIds: string[];
  observingCaseIds: string[];
};

export function caseCounts(repos: Repositories, asOf: string): CaseCounts {
  const open = openCases(repos);
  const pending = pendingApprovalCaseIds(repos, asOf, open);
  const observing = observingCases(repos);
  return {
    open: open.length,
    pendingApproval: pending.length,
    observing: observing.length,
    openCaseIds: open.map((c) => c.id),
    pendingApprovalCaseIds: pending,
    observingCaseIds: observing.map((c) => c.id),
  };
}

/** "44 of 46 open cases await your approval", worded the same on every screen. */
export function approvalsLabel(counts: Pick<CaseCounts, "open" | "pendingApproval">): string {
  return `${counts.pendingApproval.toLocaleString("en-IN")} of ${plural(counts.open, "open case", "open cases")} ${counts.pendingApproval === 1 ? "has a recommendation" : "have a recommendation"} waiting for your approval`;
}

/** Open cases per contract. Every open case belongs to exactly one contract, so these sum to the total. */
export function openCasesByContract(repos: Repositories): Map<string, string[]> {
  const byContract = new Map<string, string[]>();
  for (const c of openCases(repos)) byContract.set(c.outcomeContractId, [...(byContract.get(c.outcomeContractId) ?? []), c.id]);
  return byContract;
}

// ---------------------------------------------------------------------------
// Exposure: cases, payments, customers and duplicate charges
// ---------------------------------------------------------------------------

/**
 * Duplicate accounting model: one case per purchase. A second (or later)
 * capture for the same purchase is linked to that case as a related payment;
 * it is not its own case. `amountAtRisk` is the original payment only, and
 * linked charges still captured are reported separately as duplicate charges
 * under review.
 */
export type Exposure = {
  caseCount: number;
  /** Original payments plus linked extra charges. */
  paymentCount: number;
  customerCount: number;
  /** Original payments only. */
  amountAtRisk: number;
  /** Linked extra charges still captured (not yet refunded). */
  duplicateCharges: number;
  duplicateChargeCount: number;
  caseIds: string[];
};

export function exposureOf(repos: Repositories, cases: readonly IntegrityCase[]): Exposure {
  const extra = cases.flatMap((c) => c.relatedPaymentIds.map((id) => repos.payments.get(id))).filter((p) => p?.status === "captured");
  return {
    caseCount: cases.length,
    paymentCount: cases.length + sum(cases.map((c) => c.relatedPaymentIds.length)),
    customerCount: new Set(cases.map((c) => c.customerId)).size,
    amountAtRisk: sum(cases.map((c) => c.amountAtRisk)),
    duplicateCharges: sum(extra.map((p) => p!.amount)),
    duplicateChargeCount: extra.length,
    caseIds: cases.map((c) => c.id),
  };
}

/** "43 cases · 46 payments · 43 customers"; payments shown only when they differ from cases. */
export function exposureCountsLabel(e: Exposure): string {
  return [
    plural(e.caseCount, "case", "cases"),
    ...(e.paymentCount !== e.caseCount ? [plural(e.paymentCount, "payment", "payments")] : []),
    plural(e.customerCount, "customer", "customers"),
  ].join(" · ");
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export type ObservationState = {
  /** Seconds since capture, live; stops at the deadline. */
  delaySeconds: number;
  p50: number;
  p95: number;
  withinNormalRange: boolean;
  deadline?: string;
  deadlinePassed: boolean;
};

/** How long an observed case has waited for its outcome, measured now rather than at detection. */
export function observationState(repos: Repositories, c: IntegrityCase, asOf: string): ObservationState | undefined {
  if (c.status !== "observing" || !c.observation) return undefined;
  const capturedAt = repos.payments.get(c.paymentId)?.capturedAt;
  const until = c.deadline && c.deadline < asOf ? c.deadline : asOf;
  const delaySeconds = capturedAt ? Math.max(c.observation.observedDelaySeconds, secondsBetween(capturedAt, until)) : c.observation.observedDelaySeconds;
  const { p50, p95 } = c.observation.normalRangeSeconds;
  return {
    delaySeconds,
    p50,
    p95,
    withinNormalRange: delaySeconds <= p95,
    ...(c.deadline ? { deadline: c.deadline } : {}),
    deadlinePassed: c.deadline !== undefined && c.deadline <= asOf,
  };
}

/** The earliest future deadline among observed cases, so promotion can run exactly when one passes. */
export function nextObservationDeadline(repos: Repositories, asOf: string): string | undefined {
  return observingCases(repos)
    .map((c) => c.deadline)
    .filter((d): d is string => d !== undefined && d > asOf)
    .sort()[0];
}

// ---------------------------------------------------------------------------
// Resolved cases, trailing 30 days
// ---------------------------------------------------------------------------

const DEFAULT_COUNTED = new Set(["auto_refund", "customer_contact"]);

export type ResolvedMetrics = {
  windowDays: 30;
  /** Resolved with a verified outcome in the window, excluding actions later reversed. */
  verified: string[];
  /** Verified by an executed recovery action. */
  verifiedByAction: string[];
  /** Verified because the outcome arrived without an action. */
  verifiedOnArrival: string[];
  /** Verified cases whose default was a refund or a contact, and whose payment was not refunded. */
  valueCounted: string[];
  /** Value-counted cases where the learner contacted the merchant first. */
  afterCustomerContact: string[];
  /** Value-counted cases resolved before the learner contacted the merchant. */
  beforeContact: string[];
  /** Before contact, where the default was a customer contact: one avoided contact each. */
  contactsAvoided: string[];
  /** Before contact, where the default was Razorpay's automatic refund. */
  refundsPrevented: string[];
  /** Recovery actions executed in the window (automatic or approved), by case. */
  executedActions: string[];
  /** Executed actions later proved wrong. */
  reversedActions: string[];
};

/**
 * Every "resolved" figure on Overview, Agent details and Automations, from one
 * set of records and one window. The sets nest, so they always reconcile:
 * beforeContact = contactsAvoided + refundsPrevented,
 * valueCounted = beforeContact + afterCustomerContact,
 * executedActions = verifiedByAction + reversedActions.
 */
export function resolvedMetrics(repos: Repositories, asOf: string): ResolvedMetrics {
  const since = new Date(Date.parse(asOf) - 30 * MS_PER_DAY).toISOString();
  const inWindow = repos.cases
    .list()
    .filter((c) => c.status === "resolved" && c.resolution !== undefined && c.resolution.method !== "manual" && c.resolution.resolvedAt >= since && c.resolution.resolvedAt <= asOf);
  const verifiedCases = inWindow.filter((c) => c.wrongAction === undefined);
  const counted = verifiedCases.filter((c) => DEFAULT_COUNTED.has(c.defaultOutcome) && repos.payments.get(c.paymentId)?.status !== "refunded");
  const before = counted.filter((c) => c.customerContact !== "customer_initiated");
  const executed = repos.executions.list().filter((e) => e.status === "resolved" && e.finishedAt && e.finishedAt >= since && e.finishedAt <= asOf);
  const ids = (cases: readonly IntegrityCase[]) => cases.map((c) => c.id);
  return {
    windowDays: 30,
    verified: ids(verifiedCases),
    verifiedByAction: ids(verifiedCases.filter((c) => c.resolution!.method !== "outcome_arrived")),
    verifiedOnArrival: ids(verifiedCases.filter((c) => c.resolution!.method === "outcome_arrived")),
    valueCounted: ids(counted),
    afterCustomerContact: ids(counted.filter((c) => c.customerContact === "customer_initiated")),
    beforeContact: ids(before),
    contactsAvoided: ids(before.filter((c) => c.defaultOutcome === "customer_contact")),
    refundsPrevented: ids(before.filter((c) => c.defaultOutcome === "auto_refund")),
    executedActions: executed.map((e) => e.caseId),
    reversedActions: executed.filter((e) => repos.cases.get(e.caseId)?.wrongAction !== undefined).map((e) => e.caseId),
  };
}

// Confidence thresholds live with policy, which applies them; re-exported so screens read one module.
export { confidenceThreshold, thresholdLabel, type ConfidenceThreshold } from "@/services/policy/thresholds";

// ---------------------------------------------------------------------------
// Products and contracts
// ---------------------------------------------------------------------------

/** For each product, the active contract that covers it. A product may belong to at most one active contract. */
export function productClaims(repos: Repositories, exceptContractId?: string): Map<string, { contractId: string; contractName: string }> {
  const claims = new Map<string, { contractId: string; contractName: string }>();
  for (const c of repos.config.contracts()) {
    if (c.status !== "active" || c.id === exceptContractId) continue;
    for (const p of c.productScope) if (!claims.has(p)) claims.set(p, { contractId: c.id, contractName: c.name });
  }
  return claims;
}

/** Products listed by more than one active contract. Empty when the configuration is valid. */
export function productOverlaps(repos: Repositories): Array<{ productId: string; contractIds: string[] }> {
  const owners = new Map<string, string[]>();
  for (const c of repos.config.contracts().filter((x) => x.status === "active")) {
    for (const p of c.productScope) owners.set(p, [...(owners.get(p) ?? []), c.id]);
  }
  return [...owners.entries()].filter(([, ids]) => ids.length > 1).map(([productId, contractIds]) => ({ productId, contractIds }));
}

// ---------------------------------------------------------------------------
// Shared summary lines
// ---------------------------------------------------------------------------

/** "₹1,82,457 at risk + ₹10,497 in 3 duplicate charges under review". */
export function atRiskLabel(e: Exposure): string {
  const amount = `${formatINR(e.amountAtRisk)} at risk`;
  return e.duplicateCharges > 0
    ? `${amount} + ${formatINR(e.duplicateCharges)} in ${plural(e.duplicateChargeCount, "duplicate charge", "duplicate charges")} under review`
    : amount;
}

/** One line used wherever open cases are totalled, so Overview, Cases and Contracts read the same. */
export function openCasesSummary(repos: Repositories, asOf: string): string {
  const exposure = exposureOf(repos, openCases(repos));
  const counts = caseCounts(repos, asOf);
  return [
    `Open: ${exposureCountsLabel(exposure)}`,
    atRiskLabel(exposure),
    `${counts.pendingApproval.toLocaleString("en-IN")} awaiting your approval`,
    ...(counts.observing > 0 ? [`${counts.observing.toLocaleString("en-IN")} observed, not yet at risk`] : []),
  ].join(" · ");
}
