import type { IncidentRecord, IntegrityCase, PolicyVerdict } from "@/domain/types";
import { fulfilmentVocabulary } from "@/domain/fulfilment";
import { formatINR } from "@/domain/money";
import { formatRelative } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { describeIncidentInvestigation } from "@/services/agent";
import { healthResult } from "@/services/agent/progress";
import { incidentTotals, isAtRisk } from "@/services/metrics/cases";
import { actionLabel, serviceLabel } from "@/services/policy/actions";
import { evaluateCase, requireContract } from "@/services/policy/currentState";
import { modeLabel } from "@/services/policy/evaluatePolicy";
import { assessCase, groupIncidentCases, planBulkRecovery, type RecoveryGroupId } from "@/services/recovery/groups";
import { contextAndAuthority } from "./agentProfile";
import type { groupEvidence } from "./evidence";
import { systemicBlocker } from "./systemStatus";

// ---------------------------------------------------------------------------
// Local tabs
// ---------------------------------------------------------------------------

export const INCIDENT_TABS = [
  { id: "decision", label: "Decision" },
  { id: "investigation", label: "Investigation" },
  { id: "evidence", label: "Evidence & history" },
] as const;

export type IncidentTab = (typeof INCIDENT_TABS)[number]["id"];

/** The selected tab from the URL's `tab` parameter; Decision when absent or unknown. */
export function parseIncidentTab(value: string | null | undefined): IncidentTab {
  return INCIDENT_TABS.some((t) => t.id === value) ? (value as IncidentTab) : "decision";
}

/** Where each section lives, so links to a section open the right tab. */
export const SECTION_TABS: Record<string, IncidentTab> = {
  recovery: "decision",
  containment: "decision",
  "why-ray": "investigation",
  investigation: "investigation",
  "context-authority": "investigation",
  evidence: "evidence",
  history: "evidence",
};

/**
 * Link to a section of an incident, on the tab that holds it. Decision is the
 * default tab, so it is left out of the URL.
 */
export function incidentSectionHref(incidentId: string, section?: string): string {
  const tab = section ? SECTION_TABS[section] : undefined;
  const query = tab && tab !== "decision" ? `?tab=${tab}` : "";
  return `/payment-integrity/incidents/${incidentId}${query}${section ? `#${section}` : ""}`;
}

// ---------------------------------------------------------------------------
// Decision summary
// ---------------------------------------------------------------------------

/** What customers are missing, per promised outcome. */
const MISSING_OUTCOME: Record<string, string> = {
  course_access_granted: "do not have course access",
  booking_confirmed: "do not have a confirmed booking",
  membership_activated: "do not have an active membership",
  wallet_credited: "have not received their wallet credit",
  plan_upgraded: "have not received their plan upgrade",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function deploymentBeforeErrors(repos: Repositories, incident: IncidentRecord) {
  const events = repos.outcomes.observability(incident.affectedService).filter((e) => e.occurredAt <= incident.detectedAt);
  const errors = events.find((e) => e.type === "service.errors_detected" && e.occurredAt >= incident.startedAt);
  if (!errors) return undefined;
  const deploy = events.filter((e) => e.type === "deploy.completed" && e.occurredAt <= errors.occurredAt && Date.parse(errors.occurredAt) - Date.parse(e.occurredAt) <= 3_600_000).at(-1);
  const version = typeof deploy?.metadata?.["version"] === "string" ? deploy.metadata["version"] : undefined;
  return deploy ? { deploy, errors, version } : { errors };
}

export type DecisionSummary = {
  headline: string;
  atRisk: string;
  cause?: string;
  recommendation: string;
  safeCount: number;
  status: string[];
};

/**
 * The 20-second answer: what happened, how much is at risk, what is
 * recommended and what is excluded. Every figure comes from the incident's
 * cases, recovery groups, investigation and service health.
 */
export function decisionSummary(repos: Repositories, incident: IncidentRecord, asOf: string, now: Date): DecisionSummary {
  const contract = requireContract(repos, incident.outcomeContractId);
  const totals = incidentTotals(incident, repos.cases.list());
  const groups = groupIncidentCases(repos, incident.id, asOf);
  const safe = groups.find((g) => g.id === "safe");
  const held = groups.filter((g) => g.id !== "safe").reduce((n, g) => n + g.caseIds.length, 0);
  const health = healthResult(repos, incident.affectedService, asOf);
  const service = serviceLabel(incident.affectedService);
  const validated = incident.investigation && (incident.investigationRun?.status ?? "valid") === "valid";
  const missing = MISSING_OUTCOME[contract.expectedOutcome] ?? `have not received ${contract.expectedOutcome}`;

  if (totals.openCaseIds.length === 0) {
    return {
      headline: `All ${plural(totals.caseCount, "affected customer", "affected customers")} now have their outcome`,
      atRisk: `Nothing is at risk. ${formatINR(totals.resolvedAmount)} was recovered.`,
      recommendation: "No decision is needed.",
      safeCount: 0,
      status: statusLine(repos, incident, asOf, now),
    };
  }

  const trigger = deploymentBeforeErrors(repos, incident);
  const cause = validated
    ? `The ${service.toLowerCase()} failed${trigger?.version ? ` after deployment ${trigger.version}` : ""} and ${health.status === "healthy" ? (health.since ? "has now recovered" : "is healthy") : "is still failing"}.`
    : "The cause is still being investigated.";
  const blocker = systemicBlocker(repos, asOf);
  const label = actionLabel(contract.safeRecoveryAction, contract);
  const safeCustomers = safe ? new Set(safe.caseIds.map((id) => repos.cases.get(id)?.customerId)).size : 0;
  const recommendation = blocker
    ? `No recovery can run right now: ${blocker.replace(/^None /, "").replace(/^until/, "waiting until")}.`
    : health.status !== "healthy"
      ? `Wait: recovery is blocked until the ${service.toLowerCase()} is healthy.`
      : safe
        ? `${label} for ${plural(safeCustomers, "customer", "customers")} worth ${formatINR(safe.value)}.${held > 0 ? ` ${plural(held, "case is", "cases are")} excluded for individual review.` : ""}`
        : `Review ${plural(held, "case", "cases")} individually; none can be recovered in bulk.`;
  return {
    headline: `${plural(totals.customersAtRisk, "customer", "customers")} paid but ${missing}`,
    atRisk: `${formatINR(totals.remainingAtRisk)} is at risk.`,
    ...(cause ? { cause } : {}),
    recommendation,
    safeCount: safe && !blocker && health.status === "healthy" ? safe.caseIds.length : 0,
    status: statusLine(repos, incident, asOf, now),
  };
}

function statusLine(repos: Repositories, incident: IncidentRecord, asOf: string, now: Date): string[] {
  const relative = formatRelative;
  const health = healthResult(repos, incident.affectedService, asOf);
  const run = describeIncidentInvestigation(repos, incident.id, asOf);
  const recovered = health.status === "healthy" && health.since ? `Service recovered ${relative(health.since, now)}` : health.status === "down" && health.since ? `Service failing since ${relative(health.since, now)}` : undefined;
  return [`Started ${relative(incident.startedAt, now)}`, ...(recovered ? [recovered] : []), ...(run ? [`Last investigated ${relative(run.at, now)}`] : [])];
}

// ---------------------------------------------------------------------------
// Why RAY recommends this
// ---------------------------------------------------------------------------

export type Reason = { id: string; text: string; evidenceIds: string[] };

/**
 * Operational reasons, each stated only when the recorded evidence or the
 * current policy evaluation supports it.
 */
export function recommendationReasons(repos: Repositories, incident: IncidentRecord, asOf: string): Reason[] {
  const contract = requireContract(repos, incident.outcomeContractId);
  const cases = repos.cases.forIncident(incident.id);
  const reasons: Reason[] = [];
  const payments = cases.map((c) => repos.payments.get(c.paymentId)).filter((p) => p !== undefined);

  const captures = payments.flatMap((p) => repos.payments.events(p.id).filter((e) => e.type === "payment.captured"));
  if (payments.length > 0 && captures.length >= payments.length) {
    reasons.push({ id: "captured", text: `All ${payments.length} payments were captured by Razorpay.`, evidenceIds: captures.map((e) => e.id) });
  }

  const delivered = payments.map((p) => repos.payments.deliveriesForPayment(p.id).find((d) => d.status === "delivered")).filter((d) => d !== undefined);
  if (payments.length > 0 && delivered.length === payments.length) {
    reasons.push({ id: "webhooks", text: `Webhooks reached ${incident.affectedService === "learnloop-webhooks" ? "the merchant" : "LearnLoop"} for every payment.`, evidenceIds: delivered.map((d) => d.id) });
  } else if (delivered.length < payments.length) {
    reasons.push({ id: "webhooks", text: `Webhooks did not reach the merchant for ${plural(payments.length - delivered.length, "payment", "payments")}.`, evidenceIds: [] });
  }

  const vocabulary = fulfilmentVocabulary(contract.fulfilmentService);
  const failures = payments.flatMap((p) => repos.outcomes.events(p.merchantOrderId).filter((e) => e.type === vocabulary.failed && e.status === "failed"));
  const trigger = deploymentBeforeErrors(repos, incident);
  if (failures.length > 0) {
    const what = actionLabel(contract.safeRecoveryAction, contract).replace(/^Retry /, "").replace(/^\w/, (c) => c.toUpperCase());
    reasons.push({
      id: "failed",
      text: `${what} failed for ${plural(new Set(failures.map((f) => f.merchantOrderId)).size, "payment", "payments")}${trigger?.version ? ` after deployment ${trigger.version}` : ""}.`,
      evidenceIds: [...(trigger?.deploy ? [trigger.deploy.id] : []), ...(trigger ? [trigger.errors.id] : []), ...failures.slice(0, 5).map((f) => f.id)],
    });
  }

  const health = healthResult(repos, incident.affectedService, asOf);
  const recovery = repos.outcomes.observability(incident.affectedService).filter((e) => e.type === "service.recovered" && e.occurredAt <= asOf).at(-1);
  reasons.push(
    health.status === "healthy"
      ? { id: "health", text: `The ${serviceLabel(incident.affectedService).toLowerCase()} ${recovery ? "has recovered" : "is healthy"}.`, evidenceIds: recovery ? [recovery.id] : [] }
      : { id: "health", text: `The ${serviceLabel(incident.affectedService).toLowerCase()} is still failing, so recovery waits.`, evidenceIds: [] },
  );

  const groups = groupIncidentCases(repos, incident.id, asOf);
  const safe = groups.find((g) => g.id === "safe");
  if (safe) {
    const matched = safe.caseIds.every((id) => {
      const verdict = assessCase(repos, repos.cases.get(id)!, asOf).verdict;
      return verdict?.checks.find((c) => c.id === "record_match")?.status === "passed";
    });
    if (matched) reasons.push({ id: "match", text: `The ${plural(safe.caseIds.length, "safe case has", "safe cases have")} an exact payment-to-order match.`, evidenceIds: [] });
  }
  const heldLabels: Partial<Record<RecoveryGroupId, (n: number) => string>> = {
    duplicate_review: (n) => plural(n, "duplicate payment", "duplicate payments"),
    high_value: (n) => plural(n, "high-value case", "high-value cases"),
    individual_review: (n) => plural(n, "case with open questions", "cases with open questions"),
    blocked: (n) => plural(n, "case blocked by policy", "cases blocked by policy"),
  };
  const held = groups.filter((g) => g.id !== "safe");
  if (held.length > 0) {
    const parts = held.map((g) => heldLabels[g.id]!(g.caseIds.length));
    const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
    reasons.push({ id: "excluded", text: `${list.charAt(0).toUpperCase()}${list.slice(1)} ${held.reduce((n, g) => n + g.caseIds.length, 0) === 1 ? "is" : "are"} excluded for individual review.`, evidenceIds: held.flatMap((g) => g.caseIds) });
  }
  return reasons;
}

const REASON_SOURCES: Record<string, string> = { captured: "payment", webhooks: "webhook", failed: "fulfilment", health: "service-health" };

/** One quiet line naming the kinds of validated evidence behind the reasons. */
export function reasonsSourceSummary(reasons: readonly Reason[]): string | undefined {
  const kinds = reasons.filter((r) => r.evidenceIds.length > 0 && REASON_SOURCES[r.id]).map((r) => REASON_SOURCES[r.id]!);
  if (kinds.length === 0) return undefined;
  const list = kinds.length === 1 ? kinds[0]! : `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}`;
  return `Supported by validated ${list} evidence.`;
}

// ---------------------------------------------------------------------------
// Authority, confidence and policy for this recovery
// ---------------------------------------------------------------------------

export type RecoveryAuthority = { summary: string[]; contractId: string; policyPreview?: { caseId: string; verdict: PolicyVerdict; actionLabel: string } };

/** A one-line authority summary for the incident's contract, plus the checks policy runs on a representative case. */
export function recoveryAuthority(repos: Repositories, incident: IncidentRecord, asOf: string): RecoveryAuthority {
  const contract = requireContract(repos, incident.outcomeContractId);
  const model = contextAndAuthority(repos, contract);
  const sources = new Set(model.context.filter((c) => c.available && c.source !== "Payment Integrity").map((c) => c.source));
  const proposed = model.actions.find((a) => a.action === contract.safeRecoveryAction);
  const prohibited = model.actions.filter((a) => a.authority === "not_permitted").map((a) => a.label);
  const phrase = !proposed
    ? undefined
    : proposed.authority === "not_permitted"
      ? `${proposed.label} is not permitted`
      : proposed.authority === "automatic"
        ? `${proposed.label} may run automatically within limits`
        : `${proposed.label} requires merchant approval`;
  const summary = [
    `Read access to ${plural(sources.size, "connected source", "connected sources")}`,
    ...(phrase ? [phrase] : []),
    ...(prohibited.filter((l) => l !== proposed?.label).length > 0 ? [`${prohibited.filter((l) => l !== proposed?.label).join(", ")} ${prohibited.length === 1 ? "is" : "are"} not permitted`] : []),
  ];
  const open = repos.cases.forIncident(incident.id).filter(isAtRisk);
  const sample = open.find((c) => assessCase(repos, c, asOf).group === "safe") ?? open.find((c) => c.recommendation);
  return {
    summary,
    contractId: contract.id,
    ...(sample?.recommendation
      ? { policyPreview: { caseId: sample.id, verdict: evaluateCase(repos, sample, sample.recommendation, asOf), actionLabel: actionLabel(sample.recommendation.action, contract) } }
      : {}),
  };
}

export type RecoveryConfidence = {
  /** Root-cause confidence of the validated incident investigation. */
  investigation?: number;
  /** Lowest recommendation confidence among the safe cases (what policy checks per case). */
  recommendation?: number;
  /** Confidence needed for automatic execution: the stricter of contract and global minimums. */
  automaticThreshold: number;
  mode: string;
  explanation: string;
};

/**
 * Keeps three things apart: how confident the investigation is, whether you
 * may approve (all mandatory checks pass), and whether it could run
 * automatically (mode and threshold). Approval never bypasses policy.
 */
export function recoveryConfidence(repos: Repositories, incident: IncidentRecord, asOf: string): RecoveryConfidence {
  const contract = requireContract(repos, incident.outcomeContractId);
  const controls = repos.config.globalControls();
  const threshold = Math.max(contract.minimumConfidence, controls.minimumConfidence);
  const safe = groupIncidentCases(repos, incident.id, asOf).find((g) => g.id === "safe");
  const safeCases = (safe?.caseIds ?? []).map((id) => repos.cases.get(id)).filter((c): c is IntegrityCase => c?.recommendation !== undefined);
  const lowest = safeCases.length > 0 ? Math.min(...safeCases.map((c) => c.recommendation!.confidence)) : undefined;
  const validated = incident.investigation && (incident.investigationRun?.status ?? "valid") === "valid";
  const label = actionLabel(contract.safeRecoveryAction, contract);
  const mode = repos.config.actionModes()[contract.safeRecoveryAction === "replay_webhook" ? "replay_webhook" : "retry_provisioning"];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const investigationConfidence = validated ? incident.investigation!.confidence : undefined;

  let explanation: string;
  // A safe case if any; otherwise an open case proposing the contract's recovery, to show why it cannot run.
  const sample =
    safeCases[0] ??
    repos.cases.forIncident(incident.id).find((c) => isAtRisk(c) && c.type !== "duplicate_payment" && c.recommendation?.action === contract.safeRecoveryAction);
  const verdict = sample ? evaluateCase(repos, sample, sample.recommendation!, asOf) : undefined;
  const hardFailures = verdict?.checks.filter((c) => c.status !== "passed" && c.enforcement === "hard") ?? [];
  if (verdict && hardFailures.length > 0) {
    explanation = `Blocked by policy: ${hardFailures.map((c) => c.explanation).join(" ")}`;
  } else if (!safe || !verdict) {
    explanation = "No case is eligible for approval as a group. Each held case shows its own policy result.";
  } else {
    const automaticParts = [
      `Automatic execution requires ${pct(threshold)} confidence`,
      ...(mode !== "automatic_below_threshold" ? [`and ${label} set to automatic in Automations (it is ${modeLabel(mode)})`] : []),
    ];
    explanation = `${automaticParts.join(" ")}. You may approve this recovery because all mandatory policy checks pass for these ${plural(safe.caseIds.length, "case", "cases")}. Policy is checked again before execution.`;
  }
  return {
    ...(investigationConfidence !== undefined ? { investigation: investigationConfidence } : {}),
    ...(lowest !== undefined ? { recommendation: lowest } : {}),
    automaticThreshold: threshold,
    mode: modeLabel(mode),
    explanation,
  };
}

/** Minimum recommendation confidence across the selected groups' bulk-eligible cases. */
export function selectedActionConfidence(repos: Repositories, incident: IncidentRecord, selected: readonly RecoveryGroupId[], asOf: string): number | undefined {
  const caseIds = groupIncidentCases(repos, incident.id, asOf)
    .filter((g) => selected.includes(g.id))
    .flatMap((g) => g.caseIds);
  const eligible = planBulkRecovery(repos, caseIds, asOf).eligible.filter((c) => c.recommendation !== undefined);
  return eligible.length === 0 ? undefined : Math.min(...eligible.map((c) => c.recommendation!.confidence));
}

export type ModeView = { mode: string; consequence: string; blocked: boolean; tooltip: string };

/**
 * The current automation mode for the incident's recovery action, what it
 * means for this decision, and the automatic threshold, which is only one of
 * the requirements for running without approval.
 */
export function recoveryModeView(repos: Repositories, incident: IncidentRecord, asOf: string): ModeView {
  const contract = requireContract(repos, incident.outcomeContractId);
  const { automaticThreshold, explanation } = recoveryConfidence(repos, incident, asOf);
  const mode = repos.config.actionModes()[contract.safeRecoveryAction === "replay_webhook" ? "replay_webhook" : "retry_provisioning"];
  const label = actionLabel(contract.safeRecoveryAction, contract);
  const blocked = explanation.startsWith("Blocked by policy");
  const consequence = blocked
    ? explanation
    : mode === "automatic_below_threshold"
      ? "Runs without approval within limits"
      : mode === "disabled"
        ? "Cannot run"
        : "Merchant approval required";
  return {
    mode: modeLabel(mode),
    consequence,
    blocked,
    tooltip: `Automatic execution requires at least ${Math.round(automaticThreshold * 100)}% action confidence and an eligible automation mode. ${label} is currently configured as ${modeLabel(mode)}.`,
  };
}

// ---------------------------------------------------------------------------
// Merchant intent
// ---------------------------------------------------------------------------

const OUTCOME_LABELS: Record<string, string> = {
  course_access_granted: "Course access",
  booking_confirmed: "Confirmed booking",
  membership_activated: "Membership activation",
  wallet_credited: "Wallet credit",
  plan_upgraded: "Plan upgrade",
};

/** A merchant-facing name for an Outcome Contract's promised outcome. */
export function outcomeLabel(expectedOutcome: string): string {
  return OUTCOME_LABELS[expectedOutcome] ?? expectedOutcome.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export type MerchantIntent = {
  expectedOutcome: string;
  verifiedThrough: string;
  technical: { outcomeEvent: string; matchingKey: string; verificationMethod: string; deadlineSeconds: number };
};

/**
 * The merchant's intent in plain language for the Decision tab, with the
 * technical definition kept alongside for the Evidence & history tab.
 */
export function merchantIntent(repos: Repositories, incident: IncidentRecord): MerchantIntent {
  const contract = requireContract(repos, incident.outcomeContractId);
  const minutes = contract.deadlineSeconds / 60;
  const deadline = contract.deadlineSeconds % 60 === 0 ? plural(minutes, "minute", "minutes") : plural(contract.deadlineSeconds, "second", "seconds");
  const model = contextAndAuthority(repos, contract);
  const source = model.context.find((c) => c.id === "fulfilment");
  const verifiedThrough = source && source.source !== "No integration" ? source.source : `LearnLoop ${serviceLabel(contract.fulfilmentService).toLowerCase()}`;
  return {
    expectedOutcome: `${outcomeLabel(contract.expectedOutcome)} within ${deadline}`,
    verifiedThrough,
    technical: { outcomeEvent: contract.expectedOutcome, matchingKey: contract.matchingKey, verificationMethod: contract.verificationMethod, deadlineSeconds: contract.deadlineSeconds },
  };
}

// ---------------------------------------------------------------------------
// Evidence summary
// ---------------------------------------------------------------------------

export const EVIDENCE_COUNT_NOTE =
  "Multiple citations may reference the same event. This view shows the events most relevant to the decision rather than every investigation input.";

export type EvidenceCounts = { eventsAnalysed: number; citationsValidated: number; keyEventsShown: number; connectedSources: number };

/** Counts with distinct meanings; none is adjusted to match another. */
export function evidenceCounts(repos: Repositories, incident: IncidentRecord, asOf: string, shown: ReturnType<typeof groupEvidence>): EvidenceCounts | undefined {
  const run = describeIncidentInvestigation(repos, incident.id, asOf);
  if (!run) return undefined;
  return {
    eventsAnalysed: run.eventsExamined,
    citationsValidated: run.citationsChecked,
    keyEventsShown: shown.reduce((n, g) => n + g.items.length, 0),
    // Payment Integrity's own records are not a connected source.
    connectedSources: Object.keys(run.sources).filter((s) => s !== "Payment Integrity").length,
  };
}
