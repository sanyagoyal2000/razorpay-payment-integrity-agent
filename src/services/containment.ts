import type { ContainmentAction, ContainmentDecision, IncidentRecord } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { incidentTotals } from "@/services/metrics/cases";
import { evaluateCase, requireContract } from "@/services/policy/currentState";

export const MONITORED_PURCHASES = 50;

export type ContainmentOption = {
  action: ContainmentAction;
  label: string;
  description: string;
  /** Why the option cannot be used right now, if it cannot. */
  unavailableReason?: string;
  decision?: ContainmentDecision;
};

const LABELS: Record<ContainmentAction, { label: string; description: string }> = {
  notify_customers: {
    label: "Notify affected customers",
    description: "Send the contract's notification to customers whose outcome is still missing.",
  },
  access_pending: {
    label: "Show new affected purchases as access pending",
    description: "Customers checking a new affected purchase see that access is pending instead of an error.",
  },
  require_review: {
    label: "Require review for new cases",
    description: "New cases in this incident need individual approval, even if policy would allow bulk approval.",
  },
  engineering_incident: {
    label: "Create an engineering incident",
    description: "Open an incident for LearnLoop engineering in Slack with the evidence attached.",
  },
  monitor_next_purchases: {
    label: `Monitor the next ${MONITORED_PURCHASES} matching purchases`,
    description: "Check the outcome of each new purchase under this Outcome Contract until the count is reached.",
  },
};

/** Containment options for an incident, with any decision already recorded. */
export function containmentOptions(repos: Repositories, incident: IncidentRecord, asOf: string): ContainmentOption[] {
  const recorded = new Map((incident.containment ?? []).map((d) => [d.action, d]));
  const openCases = incidentTotals(incident, repos.cases.list()).openCaseIds.map((id) => repos.cases.get(id)!);
  const notifiable = openCases.filter((c) => c.customerContact === "none");
  return (Object.keys(LABELS) as ContainmentAction[]).map((action) => {
    const option: ContainmentOption = { action, ...LABELS[action] };
    const decision = recorded.get(action);
    if (decision) option.decision = decision;
    if (incident.status === "resolved") option.unavailableReason = "The incident is resolved.";
    else if (action === "notify_customers") {
      const blocked = notifyBlockedReason(repos, notifiable[0], asOf);
      if (notifiable.length === 0) option.unavailableReason = "Every affected customer has already been contacted.";
      else if (blocked) option.unavailableReason = blocked;
    } else if (action === "engineering_incident" && repos.config.integration("incident_management")?.status !== "connected") {
      option.unavailableReason = "Slack incident management is not connected.";
    }
    return option;
  });
}

function notifyBlockedReason(repos: Repositories, sample: ReturnType<Repositories["cases"]["get"]>, asOf: string): string | undefined {
  if (!sample?.recommendation) return undefined;
  const verdict = evaluateCase(repos, sample, { ...sample.recommendation, action: "notify_customer" }, asOf);
  if (verdict.result !== "blocked") return undefined;
  const failed = verdict.checks.filter((c) => c.status !== "passed").map((c) => c.explanation);
  return failed.join(" ");
}

/** Customers who would receive the notification, and the message they would get. */
export function notificationPreview(repos: Repositories, incident: IncidentRecord) {
  const contract = requireContract(repos, incident.outcomeContractId);
  const open = incidentTotals(incident, repos.cases.list()).openCaseIds.map((id) => repos.cases.get(id)!);
  const recipients = open.filter((c) => c.customerContact === "none");
  return { template: contract.customerNotificationTemplate, recipientCaseIds: recipients.map((c) => c.id) };
}

/**
 * Records a containment decision. Notifying customers is the only option with
 * an immediate external effect; it marks each recipient as notified. No option
 * pauses payments or disables checkout.
 */
export function applyContainment(
  repos: Repositories,
  incidentId: string,
  action: ContainmentAction,
  actor: string,
  asOf: string,
): ContainmentDecision {
  const incident = repos.incidents.get(incidentId);
  if (!incident) throw new Error(`Incident ${incidentId} not found`);
  const option = containmentOptions(repos, incident, asOf).find((o) => o.action === action)!;
  if (option.decision) throw new Error(`${option.label} was already recorded`);
  if (option.unavailableReason) throw new Error(option.unavailableReason);

  const contract = requireContract(repos, incident.outcomeContractId);
  const totals = incidentTotals(incident, repos.cases.list());
  let caseIds = totals.openCaseIds;
  let detail: string;
  switch (action) {
    case "notify_customers": {
      const { recipientCaseIds } = notificationPreview(repos, incident);
      for (const id of recipientCaseIds) {
        const c = repos.cases.get(id)!;
        repos.cases.save({ ...c, customerContact: "notified", updatedAt: asOf });
      }
      caseIds = recipientCaseIds;
      detail = `Notification sent to ${recipientCaseIds.length} customers.`;
      break;
    }
    case "access_pending":
      detail = `New ${contract.name} purchases affected by this incident will show access as pending.`;
      break;
    case "require_review":
      detail = "New cases in this incident will need individual approval.";
      break;
    case "engineering_incident":
      detail = `Engineering incident opened in Slack for ${incident.affectedService} with ${totals.caseCount} cases and ${formatINR(totals.remainingAtRisk)} at risk.`;
      break;
    case "monitor_next_purchases":
      detail = `Monitoring the next ${MONITORED_PURCHASES} ${contract.name} purchases.`;
      break;
  }
  const decision: ContainmentDecision = { action, decidedAt: asOf, actor, detail, caseIds };
  repos.incidents.save({ ...incident, containment: [...(incident.containment ?? []), decision] });
  repos.audit.append({
    id: repos.nextId("aud"),
    occurredAt: asOf,
    actor,
    action: option.label,
    targetType: "incident",
    targetId: incidentId,
    incidentId,
    result: detail,
    evidenceIds: caseIds,
    approvalSource: "merchant",
    ...(action === "notify_customers" ? { policyResult: "requires_approval" as const } : {}),
  });
  if (action === "engineering_incident") {
    repos.audit.append({
      id: repos.nextId("aud"),
      occurredAt: asOf,
      actor: ACTORS.connector,
      action: "Created engineering incident",
      targetType: "incident",
      targetId: incidentId,
      incidentId,
      result: "Posted to #payments-ops",
      approvalSource: "merchant",
    });
  }
  return decision;
}

/** Purchases observed since monitoring started, for the "next 50" containment decision. */
export function monitoringProgress(repos: Repositories, incident: IncidentRecord, asOf: string) {
  const decision = incident.containment?.find((d) => d.action === "monitor_next_purchases");
  if (!decision) return undefined;
  const contract = requireContract(repos, incident.outcomeContractId);
  const observed = repos.payments
    .list()
    .filter((p) => p.capturedAt && p.capturedAt > decision.decidedAt && p.capturedAt <= asOf)
    .filter((p) => {
      const order = repos.payments.order(p.merchantOrderId);
      return order && repos.payments.product(order.productId)?.contractId === contract.id;
    });
  const confirmed = observed.filter((p) => repos.outcomes.receiptForPayment(p.id)?.status === "confirmed");
  return { target: MONITORED_PURCHASES, observed: observed.length, confirmed: confirmed.length };
}
