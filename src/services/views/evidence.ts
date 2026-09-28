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

export const EVIDENCE_GROUPS: Array<{ label: string; kinds: EvidenceKind[] }> = [
  { label: "Deployment", kinds: ["deploy"] },
  { label: "Service errors", kinds: ["service_errors"] },
  { label: "Payment capture events", kinds: ["payment_captured", "payment_event"] },
  { label: "Successful webhook responses", kinds: ["webhook_accepted"] },
  { label: "Failed webhook deliveries", kinds: ["webhook_failed"] },
  { label: "Failed fulfilment calls", kinds: ["outcome_failed"] },
  { label: "Missing Outcome Receipts", kinds: ["receipt_missing"] },
  { label: "Endpoint recovery", kinds: ["service_recovered", "outcome_completed"] },
  { label: "Similar case sequences", kinds: ["similar_case"] },
  { label: "Other merchant events", kinds: ["outcome_event", "receipt_confirmed"] },
];

/**
 * Resolves an evidence ID to the record it names. Returns undefined for IDs
 * that do not exist, so nothing unsupported is ever displayed.
 */
export function resolveEvidence(repos: Repositories, id: string): EvidenceItem | undefined {
  const paymentEvent = repos.payments.list().flatMap((p) => repos.payments.events(p.id)).find((e) => e.id === id);
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
  const delivery = repos.payments
    .list()
    .flatMap((p) => repos.payments.deliveriesForPayment(p.id))
    .find((d) => d.id === id);
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
  for (const order of repos.payments.list()) {
    const event = repos.outcomes.events(order.merchantOrderId).find((e) => e.id === id);
    if (!event) continue;
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

/** Resolves and groups evidence IDs for display. Unknown IDs are dropped. */
export function groupEvidence(repos: Repositories, ids: readonly string[]) {
  const items = [...new Set(ids)].map((id) => resolveEvidence(repos, id)).filter((item): item is EvidenceItem => item !== undefined);
  return EVIDENCE_GROUPS.map((group) => ({
    label: group.label,
    items: items.filter((i) => group.kinds.includes(i.kind)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  })).filter((g) => g.items.length > 0);
}
