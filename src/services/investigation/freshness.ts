import type { IntegrityCase, InvestigationRun } from "@/domain/types";
import type { Repositories } from "@/repositories";
import { serviceLabel } from "@/services/policy/actions";
import { serviceHealth } from "@/services/policy/currentState";

/** Whether the inputs an investigation relied on have changed since it ran. */
export type InvestigationFreshness = {
  /** When the investigation ran. */
  ranAt: string;
  stale: boolean;
  /** The first change after the run. */
  changedAt?: string;
  /** What changed, in merchant language. */
  changes: string[];
};

function freshness(ranAt: string, changes: Array<{ at: string; text: string }>): InvestigationFreshness {
  const sorted = [...changes].sort((a, b) => a.at.localeCompare(b.at));
  return { ranAt, stale: sorted.length > 0, ...(sorted[0] ? { changedAt: sorted[0].at } : {}), changes: sorted.map((c) => c.text) };
}

/** Service health changes after `ranAt` that leave the service in a different state than the run recorded. */
function healthChanges(repos: Repositories, service: string, ranAt: string, run: InvestigationRun | undefined, asOf: string) {
  const then = run?.serviceHealth?.service === service ? run.serviceHealth.status : serviceHealth(repos, service, ranAt);
  const now = serviceHealth(repos, service, asOf);
  if (then === now) return [];
  const event = repos.outcomes
    .observability(service)
    .filter((e) => e.type !== "deploy.completed" && e.occurredAt > ranAt && e.occurredAt <= asOf)
    .at(-1);
  return [{ at: event?.occurredAt ?? asOf, text: `${serviceLabel(service)} ${now === "healthy" ? "recovered" : "started failing"} after the investigation ran.` }];
}

/**
 * Checks an open case's investigation against what it depended on: the
 * fulfilment service's health, the payments' state and the merchant's outcome
 * events. Closed cases are never stale; their investigation is history.
 */
export function caseInvestigationFreshness(repos: Repositories, c: IntegrityCase, run: InvestigationRun | undefined, asOf: string): InvestigationFreshness | undefined {
  if (!run) return undefined;
  const open = ["open", "review_required", "escalated", "observing"].includes(c.status);
  if (!open) return { ranAt: run.at, stale: false, changes: [] };
  const contract = repos.config.contract(c.outcomeContractId);
  const changes: Array<{ at: string; text: string }> = contract ? healthChanges(repos, contract.fulfilmentService, run.at, run, asOf) : [];
  for (const paymentId of [c.paymentId, ...c.relatedPaymentIds]) {
    const payment = repos.payments.get(paymentId);
    if (!payment) continue;
    for (const e of repos.payments.events(paymentId)) {
      if (e.occurredAt > run.at && e.occurredAt <= asOf && (e.type === "payment.refunded" || e.type === "payment.captured")) {
        changes.push({ at: e.occurredAt, text: `Payment ${paymentId} was ${e.type === "payment.refunded" ? "refunded" : "captured"}.` });
      }
    }
    for (const e of repos.outcomes.events(payment.merchantOrderId)) {
      if (e.occurredAt > run.at && e.occurredAt <= asOf && e.metadata?.["initiatedBy"] !== "payment_integrity") {
        changes.push({ at: e.occurredAt, text: `Marrow reported ${e.type} (${e.status}) for order ${payment.merchantOrderId}.` });
      }
    }
  }
  return freshness(run.at, changes);
}

/** The same check for an incident investigation: the affected service's health. */
export function incidentInvestigationFreshness(repos: Repositories, incidentId: string, run: InvestigationRun | undefined, asOf: string): InvestigationFreshness | undefined {
  const incident = repos.incidents.get(incidentId);
  if (!incident || !run) return undefined;
  if (incident.status === "resolved") return { ranAt: run.at, stale: false, changes: [] };
  return freshness(run.at, healthChanges(repos, incident.affectedService, run.at, run, asOf));
}
