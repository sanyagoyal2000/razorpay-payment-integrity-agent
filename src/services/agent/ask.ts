import { ACTORS, type AuditDetail } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { buildIncidentInvestigationInput, type EvidenceItem } from "@/services/investigation";
import { incidentTotals } from "@/services/metrics/cases";
import { requireContract } from "@/services/policy/currentState";
import { groupIncidentCases, type RecoveryGroupId } from "@/services/recovery/groups";
import { AGENT_VERSION, fingerprint, POLICY_VERSION } from "@/services/versions";
import { resolveEvidence } from "@/services/views/evidence";
import { recoveryPlan } from "@/services/views/incidents";
import { askAnswerSchema, type AgentGateway, type AskAnswer, type AskIncidentInput } from "./contracts";
import { healthResult, healthStage, SOURCE_LABELS } from "./progress";
import { askByRule } from "./rules";

export type AskDeps = { repos: Repositories; agent: AgentGateway; clock: { now(): Date } };

export type AskCitation = { id: string; kind: "evidence" | "case" | "fact"; title: string };

export type AskResult = {
  question: string;
  askedAt: string;
  inScope: boolean;
  answer: string;
  citations: AskCitation[];
  /** IDs the answer cited that are not in the incident's evidence, facts or cases; removed. */
  removedIds: string[];
  /** In scope, but nothing it said could be tied to evidence: shown as unverified. */
  unsupported: boolean;
  nextStep: AskAnswer["nextStep"];
  producedBy: string;
  fallback: boolean;
};

const HELD_REASON: Record<Exclude<RecoveryGroupId, "safe">, string> = {
  duplicate_review: "they are duplicate payments: access is granted once against the original charge, then a person decides on the second charge",
  high_value: "each is above the automatic value limit, so it needs individual approval",
  individual_review: "open questions remain that need a person's judgement",
  blocked: "policy currently blocks the proposed action",
};

/** Facts the product computes itself, so answers about recovery rest on current policy, not the model. */
export function askFacts(repos: Repositories, incidentId: string, asOf: string): AskIncidentInput["facts"] {
  const incident = repos.incidents.get(incidentId);
  if (!incident) throw new Error(`Incident ${incidentId} not found`);
  const contract = requireContract(repos, incident.outcomeContractId);
  const totals = incidentTotals(incident, repos.cases.list());
  const groups = groupIncidentCases(repos, incidentId, asOf);
  const safe = groups.find((g) => g.id === "safe");
  const facts: AskIncidentInput["facts"] = [
    {
      id: "fact:summary",
      statement: `${totals.caseCount} payments missed ${contract.expectedOutcome}; ${formatINR(totals.remainingAtRisk)} is still at risk across ${totals.customersAtRisk} learners.`,
    },
    { id: "fact:service", statement: healthStage(healthResult(repos, incident.affectedService, asOf), asOf).detail },
  ];
  if (incident.investigation && (incident.investigationRun?.status ?? "valid") === "valid") {
    facts.push({ id: "fact:cause", statement: `Validated likely cause: ${incident.investigation.likelyCause}` });
  }
  facts.push({
    id: "fact:safe",
    statement: safe
      ? `${safe.caseIds.length} cases (${formatINR(safe.value)}) are eligible for bulk recovery under current policy.`
      : "No cases are eligible for bulk recovery under current policy.",
  });
  for (const g of groups) {
    if (g.id === "safe") continue;
    facts.push({ id: `fact:held:${g.id}`, statement: `${g.caseIds.length} ${g.caseIds.length === 1 ? "case is" : "cases are"} held because ${HELD_REASON[g.id]} (${g.caseIds.join(", ")}).` });
  }
  if (safe) {
    const plan = recoveryPlan(repos, incident, ["safe"], asOf);
    facts.push(
      { id: "fact:plan:actions", statement: `Approving the safe batch would start ${plan.actions}, for ${plan.customers} learners and ${formatINR(plan.revenueAddressed)}. Policy is checked again before each one runs.` },
      { id: "fact:plan:verification", statement: plan.verification },
      { id: "fact:plan:escalation", statement: plan.escalation },
      { id: "fact:plan:communication", statement: plan.communication },
    );
  }
  return facts;
}

/** The incident's permitted evidence, its case IDs and the product's facts, plus the question. */
export function buildAskInput(repos: Repositories, incidentId: string, question: string, asOf: string): AskIncidentInput {
  const investigation = buildIncidentInvestigationInput(repos, incidentId);
  return { incidentId, question: question.trim().slice(0, 500), facts: askFacts(repos, incidentId, asOf), caseIds: investigation.caseIds, evidence: investigation.evidence };
}

/**
 * Answers one question about one incident. Answers can explain and point to
 * where to act; they never execute anything. Citations are checked against
 * the incident's permitted evidence, cases and facts; anything else is
 * removed. The question itself is not stored, only its fingerprint.
 */
export { suggestedQuestions } from "./askSuggestions";

export async function askRay(deps: AskDeps, incidentId: string, question: string): Promise<AskResult> {
  const asOf = deps.clock.now().toISOString();
  const input = buildAskInput(deps.repos, incidentId, question, asOf);
  let raw: unknown = null;
  try {
    raw = await deps.agent.askIncident(input);
  } catch {
    raw = null;
  }
  const parsed = askAnswerSchema.safeParse(raw);
  const fallback = !parsed.success;
  const answer: AskAnswer = parsed.success ? parsed.data : askByRule(input);

  const evidenceIds = new Set(input.evidence.map((e) => e.id));
  const caseIds = new Set(input.caseIds);
  const facts = new Map(input.facts.map((f) => [f.id, f.statement]));
  const cited = [...new Set(answer.citedIds)];
  const citations: AskCitation[] = cited.flatMap((id): AskCitation[] => {
    if (facts.has(id)) return [{ id, kind: "fact", title: facts.get(id)! }];
    if (caseIds.has(id)) return [{ id, kind: "case", title: `Case ${id}` }];
    if (evidenceIds.has(id)) return [{ id, kind: "evidence", title: resolveEvidence(deps.repos, id)?.title ?? id }];
    return [];
  });
  const removedIds = cited.filter((id) => !facts.has(id) && !caseIds.has(id) && !evidenceIds.has(id));
  const producedBy = fallback ? "Deterministic answer from product facts (RAY unavailable or output invalid)" : ((await deps.agent.describe?.()) ?? "Payment Integrity Agent");

  const detail: AuditDetail = {
    invocationId: deps.repos.nextId("inv"),
    trigger: "merchant",
    agentVersion: AGENT_VERSION,
    policyVersion: POLICY_VERSION,
    sources: [...new Set(input.evidence.map((e) => SOURCE_LABELS[e.source as EvidenceItem["source"]] ?? e.source))],
    producedBy,
    inputFingerprint: fingerprint(input),
    outputFingerprint: fingerprint(answer),
  };
  deps.repos.audit.append({
    id: deps.repos.nextId("aud"),
    occurredAt: asOf,
    actor: ACTORS.operator,
    action: "Asked RAY",
    targetType: "incident",
    targetId: incidentId,
    incidentId,
    result: `${answer.inScope ? "Answered" : "Out of scope"} with ${citations.length} ${citations.length === 1 ? "citation" : "citations"}${removedIds.length > 0 ? `; ${removedIds.length} unverifiable removed` : ""}. Nothing was executed.`,
    evidenceIds: citations.filter((c) => c.kind !== "fact").map((c) => c.id),
    approvalSource: "not_required",
    detail,
  });

  return {
    question: input.question,
    askedAt: asOf,
    inScope: answer.inScope,
    answer: answer.answer,
    citations,
    removedIds,
    unsupported: answer.inScope && citations.length === 0,
    nextStep: answer.nextStep,
    producedBy,
    fallback,
  };
}
