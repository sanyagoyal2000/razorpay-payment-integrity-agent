import { messageAudience } from "@/services/communication";
import type { ContainmentAction, ContainmentDecision, IncidentRecord } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { checkCustomerMessage } from "@/services/agent";
import { refreshIncident } from "@/services/incidents";
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
    label: "Show affected purchases as access pending",
    description: "Customers who check an affected payment see that access is being restored, instead of that it is under review.",
  },
  require_review: {
    label: "Require individual review for this incident",
    description: "Every open case in this incident needs its own approval, even where policy would allow bulk approval.",
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
  const uncontacted = openCases.filter((c) => c.customerContact === "none");
  const { optedOut } = messageAudience(repos, uncontacted.map((c) => c.customerId));
  const notifiable = uncontacted.filter((c) => !optedOut.includes(c.customerId));
  return (Object.keys(LABELS) as ContainmentAction[]).map((action) => {
    const option: ContainmentOption = { action, ...LABELS[action] };
    const decision = recorded.get(action);
    if (decision) option.decision = decision;
    if (incident.status === "resolved") option.unavailableReason = "The incident is resolved.";
    else if (action === "notify_customers") {
      const blocked = notifyBlockedReason(repos, notifiable[0], asOf);
      if (notifiable.length === 0)
        option.unavailableReason =
          optedOut.length > 0
            ? `Every reachable customer has been contacted; ${optedOut.length} opted out of email.`
            : "Every affected customer has already been contacted.";
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
  const { optedOut } = messageAudience(repos, recipients.map((c) => c.customerId));
  const sendable = recipients.filter((c) => !optedOut.includes(c.customerId));
  return {
    template: contract.customerNotificationTemplate,
    recipientCaseIds: sendable.map((c) => c.id),
    optedOutCaseIds: recipients.filter((c) => optedOut.includes(c.customerId)).map((c) => c.id),
  };
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
  message?: string,
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
  let reference: string | undefined;
  switch (action) {
    case "notify_customers": {
      const text = message?.trim();
      if (text) {
        const flagged = checkCustomerMessage(text);
        if (flagged.length > 0) throw new Error(`Remove ${flagged.join(", ")} from the message before sending.`);
      }
      const { recipientCaseIds, optedOutCaseIds } = notificationPreview(repos, incident);
      for (const id of recipientCaseIds) {
        const c = repos.cases.get(id)!;
        repos.cases.save({ ...c, customerContact: "notified", updatedAt: asOf });
      }
      caseIds = recipientCaseIds;
      const excluded = optedOutCaseIds.length > 0 ? ` ${optedOutCaseIds.length} opted out of email and ${optedOutCaseIds.length === 1 ? "was" : "were"} not contacted.` : "";
      detail = text ? `Notification sent to ${recipientCaseIds.length} customers by email: “${text}”${excluded}` : `Notification sent to ${recipientCaseIds.length} customers by email.${excluded}`;
      break;
    }
    case "access_pending":
      detail = `${totals.customersAtRisk} affected customers now see that their access is being restored.`;
      break;
    case "require_review":
      detail = `${totals.openCaseIds.length} open cases now need individual approval; bulk recovery is off for this incident.`;
      break;
    case "engineering_incident":
      reference = `${incident.id}-ENG`;
      detail = `Engineering incident ${reference} opened in #payments-ops for ${incident.affectedService} with ${totals.caseCount} cases and ${formatINR(totals.remainingAtRisk)} at risk.`;
      break;
    case "monitor_next_purchases":
      detail = `Monitoring the next ${MONITORED_PURCHASES} ${contract.name} purchases.`;
      break;
  }
  const decision: ContainmentDecision = { action, decidedAt: asOf, actor, detail, caseIds, ...(reference ? { reference } : {}) };
  repos.incidents.save({ ...incident, containment: [...(incident.containment ?? []), decision] });
  if (action === "require_review") refreshIncident(repos, incidentId, asOf);
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
      result: `Posted ${reference} to #payments-ops`,
      approvalSource: "merchant",
    });
  }
  return decision;
}

/**
 * Progress of "monitor the next 50": purchases under the incident's contract
 * captured after the decision and visible by `asOf`, and how many of them
 * have a confirmed outcome.
 */
export function monitoringProgress(repos: Repositories, incident: IncidentRecord, asOf: string, horizon: string) {
  const decision = incident.containment?.find((d) => d.action === "monitor_next_purchases");
  if (!decision) return undefined;
  const start = Date.parse(decision.decidedAt);
  const now = Date.parse(asOf);
  const base = Date.parse(horizon);
  const observed = repos.scheduled
    .forContract(incident.outcomeContractId)
    .map((p) => ({ capturedAt: base + p.offsetSeconds * 1000, confirmedAt: base + (p.offsetSeconds + p.completionSeconds) * 1000 }))
    .filter((p) => p.capturedAt > start && p.capturedAt <= now)
    .slice(0, MONITORED_PURCHASES);
  const confirmed = observed.filter((p) => p.confirmedAt <= now).length;
  return { target: MONITORED_PURCHASES, observed: observed.length, confirmed, complete: observed.length === MONITORED_PURCHASES && confirmed === observed.length };
}

/** Status of the engineering incident opened from this incident, if one was. */
export function engineeringIncident(incident: IncidentRecord) {
  const decision = incident.containment?.find((d) => d.action === "engineering_incident");
  if (!decision?.reference) return undefined;
  return { reference: decision.reference, openedAt: decision.decidedAt, status: incident.status === "resolved" ? "Closed with the incident" : "Open" };
}
