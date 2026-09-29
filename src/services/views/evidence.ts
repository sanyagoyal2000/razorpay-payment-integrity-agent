import { formatINR } from "@/domain/money";
import { formatIstShort } from "@/domain/time";
import type { Repositories } from "@/repositories";

export type EvidenceKind =
  | "deploy"
  | "service_errors"
  | "payment_captured"
  | "payment_event"
  | "webhook_accepted"
  | "webhook_failed"
  | "outcome_failed"
  | "outcome_completed"
  | "outcome_event"
  | "receipt_missing"
  | "receipt_confirmed"
  | "service_recovered"
  | "similar_case";

export type EvidenceSource = "Razorpay" | "LearnLoop" | "LearnLoop Observability" | "Payment Integrity";

export type EvidenceItem = {
  id: string;
  kind: EvidenceKind;
  source: EvidenceSource;
  title: string;
  detail: string;
  occurredAt: string;
};

/**
 * What each kind of evidence does for a decision. Groups holding cause or
 * recovery evidence open by default; baseline, context, repetitive symptom
 * and pattern evidence stays one click away.
 */
export type EvidenceRole = "cause" | "recovery" | "baseline" | "context" | "symptom" | "pattern";

export const KIND_ROLES: Record<EvidenceKind, EvidenceRole> = {
  deploy: "context",
  service_errors: "cause",
  payment_captured: "baseline",
  payment_event: "baseline",
  webhook_accepted: "baseline",
  webhook_failed: "cause",
  outcome_failed: "cause",
  outcome_completed: "recovery",
  outcome_event: "context",
  receipt_missing: "symptom",
  receipt_confirmed: "context",
  service_recovered: "recovery",
  similar_case: "pattern",
};

export const EVIDENCE_GROUPS: Array<{ label: string; kinds: EvidenceKind[] }> = [
  { label: "Deployment", kinds: ["deploy"] },
  { label: "Service errors", kinds: ["service_errors"] },
  { label: "Payment captures", kinds: ["payment_captured", "payment_event"] },
  { label: "Webhook deliveries", kinds: ["webhook_accepted", "webhook_failed"] },
  { label: "Fulfilment failures", kinds: ["outcome_failed"] },
  { label: "Missing Outcome Receipts", kinds: ["receipt_missing"] },
  { label: "Service recovery", kinds: ["service_recovered"] },
  { label: "Successful post-recovery outcomes", kinds: ["outcome_completed"] },
  { label: "Similar case sequences", kinds: ["similar_case"] },
  { label: "Other merchant events", kinds: ["outcome_event", "receipt_confirmed"] },
];

/**
 * Resolves an evidence ID to the record it names. Returns undefined for IDs
 * that do not exist, so nothing unsupported is ever displayed.
 */
export function resolveEvidence(repos: Repositories, id: string): EvidenceItem | undefined {
  const paymentEvent = repos.payments.event(id);
  if (paymentEvent) {
    const payment = repos.payments.get(paymentEvent.paymentId);
    return {
      id,
      kind: paymentEvent.type === "payment.captured" ? "payment_captured" : "payment_event",
      source: "Razorpay",
      title: paymentEvent.type,
      detail: `${paymentEvent.paymentId}${payment ? ` · ${formatINR(payment.amount)}` : ""}`,
      occurredAt: paymentEvent.occurredAt,
    };
  }
  const delivery = repos.payments.delivery(id);
  if (delivery) {
    const ok = delivery.status === "delivered";
    return {
      id,
      kind: ok ? "webhook_accepted" : "webhook_failed",
      source: "Razorpay",
      title: ok ? `order.paid webhook returned HTTP ${delivery.responseCode}` : `order.paid webhook failed (HTTP ${delivery.responseCode ?? "timeout"})`,
      detail: `Attempt ${delivery.attempt}${delivery.latencyMs !== undefined ? ` · ${delivery.latencyMs} ms` : ""}`,
      occurredAt: delivery.occurredAt,
    };
  }
  const receipt = repos.outcomes.receipt(id);
  if (receipt) {
    // Evidence keeps what it showed at the time: a receipt confirmed after its
    // deadline was still missing when the case was opened.
    const missedDeadline = receipt.status === "missing" || (receipt.confirmedAt !== undefined && receipt.confirmedAt > receipt.expectedBy);
    return {
      id,
      kind: missedDeadline ? "receipt_missing" : "receipt_confirmed",
      source: "Payment Integrity",
      title: missedDeadline ? "Outcome Receipt missing at deadline" : "Outcome Receipt confirmed",
      detail: `${receipt.merchantOrderId} · ${receipt.paymentId}${missedDeadline && receipt.confirmedAt ? ` · confirmed later, ${formatIstShort(receipt.confirmedAt)}` : ""}`,
      occurredAt: missedDeadline ? receipt.expectedBy : receipt.confirmedAt ?? receipt.expectedBy,
    };
  }
  const observability = repos.outcomes.observability().find((e) => e.id === id);
  if (observability) {
    const meta = observability.metadata ?? {};
    const kind: EvidenceKind =
      observability.type === "deploy.completed" ? "deploy" : observability.type === "service.recovered" ? "service_recovered" : "service_errors";
    const title =
      kind === "deploy"
        ? `deploy.completed ${String(meta["version"] ?? "")} · ${observability.service}`
        : kind === "service_recovered"
          ? `${observability.service} recovered`
          : `${observability.service} errors detected`;
    const detail = [meta["endpoint"], meta["statusCode"] ? `HTTP ${String(meta["statusCode"])}` : undefined, meta["message"] ?? meta["signal"] ?? meta["healthCheck"]]
      .filter(Boolean)
      .map(String)
      .join(" · ");
    return { id, kind, source: "LearnLoop Observability", title, detail, occurredAt: observability.occurredAt };
  }
  const caseData = repos.cases.get(id);
  if (caseData) {
    return {
      id,
      kind: "similar_case",
      source: "Payment Integrity",
      title: `Case ${caseData.id}`,
      detail: `${caseData.paymentId} · ${formatINR(caseData.amountAtRisk)}`,
      occurredAt: caseData.detectedAt,
    };
  }
  const event = repos.outcomes.event(id);
  if (event) {
    const kind: EvidenceKind = event.status === "failed" ? "outcome_failed" : event.status === "completed" && event.type !== "inventory_changed" ? "outcome_completed" : "outcome_event";
    return {
      id,
      kind,
      source: "LearnLoop",
      title: event.responseCode ? `${event.type} (HTTP ${event.responseCode})` : event.type,
      detail: event.merchantOrderId,
      occurredAt: event.occurredAt,
    };
  }
  return undefined;
}

export type EvidenceGroup = { key: string; label: string; items: EvidenceItem[]; defaultExpanded: boolean };

/**
 * Resolves and groups evidence IDs for display. Unknown IDs are dropped.
 * A group opens by default when it holds cause or recovery evidence, unless
 * every one of its cause items is cited only by causes the investigation
 * ruled out. Collapsing hides items; it never removes them.
 */
export function groupEvidence(
  repos: Repositories,
  ids: readonly string[],
  hypotheses: ReadonlyArray<{ verdict: "supported" | "ruled_out" | "inconclusive"; evidenceIds: string[] }> = [],
): EvidenceGroup[] {
  const items = [...new Set(ids)].map((id) => resolveEvidence(repos, id)).filter((item): item is EvidenceItem => item !== undefined);
  const citedByLive = new Set(hypotheses.filter((h) => h.verdict !== "ruled_out").flatMap((h) => h.evidenceIds));
  const citedByRuledOut = new Set(hypotheses.filter((h) => h.verdict === "ruled_out").flatMap((h) => h.evidenceIds));
  const onlyRuledOut = (item: EvidenceItem) => citedByRuledOut.has(item.id) && !citedByLive.has(item.id);
  return EVIDENCE_GROUPS.map((group) => {
    const own = items.filter((i) => group.kinds.includes(i.kind)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const recovery = own.some((i) => KIND_ROLES[i.kind] === "recovery");
    const cause = own.filter((i) => KIND_ROLES[i.kind] === "cause");
    const liveCause = cause.length > 0 && !cause.every(onlyRuledOut);
    return { key: group.kinds.join("+"), label: group.label, items: own, defaultExpanded: recovery || liveCause };
  }).filter((g) => g.items.length > 0);
}

/** Disclosure state for evidence groups: a map from group key to expanded. */
export type EvidenceExpansion = Record<string, boolean>;

export const initialExpansion = (groups: readonly EvidenceGroup[]): EvidenceExpansion => Object.fromEntries(groups.map((g) => [g.key, g.defaultExpanded]));
export const expandAll = (groups: readonly EvidenceGroup[]): EvidenceExpansion => Object.fromEntries(groups.map((g) => [g.key, true]));
export const collapseAll = (groups: readonly EvidenceGroup[]): EvidenceExpansion => Object.fromEntries(groups.map((g) => [g.key, false]));
export const setGroupExpanded = (state: EvidenceExpansion, key: string, expanded: boolean): EvidenceExpansion => ({ ...state, [key]: expanded });
