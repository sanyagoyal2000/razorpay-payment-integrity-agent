import type { ActionType, IntegrityCase, InvestigationRun, OutcomeContract } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import { median } from "@/domain/time";
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
import { earnedAutonomy } from "@/services/metrics/autonomy";
import { wrongActionRate } from "@/services/metrics/overview";
import { POLICY_ACTION_LABELS } from "@/services/policy/actions";
import { draftMessageByRule, explainAutonomyByRule } from "./rules";

export type AgentDeps = { repos: Repositories; agent: AgentGateway; clock: { now(): Date } };

// ---------------------------------------------------------------------------
// Investigation runs
// ---------------------------------------------------------------------------

export type InvestigationStep = "gathering" | "reviewing" | "checking" | "done";
export type InvestigationProgress = { step: InvestigationStep; detail: string };

const SOURCE_LABELS: Record<EvidenceItem["source"], string> = {
  razorpay: "Razorpay",
  learnloop: "LearnLoop",
  learnloop_observability: "LearnLoop Observability",
  payment_integrity: "Payment Integrity",
};

function countSources(evidence: EvidenceItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of evidence) counts[SOURCE_LABELS[item.source]] = (counts[SOURCE_LABELS[item.source]] ?? 0) + 1;
  return counts;
}

function runRecord(evidence: EvidenceItem[], result: InvestigationResult, at: string): InvestigationRun {
  const cited = [...result.investigation.evidenceIds, ...(result.investigation.hypotheses ?? []).flatMap((h) => h.evidenceIds)];
  return {
    at,
    eventsExamined: evidence.length,
    sources: countSources(evidence),
    citationsChecked: result.status === "valid" ? result.citationsChecked : cited.length,
    citationsRemoved: result.status === "valid" ? result.removedEvidenceIds : [],
    status: result.status,
  };
}

/** What the current investigation of a case examined and how its citations held up. */
export function describeCaseInvestigation(repos: Repositories, c: IntegrityCase): InvestigationRun | undefined {
  if (c.investigationRun) return c.investigationRun;
  if (!c.investigation) return undefined;
  const evidence = buildCaseInvestigationInput(repos, c.id).evidence;
  const ids = new Set(evidence.map((e) => e.id));
  const cited = [...c.investigation.evidenceIds, ...(c.investigation.hypotheses ?? []).flatMap((h) => h.evidenceIds)];
  return {
    at: c.recommendation?.createdAt ?? c.detectedAt,
    eventsExamined: evidence.length,
    sources: countSources(evidence),
    citationsChecked: cited.length,
    citationsRemoved: cited.filter((id) => !ids.has(id)),
    status: "valid",
  };
}

export function describeIncidentInvestigation(repos: Repositories, incidentId: string): InvestigationRun | undefined {
  const incident = repos.incidents.get(incidentId);
  if (!incident?.investigation) return undefined;
  if (incident.investigationRun) return incident.investigationRun;
  const evidence = buildIncidentInvestigationInput(repos, incidentId).evidence;
  const ids = new Set([...evidence.map((e) => e.id), ...incident.caseIds]);
  const cited = [...incident.investigation.evidenceIds, ...(incident.investigation.hypotheses ?? []).flatMap((h) => h.evidenceIds)];
  return {
    at: incident.detectedAt,
    eventsExamined: evidence.length + incident.caseIds.length,
    sources: { ...countSources(evidence), "Payment Integrity cases": incident.caseIds.length },
    citationsChecked: cited.length,
    citationsRemoved: cited.filter((id) => !ids.has(id)),
    status: "valid",
  };
}

/**
 * Runs the investigation again on the current evidence. The new
 * recommendation replaces the old one only while the case is awaiting a
 * decision; policy is always re-evaluated before anything executes.
 */
export async function reinvestigateCase(deps: AgentDeps, caseId: string, onProgress: (p: InvestigationProgress) => void = () => undefined) {
  const input = buildCaseInvestigationInput(deps.repos, caseId);
  onProgress({ step: "gathering", detail: `Collected ${input.evidence.length} events from ${Object.keys(countSources(input.evidence)).length} sources` });
  onProgress({ step: "reviewing", detail: "Weighing possible causes against the evidence" });
  const result = await investigateCase(deps.agent, input);
  const at = deps.clock.now().toISOString();
  const run = runRecord(input.evidence, result, at);
  onProgress({
    step: "checking",
    detail: result.status === "valid" ? `Checked ${run.citationsChecked} citations; ${run.citationsRemoved.length} removed` : "Output could not be used; escalating for review",
  });
  const c = deps.repos.cases.get(caseId)!;
  const open = ["open", "review_required", "escalated", "observing"].includes(c.status);
  deps.repos.cases.save({
    ...c,
    investigation: result.investigation,
    investigationRun: run,
    ...(open ? { recommendation: toRecommendation(result.investigation, c.type, at) } : {}),
    updatedAt: at,
  });
  deps.repos.audit.append({
    id: deps.repos.nextId("aud"),
    occurredAt: at,
    actor: ACTORS.agent,
    action: "Re-investigated case",
    targetType: "case",
    targetId: caseId,
    caseId,
    ...(c.incidentId ? { incidentId: c.incidentId } : {}),
    result:
      result.status === "valid"
        ? `${result.investigation.likelyCause} (confidence ${Math.round(result.investigation.confidence * 100)}%)`
        : result.investigation.summary,
    evidenceIds: result.investigation.evidenceIds,
    approvalSource: "not_required",
  });
  onProgress({ step: "done", detail: result.status === "valid" ? "Recommendation updated; policy re-evaluated" : "Escalation recommended" });
  return result;
}

export async function reinvestigateIncident(deps: AgentDeps, incidentId: string, onProgress: (p: InvestigationProgress) => void = () => undefined) {
  const input = buildIncidentInvestigationInput(deps.repos, incidentId);
  onProgress({ step: "gathering", detail: `Collected ${input.evidence.length} events across ${input.caseIds.length} cases` });
  onProgress({ step: "reviewing", detail: "Weighing possible shared causes" });
  const result = await investigateIncident(deps.agent, input);
  const at = deps.clock.now().toISOString();
  const run = runRecord(input.evidence, result, at);
  run.eventsExamined += input.caseIds.length;
  onProgress({
    step: "checking",
    detail: result.status === "valid" ? `Checked ${run.citationsChecked} citations; ${run.citationsRemoved.length} removed` : "Output could not be used",
  });
  const incident = deps.repos.incidents.get(incidentId)!;
  if (result.status === "valid") {
    deps.repos.incidents.save({ ...incident, investigation: result.investigation, investigationRun: run, likelyCause: result.investigation.likelyCause, summary: result.investigation.summary });
  } else {
    deps.repos.incidents.save({ ...incident, investigationRun: run });
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
  onProgress({ step: "done", detail: result.status === "valid" ? "Findings updated" : "Previous findings kept" });
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

export type CheckedAutonomyExplanation = AutonomyExplanation & { evidence: ReturnType<typeof earnedAutonomy> };

const autonomyCache = new Map<string, Promise<AutonomyExplanation>>();

/**
 * Explains whether an action could run automatically. Suggests only; never
 * changes a setting. The explanation is reused until the underlying decisions
 * change, unless `refresh` asks for a new one.
 */
export async function explainEarnedAutonomy(
  deps: { repos: Repositories; agent: AgentGateway },
  action: ActionType,
  asOf: string,
  refresh = false,
): Promise<CheckedAutonomyExplanation> {
  const evidence = earnedAutonomy(deps.repos, action);
  const cases = evidence.caseIds.map((id) => deps.repos.cases.get(id)!).filter(Boolean);
  const decisions = cases.map((c) => c.decisions.find((d) => d.actor === ACTORS.operator && d.kind !== "wait")!).filter(Boolean);
  const amounts = cases.map((c) => c.amountAtRisk);
  const wrong = wrongActionRate(deps.repos, asOf);
  const policy = deps.repos.config.actionPolicies().find((p) => p.action === "retry_provisioning")!;
  const controls = deps.repos.config.globalControls();
  const input = {
    action: POLICY_ACTION_LABELS.retry_provisioning,
    currentMode: policy.mode,
    considered: evidence.considered,
    approvedWithoutEdits: evidence.approvedWithoutEdits,
    edited: decisions.filter((d) => d.edited || d.kind === "edited").length,
    rejected: decisions.filter((d) => d.kind === "rejected").length,
    wrongActionsLast30Days: wrong.wrong.length,
    executedLast30Days: wrong.executed.length,
    medianAmount: median(amounts) ?? 0,
    maxAmount: Math.max(0, ...amounts),
    maxAutomaticValue: controls.maxAutomaticValue,
    minimumConfidence: controls.minimumConfidence,
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
  return {
    ...explanation,
    suggestedMaxValue: Math.min(explanation.suggestedMaxValue, controls.maxAutomaticValue),
    suggestedMinimumConfidence: Math.max(explanation.suggestedMinimumConfidence, controls.minimumConfidence),
    evidence,
  };
}

export type ContractFormValues = Omit<OutcomeContract, "id" | "updatedAt">;
