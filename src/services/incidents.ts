import type { IncidentRecord, IncidentStatus } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { incidentTotals } from "@/services/metrics/cases";
import { serviceHealth } from "@/services/policy/currentState";
import { assessCase } from "@/services/recovery/groups";

/**
 * Incident status follows from its cases and the affected service:
 * - resolved: no case still at risk
 * - investigating: the affected service is still failing
 * - action_required: some open cases can be recovered as a safe group
 * - contained: the service is healthy and only individually reviewed cases remain
 */
export function deriveIncidentStatus(repos: Repositories, incident: IncidentRecord, asOf: string): IncidentStatus {
  const totals = incidentTotals(incident, repos.cases.list());
  if (totals.openCaseIds.length === 0) return "resolved";
  if (serviceHealth(repos, incident.affectedService, asOf) !== "healthy") return "investigating";
  const hasSafeGroup = totals.openCaseIds.some((id) => assessCase(repos, repos.cases.get(id)!, asOf).group === "safe");
  return hasSafeGroup ? "action_required" : "contained";
}

/** Recomputes status; on change, records an incident update and an audit event. */
export function refreshIncident(repos: Repositories, incidentId: string, asOf: string): IncidentRecord {
  const incident = repos.incidents.get(incidentId);
  if (!incident) throw new Error(`Incident ${incidentId} not found`);
  const status = deriveIncidentStatus(repos, incident, asOf);
  if (status === incident.status) return incident;

  const totals = incidentTotals(incident, repos.cases.list());
  const next: IncidentRecord = { ...incident, status };
  if (status === "resolved") next.resolvedAt = asOf;
  repos.incidents.save(next);
  const health = serviceHealth(repos, incident.affectedService, asOf);
  const previousConfidence = repos.incidents.updates(incidentId).at(-1)?.rootCauseConfidence;
  const note = `${totals.resolvedCaseIds.length} of ${totals.caseCount} cases resolved; ${formatINR(totals.remainingAtRisk)} remains at risk.`;
  repos.incidents.appendUpdate({
    id: repos.nextId("inu"),
    incidentId,
    occurredAt: asOf,
    caseCount: totals.caseCount,
    exposure: totals.remainingAtRisk,
    systemHealth: health,
    note,
    ...(previousConfidence !== undefined ? { rootCauseConfidence: previousConfidence } : {}),
  });
  repos.audit.append({
    id: repos.nextId("aud"),
    occurredAt: asOf,
    actor: ACTORS.agent,
    action: "Changed incident status",
    targetType: "incident",
    targetId: incidentId,
    incidentId,
    result: `${statusLabel(incident.status)} → ${statusLabel(status)}. ${note}`,
    evidenceIds: totals.resolvedCaseIds.slice(-5),
    approvalSource: "not_required",
  });
  return next;
}

export function statusLabel(status: IncidentStatus): string {
  return { investigating: "Investigating", action_required: "Action required", contained: "Contained", resolved: "Resolved" }[status];
}
