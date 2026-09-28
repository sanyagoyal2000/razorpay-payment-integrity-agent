import type {
  IntegrityCase,
  Investigation,
  InvestigationRun,
  InvestigationStage,
  InvestigationStepId,
  OutcomeContract,
  PolicyVerdict,
} from "@/domain/types";
import { ACTORS } from "@/domain/types";
import type { Repositories } from "@/repositories";
import {
  autonomyExplanationSchema,
  contractDraftSchema,
  messageDraftSchema,
  type AgentGateway,
  type AutonomyExplanation,
  type ContractDraft,
  type MessageDraft,
  type MessageDraftInput,
} from "@/services/agent/contracts";
import {
  buildCaseInvestigationInput,
  buildIncidentInvestigationInput,
  investigateCase,
  investigateIncident,
  type EvidenceItem,
  type InvestigationResult,
} from "@/services/investigation";
import { toRecommendation } from "@/services/investigation/recommendation";
import type { AutonomyEligibility } from "@/services/autonomyEligibility";
import { assessAutonomy, type AutonomyAction } from "@/services/configuration";
import type { AutonomyEvidence } from "@/services/metrics/autonomy";
import { isAtRisk } from "@/services/metrics/cases";
import { ACTIONS, POLICY_ACTION_LABELS } from "@/services/policy/actions";
import { evaluateCase, requireContract } from "@/services/policy/currentState";
import { groupIncidentCases } from "@/services/recovery/groups";
import {
  citationStage,
  compareStage,
  countSources,
  ESCALATION_PREPARED,
  failedPreparingStage,
  failedValidationStage,
  gatherStage,
  healthResult,
  healthStage,
  preparingStage,
  recoverySplitDetail,
  validateStage,
} from "./progress";
import { draftMessageByRule, explainAutonomyByRule } from "./rules";

export type AgentDeps = { repos: Repositories; agent: AgentGateway; clock: { now(): Date } };

// ---------------------------------------------------------------------------
// Investigation runs
// ---------------------------------------------------------------------------

export type InvestigationStep = InvestigationStepId;
/** One completed stage, reported as soon as its operation finishes. */
export type InvestigationProgress = InvestigationStage;

function citedIds(investigation: Investigation): string[] {
  return [...investigation.evidenceIds, ...(investigation.hypotheses ?? []).flatMap((h) => h.evidenceIds)];
}

function runRecord(
  evidence: EvidenceItem[],
  result: InvestigationResult,
  at: string,
  extra: Pick<InvestigationRun, "serviceHealth" | "stages"> & { casesCompared?: number },
): InvestigationRun {
  return {
    at,
    eventsExamined: evidence.length,
    sources: countSources(evidence),
    citationsChecked: result.status === "valid" ? result.citationsChecked : citedIds(result.investigation).length,
    citationsRemoved: result.status === "valid" ? result.removedEvidenceIds : [],
    status: result.status,
    ...extra,
  };
}

const VERDICT_WORDS: Record<PolicyVerdict["result"], string> = {
  allowed: "allowed by policy",
  requires_approval: "needs your approval",
  blocked: "blocked by policy",
};

function casePreparingDetail(repos: Repositories, c: IntegrityCase, asOf: string): string {
  if (!c.recommendation) return "No recommendation; the case is not awaiting a decision.";
  const label = ACTIONS[c.recommendation.action].label;
  if (!isAtRisk(c)) return `Recommended ${label.toLowerCase()}.`;
  const verdict = evaluateCase(repos, c, c.recommendation, asOf);
  return `Recommended ${label.toLowerCase()}; ${VERDICT_WORDS[verdict.result]}.`;
}

function incidentPreparingDetail(repos: Repositories, incidentId: string, asOf: string): string {
  const groups = groupIncidentCases(repos, incidentId, asOf);
  const safe = groups.find((g) => g.id === "safe")?.caseIds.length ?? 0;
  const held = groups.filter((g) => g.id !== "safe").reduce((n, g) => n + g.caseIds.length, 0);
  return recoverySplitDetail(safe, held);
}

/**
 * What the current investigation of a case examined and how its citations
 * held up. Fixture investigations have no stored run, so their stages are
 * derived from the same evidence and checks a live run would record.
 */
export function describeCaseInvestigation(repos: Repositories, c: IntegrityCase, asOf?: string): InvestigationRun | undefined {
  if (c.investigationRun?.stages) return c.investigationRun;
  if (!c.investigation) return undefined;
  const evidence = buildCaseInvestigationInput(repos, c.id).evidence;
  const ids = new Set(evidence.map((e) => e.id));
  const cited = citedIds(c.investigation);
  const removed = cited.filter((id) => !ids.has(id));
  const at = c.investigationRun?.at ?? c.recommendation?.createdAt ?? c.detectedAt;
  const contract = requireContract(repos, c.outcomeContractId);
  const health = healthResult(repos, contract.fulfilmentService, at);
  const status = c.investigationRun?.status ?? "valid";
  return {
    at,
    eventsExamined: evidence.length,
    sources: countSources(evidence),
    citationsChecked: cited.length,
    citationsRemoved: removed,
    status,
    serviceHealth: health,
    stages: [
      gatherStage(evidence),
      compareStage(status, { kind: "case", contract }),
      healthStage(health, at),
      status === "valid" ? citationStage(cited.length, removed.length) : failedValidationStage(status),
      status === "valid" ? preparingStage(casePreparingDetail(repos, c, asOf ?? at)) : failedPreparingStage(),
    ],
  };
}

export function describeIncidentInvestigation(repos: Repositories, incidentId: string, asOf?: string): InvestigationRun | undefined {
  const incident = repos.incidents.get(incidentId);
  if (!incident?.investigation) return undefined;
  if (incident.investigationRun?.stages) return incident.investigationRun;
  const evidence = buildIncidentInvestigationInput(repos, incidentId).evidence;
  const ids = new Set([...evidence.map((e) => e.id), ...incident.caseIds]);
  const cited = citedIds(incident.investigation);
  const removed = cited.filter((id) => !ids.has(id));
  // The investigation covers every case in the incident, so it cannot predate the last one.
  const lastCase = incident.caseIds.map((id) => repos.cases.get(id)?.detectedAt ?? incident.detectedAt).sort().at(-1);
  const at = incident.investigationRun?.at ?? (lastCase && lastCase > incident.detectedAt ? lastCase : incident.detectedAt);
  const health = healthResult(repos, incident.affectedService, at);
  return {
    at,
    eventsExamined: evidence.length,
    sources: countSources(evidence),
    citationsChecked: cited.length,
    citationsRemoved: removed,
    status: "valid",
    casesCompared: incident.caseIds.length,
    serviceHealth: health,
    stages: [
      gatherStage(evidence),
      compareStage("valid", { kind: "incident", caseCount: incident.caseIds.length }),
      healthStage(health, at),
      citationStage(cited.length, removed.length),
      preparingStage(incidentPreparingDetail(repos, incidentId, asOf ?? at)),
    ],
  };
}

/**
 * Runs the investigation again on the current evidence, reporting each stage
 * when its operation completes. The new recommendation replaces the old one
 * only while the case is awaiting a decision; policy is always re-evaluated
 * before anything executes.
 */
export async function reinvestigateCase(deps: AgentDeps, caseId: string, onProgress: (p: InvestigationProgress) => void = () => undefined) {
  const stages: InvestigationStage[] = [];
  const report = (stage: InvestigationStage) => {
    stages.push(stage);
    onProgress(stage);
  };
  const input = buildCaseInvestigationInput(deps.repos, caseId);
  report(gatherStage(input.evidence));
  const result = await investigateCase(deps.agent, input);
  const at = deps.clock.now().toISOString();
  const before = deps.repos.cases.get(caseId)!;
  const contract = requireContract(deps.repos, before.outcomeContractId);
  report(compareStage(result.status, { kind: "case", contract }));
  const health = healthResult(deps.repos, contract.fulfilmentService, at);
  report(healthStage(health, at));
  report(validateStage(result));

  const open = ["open", "review_required", "escalated", "observing"].includes(before.status);
  const updated = deps.repos.cases.save({
    ...before,
    investigation: result.investigation,
    ...(open ? { recommendation: toRecommendation(result.investigation, before.type, at, result.status === "valid" ? "investigation" : "rule_fallback") } : {}),
    updatedAt: at,
  });
  report(result.status === "valid" ? preparingStage(casePreparingDetail(deps.repos, updated, at)) : failedPreparingStage());
  const saved = deps.repos.cases.save({ ...updated, investigationRun: runRecord(input.evidence, result, at, { serviceHealth: health, stages }) });
  deps.repos.audit.append({
    id: deps.repos.nextId("aud"),
    occurredAt: at,
    actor: ACTORS.agent,
    action: "Re-investigated case",
    targetType: "case",
    targetId: caseId,
    caseId,
    ...(saved.incidentId ? { incidentId: saved.incidentId } : {}),
    result:
      result.status === "valid"
        ? `${result.investigation.likelyCause} (confidence ${Math.round(result.investigation.confidence * 100)}%)`
        : result.investigation.summary,
    evidenceIds: result.investigation.evidenceIds,
    approvalSource: "not_required",
  });
  return result;
}

/**
 * Re-investigates an incident. A valid result replaces the findings; an
 * invalid or unavailable one is reported through the stages and the audit
 * log, and the previous validated findings are kept.
 */
export async function reinvestigateIncident(deps: AgentDeps, incidentId: string, onProgress: (p: InvestigationProgress) => void = () => undefined) {
  const stages: InvestigationStage[] = [];
  const report = (stage: InvestigationStage) => {
    stages.push(stage);
    onProgress(stage);
  };
  const input = buildIncidentInvestigationInput(deps.repos, incidentId);
  report(gatherStage(input.evidence));
  const result = await investigateIncident(deps.agent, input);
  const at = deps.clock.now().toISOString();
  const incident = deps.repos.incidents.get(incidentId)!;
  report(compareStage(result.status, { kind: "incident", caseCount: input.caseIds.length }));
  const health = healthResult(deps.repos, incident.affectedService, at);
  report(healthStage(health, at));
  report(validateStage(result));
  if (result.status === "valid") {
    report(preparingStage(incidentPreparingDetail(deps.repos, incidentId, at)));
    const run = runRecord(input.evidence, result, at, { serviceHealth: health, stages, casesCompared: input.caseIds.length });
    deps.repos.incidents.save({ ...incident, investigation: result.investigation, investigationRun: run, likelyCause: result.investigation.likelyCause, summary: result.investigation.summary });
  } else {
    report(failedPreparingStage(incident.investigation ? "Output not used; the previous validated findings are kept for your review." : ESCALATION_PREPARED));
  }
  deps.repos.audit.append({
    id: deps.repos.nextId("aud"),
    occurredAt: at,
    actor: ACTORS.agent,
    action: "Re-investigated incident",
    targetType: "incident",
    targetId: incidentId,
    incidentId,
    result: result.status === "valid" ? `${result.investigation.likelyCause} (confidence ${Math.round(result.investigation.confidence * 100)}%)` : "Investigation output could not be used; previous findings kept",
    evidenceIds: result.investigation.evidenceIds,
    approvalSource: "not_required",
  });
  return result;
}


// ---------------------------------------------------------------------------
// Customer message drafts
// ---------------------------------------------------------------------------

/** Terms a customer message must never contain (spec: no confidence, internal errors, webhooks, thresholds, architecture). */
export const FORBIDDEN_MESSAGE_TERMS: Array<{ label: string; pattern: RegExp }> = [
  { label: "confidence scores", pattern: /\bconfidence\b|\d+\s?%/i },
  { label: "webhooks or APIs", pattern: /\bweb ?hooks?\b|\bAPI\b|\bendpoint\b/i },
  // Status codes stand alone; digits inside amounts such as ₹2,499 do not count.
  { label: "HTTP or error codes", pattern: /\bHTTP\b|(?<![\d,.₹])\b[45]\d{2}\b(?![\d,])|\berror code\b/i },
  { label: "policies or thresholds", pattern: /\bpolic(y|ies)\b|\bthreshold\b/i },
  { label: "AI or agents", pattern: /\bAI\b|\bagent\b|\bmodel\b|\bautomated\b/i },
  { label: "system internals", pattern: /\bdeploy(ment)?\b|\bserver\b|\bservice\b|\boutage\b|\benrol(l)?ment service\b/i },
];

export type CheckedDraft = MessageDraft & { flagged: string[] };

export function checkCustomerMessage(text: string): string[] {
  return FORBIDDEN_MESSAGE_TERMS.filter((t) => t.pattern.test(text)).map((t) => t.label);
}

export function messageInputForCase(repos: Repositories, c: IntegrityCase): MessageDraftInput {
  const payment = repos.payments.get(c.paymentId)!;
  const order = repos.payments.order(payment.merchantOrderId);
  const product = order ? repos.payments.product(order.productId) : undefined;
  const situation: MessageDraftInput["situation"] =
    c.type === "inventory_conflict" ? "seat_changed" : c.type === "late_authorization" ? "payment_held" : c.type === "duplicate_payment" ? "second_charge_review" : c.status === "approved" || c.status === "executing" ? "access_being_restored" : "under_review";
  const facts = [`The customer paid for ${product?.name ?? "their purchase"}.`];
  if (c.type === "duplicate_payment") facts.push("The customer was charged twice for the same purchase.");
  if (c.type === "inventory_conflict") facts.push("The originally booked seat is no longer available after a layout change; options are being confirmed.");
  if (c.type === "late_authorization") facts.push("The bank confirmed the payment after checkout had closed.");
  return { audience: "one_customer", situation, productName: product?.name ?? "your purchase", amount: c.amountAtRisk, facts };
}

export function messageInputForIncident(repos: Repositories, incidentId: string): MessageDraftInput {
  const incident = repos.incidents.get(incidentId)!;
  const contract = repos.config.contract(incident.outcomeContractId);
  return {
    audience: "all_affected_customers",
    situation: "access_being_restored",
    productName: contract?.name === "Course purchase" ? "your course" : "your purchase",
    facts: ["The payment was successful.", "Access is being restored.", "The customer will not be charged again."],
  };
}

/** Drafts a customer message and checks it before a person reviews it. Never sends anything. */
export async function draftCustomerMessage(agent: AgentGateway, input: MessageDraftInput): Promise<CheckedDraft> {
  let raw: unknown;
  try {
    raw = await agent.draftMessage(input);
  } catch {
    raw = null;
  }
  const parsed = messageDraftSchema.safeParse(raw);
  const draft: MessageDraft = parsed.success ? parsed.data : draftMessageByRule(input);
  return { ...draft, flagged: checkCustomerMessage(`${draft.subject} ${draft.body}`) };
}

// ---------------------------------------------------------------------------
// Outcome Contract drafts
// ---------------------------------------------------------------------------

export type CheckedContractDraft = ContractDraft & { corrections: string[] };

/** Drafts contract fields from a description, then enforces the catalogue and global limits. */
export async function draftContract(deps: { repos: Repositories; agent: AgentGateway }, description: string): Promise<CheckedContractDraft> {
  const catalogue = listProducts(deps.repos);
  const services = [...new Set(deps.repos.config.contracts().map((c) => c.fulfilmentService))];
  const globalMax = deps.repos.config.globalControls().maxAutomaticValue;
  const raw = await deps.agent.draftContract({
    description,
    products: catalogue.map((p) => ({ id: p.id, name: p.name, kind: p.kind, price: p.price })),
    fulfilmentServices: services,
    globalMaxAutomaticValue: globalMax,
  });
  const parsed = contractDraftSchema.safeParse(raw);
  if (!parsed.success) throw new Error("The draft could not be used. Fill in the fields yourself or try a clearer description.");
  const draft = parsed.data;
  const corrections: string[] = [];
  const known = new Set(catalogue.map((p) => p.id));
  const scope = draft.productScope.filter((id) => known.has(id));
  if (scope.length !== draft.productScope.length) corrections.push("Removed products that are not in the LearnLoop catalogue.");
  let maxAutomaticValue = draft.maxAutomaticValue;
  if (maxAutomaticValue > globalMax) {
    maxAutomaticValue = globalMax;
    corrections.push(`Automatic limit lowered to the global maximum.`);
  }
  let fulfilmentService = draft.fulfilmentService;
  if (!services.includes(fulfilmentService)) {
    fulfilmentService = services[0] ?? fulfilmentService;
    corrections.push("Fulfilment service replaced with a connected one.");
  }
  return { ...draft, productScope: scope, maxAutomaticValue, fulfilmentService, corrections };
}

function listProducts(repos: Repositories) {
  return repos.config
    .contracts()
    .flatMap((c) => c.productScope)
    .map((id) => repos.payments.product(id))
    .filter((p) => p !== undefined);
}

// ---------------------------------------------------------------------------
// Earned autonomy
// ---------------------------------------------------------------------------

export type CheckedAutonomyExplanation = AutonomyExplanation & { evidence: AutonomyEvidence; eligibility: AutonomyEligibility };

const autonomyCache = new Map<string, Promise<AutonomyExplanation>>();

/**
 * Explains the earned-autonomy evidence. The eligibility decision is
 * deterministic and passed to the agent as a fact; whatever the agent
 * suggests is overridden by it and clamped to global controls. Suggests
 * only; never changes a setting.
 */
export async function explainEarnedAutonomy(
  deps: { repos: Repositories; agent: AgentGateway },
  action: AutonomyAction,
  asOf: string,
  refresh = false,
): Promise<CheckedAutonomyExplanation> {
  void asOf;
  const { evidence, eligibility } = assessAutonomy(deps.repos, action);
  const cases = evidence.caseIds.map((id) => deps.repos.cases.get(id)).filter((c) => c !== undefined);
  const decisions = cases.map((c) => c.decisions.find((d) => d.actor === ACTORS.operator && d.kind !== "wait")).filter((d) => d !== undefined);
  const policy = deps.repos.config.actionPolicies().find((p) => p.action === action)!;
  const controls = deps.repos.config.globalControls();
  const input = {
    action: POLICY_ACTION_LABELS[action],
    currentMode: policy.mode,
    considered: evidence.recommendationsReviewed,
    approvedWithoutEdits: evidence.approvedWithoutEdits,
    edited: decisions.filter((d) => d.edited || d.kind === "edited").length,
    rejected: decisions.filter((d) => d.kind === "rejected").length,
    executed: evidence.executed,
    verifiedSuccessful: evidence.verifiedSuccessful,
    failedExecutions: evidence.failedExecutions,
    wrongActions: evidence.wrongActions,
    eligible: eligibility.eligible,
    unmetCriteria: eligibility.criteria.filter((c) => !c.met).map((c) => `${c.label.toLowerCase()} (${c.detail.replace(/\.$/, "")})`),
    medianAmount: evidence.amounts?.median ?? 0,
    maxAmount: evidence.amounts?.max ?? 0,
    maxAutomaticValue: eligibility.suggestion?.maxValue ?? controls.maxAutomaticValue,
    minimumConfidence: eligibility.suggestion?.minimumConfidence ?? controls.minimumConfidence,
    editReasons: decisions.filter((d) => d.edited || d.kind === "edited").map((d) => d.reason ?? "").filter(Boolean),
    rejectionReasons: decisions.filter((d) => d.kind === "rejected").map((d) => d.reason ?? "").filter(Boolean),
  };
  const key = JSON.stringify(input);
  if (refresh || !autonomyCache.has(key)) {
    autonomyCache.set(
      key,
      deps.agent
        .explainAutonomy(input)
        .catch(() => null)
        .then((raw) => {
          const parsed = autonomyExplanationSchema.safeParse(raw);
          return parsed.success ? parsed.data : explainAutonomyByRule(input);
        }),
    );
  }
  const explanation = await autonomyCache.get(key)!;
  const reviewFirst = policy.mode === "always_require_approval" ? "always_require_approval" : "suggest_only";
  return {
    ...explanation,
    // The deterministic decision wins over any suggestion in the explanation.
    suggestedMode: eligibility.eligible ? "automatic_below_threshold" : reviewFirst,
    suggestedMaxValue: Math.min(explanation.suggestedMaxValue, eligibility.suggestion?.maxValue ?? controls.maxAutomaticValue, controls.maxAutomaticValue),
    suggestedMinimumConfidence: Math.max(explanation.suggestedMinimumConfidence, eligibility.suggestion?.minimumConfidence ?? controls.minimumConfidence, controls.minimumConfidence),
    evidence,
    eligibility,
  };
}

export type ContractFormValues = Omit<OutcomeContract, "id" | "updatedAt">;
