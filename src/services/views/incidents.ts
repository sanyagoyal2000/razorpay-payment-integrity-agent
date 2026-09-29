import type { IncidentRecord, IncidentStatus, Severity } from "@/domain/types";
import { formatINR, sum } from "@/domain/money";
import { istDate } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { containmentOptions, engineeringIncident, monitoringProgress, notificationPreview } from "@/services/containment";
import { incidentTotals } from "@/services/metrics/cases";
import { actionLabel, serviceLabel } from "@/services/policy/actions";
import { requireContract, serviceHealth } from "@/services/policy/currentState";
import { groupIncidentCases, planBulkRecovery, type RecoveryGroupId } from "@/services/recovery/groups";
import { describeIncidentInvestigation } from "@/services/agent";
import { suggestedQuestions } from "@/services/agent/askSuggestions";
import { incidentLifecycle } from "@/services/lifecycle";
import { agentContribution } from "./agentContribution";
import { contextAndAuthority } from "./agentProfile";
import { decisionSummary, evidenceCounts, recommendationReasons, recoveryAuthority, recoveryConfidence } from "./incidentDecision";
import { groupEvidence } from "./evidence";
import { investigationView } from "./investigation";
import { requiredDecision } from "./overview";

export type IncidentRow = {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  startedAt: string;
  caseCount: number;
  customers: number;
  revenueAtRisk: number;
  initialAmountAtRisk: number;
  likelyCause: string;
  owner: string;
  contractId: string;
  contractName: string;
};

export function incidentRows(repos: Repositories): IncidentRow[] {
  const cases = repos.cases.list();
  return repos.incidents
    .list()
    .map((incident) => {
      const totals = incidentTotals(incident, cases);
      return {
        id: incident.id,
        title: incident.title,
        status: incident.status,
        severity: incident.severity,
        startedAt: incident.startedAt,
        caseCount: totals.caseCount,
        customers: totals.affectedCustomers,
        revenueAtRisk: totals.remainingAtRisk,
        initialAmountAtRisk: totals.initialAmountAtRisk,
        likelyCause: incident.likelyCause ?? "Under investigation",
        owner: incident.owner,
        contractId: incident.outcomeContractId,
        contractName: repos.config.contract(incident.outcomeContractId)?.name ?? incident.outcomeContractId,
      };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export type AmountBand = "any" | "none" | "under_10k" | "10k_1l" | "over_1l";

export const AMOUNT_BANDS: Array<{ value: AmountBand; label: string }> = [
  { value: "any", label: "Any amount" },
  { value: "none", label: "Nothing at risk" },
  { value: "under_10k", label: "Under ₹10,000" },
  { value: "10k_1l", label: "₹10,000 to ₹1,00,000" },
  { value: "over_1l", label: "Over ₹1,00,000" },
];

export type IncidentFilters = {
  state: "all" | "open" | "resolved";
  severities: Severity[];
  contractIds: string[];
  /** IST calendar dates, inclusive. */
  from?: string;
  to?: string;
  amount: AmountBand;
};

export const DEFAULT_INCIDENT_FILTERS: IncidentFilters = { state: "all", severities: [], contractIds: [], amount: "any" };

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

export function filterIncidents(rows: readonly IncidentRow[], filters: IncidentFilters): IncidentRow[] {
  return rows.filter((row) => {
    if (filters.state === "open" && row.status === "resolved") return false;
    if (filters.state === "resolved" && row.status !== "resolved") return false;
    if (filters.severities.length > 0 && !filters.severities.includes(row.severity)) return false;
    if (filters.contractIds.length > 0 && !filters.contractIds.includes(row.contractId)) return false;
    const started = istDate(row.startedAt);
    if (filters.from && started < filters.from) return false;
    if (filters.to && started > filters.to) return false;
    return inBand(row.revenueAtRisk, filters.amount);
  });
}

/** Human-readable list of active filters, for the empty state. */
export function describeIncidentFilters(filters: IncidentFilters, contractName: (id: string) => string): string[] {
  const parts: string[] = [];
  if (filters.state !== "all") parts.push(filters.state === "open" ? "Open incidents" : "Resolved incidents");
  if (filters.severities.length > 0) parts.push(`Severity: ${filters.severities.join(", ")}`);
  if (filters.contractIds.length > 0) parts.push(`Contract: ${filters.contractIds.map(contractName).join(", ")}`);
  if (filters.from || filters.to) parts.push(`Started ${filters.from ?? "any time"} to ${filters.to ?? "today"}`);
  if (filters.amount !== "any") parts.push(AMOUNT_BANDS.find((b) => b.value === filters.amount)!.label);
  return parts;
}

export type HistoryEntry = {
  id: string;
  occurredAt: string;
  change: string;
  caseCount?: number;
  exposure?: number;
  rootCauseConfidence?: number;
  systemHealth?: string;
  actor?: string;
};

const HISTORY_ACTIONS = new Set([
  "Created incident",
  "Changed incident status",
  "Resolved incident",
  "Created engineering incident",
]);

/**
 * Incident history: case count, exposure, confidence and health snapshots,
 * plus merchant decisions and bulk recoveries from the audit log.
 */
export function incidentHistory(repos: Repositories, incident: IncidentRecord): HistoryEntry[] {
  const snapshots: HistoryEntry[] = repos.incidents.updates(incident.id).map((u) => ({
    id: u.id,
    occurredAt: u.occurredAt,
    change: u.note,
    caseCount: u.caseCount,
    exposure: u.exposure,
    ...(u.rootCauseConfidence !== undefined ? { rootCauseConfidence: u.rootCauseConfidence } : {}),
    systemHealth: u.systemHealth,
  }));
  const audit = repos.audit.forIncident(incident.id);
  const decisions: HistoryEntry[] = audit
    .filter((e) => e.targetType === "incident" && !HISTORY_ACTIONS.has(e.action) && e.actor !== "Payment Integrity Agent")
    .map((e) => ({ id: e.id, occurredAt: e.occurredAt, change: `${e.action}. ${e.result}`, actor: e.actor }));

  // Bulk approvals are recorded per case; show one line per approval batch.
  const approvals = audit.filter((e) => e.action === "Approved recovery (bulk)").sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const batches: Array<typeof approvals> = [];
  for (const e of approvals) {
    const current = batches.at(-1);
    const last = current?.at(-1);
    if (current && last && Date.parse(e.occurredAt) - Date.parse(last.occurredAt) < 5000) current.push(e);
    else batches.push([e]);
  }
  for (const events of batches) {
    const occurredAt = events[0]!.occurredAt;
    const amount = sum(events.map((e) => repos.cases.get(e.caseId!)?.amountAtRisk ?? 0));
    decisions.push({
      id: events[0]!.id,
      occurredAt,
      change: `Approved ${events[0]!.result.toLowerCase()} for ${events.length} cases (${formatINR(amount)})`,
      actor: events[0]!.actor,
    });
  }
  const verified = audit.filter((e) => e.action === "Verified outcome");
  if (verified.length > 0) {
    const last = verified.at(-1)!;
    decisions.push({
      id: `${last.id}-summary`,
      occurredAt: last.occurredAt,
      change: `${verified.length} customer ${verified.length === 1 ? "outcome" : "outcomes"} verified to date`,
    });
  }
  return [...snapshots, ...decisions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export type RecoveryPlan = {
  selectedGroups: RecoveryGroupId[];
  customers: number;
  revenueAddressed: number;
  eligibleCaseIds: string[];
  actions: string;
  excluded: Array<{ caseId: string; reason: string }>;
  communication: string;
  verification: string;
  escalation: string;
};

/** Impact preview for the selected recovery groups. Only bulk-eligible cases are executed. */
export function recoveryPlan(repos: Repositories, incident: IncidentRecord, selected: readonly RecoveryGroupId[], asOf: string): RecoveryPlan {
  const groups = groupIncidentCases(repos, incident.id, asOf).filter((g) => selected.includes(g.id));
  const caseIds = groups.flatMap((g) => g.caseIds);
  const plan = planBulkRecovery(repos, caseIds, asOf);
  const contract = requireContract(repos, incident.outcomeContractId);
  const notifyMode = repos.config.actionModes().notify_customer;
  const notified = plan.eligible.filter((c) => c.customerContact === "notified").length;
  return {
    selectedGroups: groups.map((g) => g.id),
    customers: new Set(plan.eligible.map((c) => c.customerId)).size,
    revenueAddressed: plan.value,
    eligibleCaseIds: plan.eligible.map((c) => c.id),
    actions:
      plan.eligible.length === 0
        ? "No actions. None of the selected cases can be recovered in bulk."
        : `${plan.eligible.length} × ${actionLabel(plan.action, contract)} through ${contract.fulfilmentService === "enrolment-service" ? "the LearnLoop Enrolment API" : `LearnLoop's ${serviceLabel(contract.fulfilmentService).toLowerCase()}`}, one idempotent request per payment`,
    excluded: plan.excluded,
    communication:
      notifyMode === "automatic_below_threshold" && !repos.config.globalControls().requireApprovalForCustomerCommunication
        ? "Customers are notified automatically once access is confirmed."
        : `No message is sent as part of this recovery. Customer messages need separate approval${notified > 0 ? `; ${notified} of these customers were already notified` : ""}.`,
    verification: `Each case resolves only when ${contract.expectedOutcome} is received for its merchant order (${contract.verificationMethod}).`,
    escalation: `If ${contract.expectedOutcome} does not arrive within ${contract.deadlineSeconds / 60} minutes of the request, the case is escalated to you. Payments are never changed, and nothing is retried automatically.`,
  };
}

// ---------------------------------------------------------------------------
// Compact recovery plan
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const AUTOMATION_EVIDENCE_HREF = "/payment-integrity/automations#earned-autonomy";

export type RecoveryFacts = { facts: string[]; ifItFails: string[]; learning: string };

/** The four facts that matter before approving, with failure behaviour kept one click away. */
export function recoveryFacts(repos: Repositories, incident: IncidentRecord, selected: readonly RecoveryGroupId[], asOf: string): RecoveryFacts {
  const contract = requireContract(repos, incident.outcomeContractId);
  const plan = recoveryPlan(repos, incident, selected, asOf);
  const label = actionLabel(contract.safeRecoveryAction, contract);
  const notifies = !/No message is sent/.test(plan.communication);
  const deadline = contract.deadlineSeconds >= 60 ? plural(Math.round(contract.deadlineSeconds / 60), "minute", "minutes") : plural(contract.deadlineSeconds, "second", "seconds");
  return {
    facts: [
      `${plural(plan.customers, "customer", "customers")} · ${formatINR(plan.revenueAddressed)}`,
      `${label} once for each payment`,
      notifies ? "Customers are notified automatically once the outcome is confirmed" : "No customer message will be sent",
      `Success requires ${contract.expectedOutcome}`,
    ],
    ifItFails: [
      `Wait up to ${deadline} (the Outcome Contract verification window) for ${contract.expectedOutcome}.`,
      "Escalate the case to you if the Outcome Receipt does not arrive.",
      "Never retry indefinitely: each payment gets one request.",
      "Never change the payment.",
      "Idempotency keys prevent a second request for the same payment.",
    ],
    learning: `Verified outcomes from this recovery will update ${label.toLowerCase()} automation eligibility.`,
  };
}

export function incidentWorkspace(repos: Repositories, incidentId: string, asOf: string) {
  const incident = repos.incidents.get(incidentId);
  if (!incident) return undefined;
  const totals = incidentTotals(incident, repos.cases.list());
  const health = serviceHealth(repos, incident.affectedService, asOf);
  const healthEvent = repos.outcomes
    .observability(incident.affectedService)
    .filter((e) => e.type !== "deploy.completed" && e.occurredAt <= asOf)
    .at(-1);
  const contract = requireContract(repos, incident.outcomeContractId);
  const evidenceIds = incident.investigation?.evidenceIds ?? [];
  return {
    incident,
    contract,
    totals,
    systemHealth: {
      status: health,
      label: `${serviceLabel(incident.affectedService)} ${health === "healthy" ? "healthy" : "failing"}`,
      since: healthEvent?.occurredAt,
    },
    requiredDecision: requiredDecision(repos, incident, asOf),
    whatHappened: incident.summary,
    likelyCause: incident.likelyCause,
    rootCauseConfidence: incident.investigation?.confidence,
    evidence: groupEvidence(repos, evidenceIds),
    investigation: investigationView(repos, incident.investigation, describeIncidentInvestigation(repos, incident.id, asOf), "incident"),
    uncertainties: incident.investigation?.uncertainties ?? [],
    contribution: agentContribution(repos, incident, asOf),
    lifecycle: incidentLifecycle(repos, incident, asOf),
    authority: contextAndAuthority(repos, contract),
    askSuggestions: suggestedQuestions(repos, incident.id, asOf),
    decision: decisionSummary(repos, incident, asOf, new Date(asOf)),
    reasons: recommendationReasons(repos, incident, asOf),
    recoveryAuthority: recoveryAuthority(repos, incident, asOf),
    confidence: recoveryConfidence(repos, incident, asOf),
    evidenceCounts: evidenceCounts(repos, incident, asOf, groupEvidence(repos, evidenceIds)),
    groups: groupIncidentCases(repos, incident.id, asOf),
    containment: containmentOptions(repos, incident, asOf),
    notification: notificationPreview(repos, incident),
    monitoring: monitoringProgress(repos, incident, asOf, repos.scheduled.horizon()),
    engineering: engineeringIncident(incident),
    accessPending: (incident.containment ?? []).some((d) => d.action === "access_pending"),
    reviewRequired: (incident.containment ?? []).some((d) => d.action === "require_review"),
    history: incidentHistory(repos, incident),
  };
}

export type IncidentWorkspaceModel = NonNullable<ReturnType<typeof incidentWorkspace>>;
