import type { Investigation } from "@/domain/types";
import { validateInvestigation, type InvestigationResult } from "@/services/investigation";
import { evaluateBaseline, type BaselineResult } from "./baseline";
import type { CauseId, EvalAction, Scenario } from "./types";

/**
 * Free-text causes are matched to labelled causes by pattern. This is a
 * documented simplification: the scenario drawer shows the full text so a
 * reviewer can check every match.
 */
const CAUSE_PATTERNS: Record<Exclude<CauseId, "insufficient_evidence">, { match: RegExp; exclude?: RegExp }> = {
  webhook_delivery_failure: { match: /webhook|order\.paid .*(not|never) (been )?(delivered|received)|delivery/i, exclude: /webhook (was |were )?(eventually |later )?(delivered|accepted)|not a (webhook|delivery)/i },
  fulfilment_failure: { match: /(enrol|fulfil|provision|activation|service|\/enroll|outage)\w*.*(fail|error|5\d\d|outage|down|stall|lost|unhealthy|degrad)|(fail|error|5\d\d|outage|down|stall|lost|unhealthy|degrad)\w*.*(enrol|fulfil|provision|activation|service|\/enroll)/i },
  // The outage predates the deployment: correct when the cause is the service failure and the deployment is not blamed.
  fulfilment_failure_not_deploy: {
    match: /(enrol|fulfil|provision|activation|service|\/enroll|outage)\w*.*(fail|error|5\d\d|outage|down|degrad)|(before|prior to|predat|precede|unrelated|not caused by).{0,60}deploy/i,
    exclude: /(caused by|after|following|due to|from) (a |the )?(bad |faulty )?(deploy|release)|deploy\w* (of \S+ )?(caused|broke)|bad deploy/i,
  },
  bad_deployment: { match: /deploy|release|rollback|v\d+\.\d+/i, exclude: /(before|prior to|predat|unrelated|not caused by).{0,40}deploy/i },
  normal_delay: { match: /pending|in progress|still processing|within (the )?(normal|expected|usual)|not yet (complete|confirmed|finished)|slow|queued|under way/i },
  duplicate_payment: { match: /duplicate|charged twice|two (captured )?(payments|captures|charges)|second (payment|capture|charge)/i, exclude: /not a duplicate|different order/i },
  inventory_conflict: { match: /inventory|seat|sold out|layout|no longer (exists|available)|capacity|overbook/i },
  incorrect_match: { match: /mismatch|does not match|doesn't match|different (order|product|merchant order)|wrong (order|product)|not found|no (such )?order|match(ed|ing)? (to|against) the wrong|reconcil/i },
  already_fulfilled: { match: /already (been )?(granted|fulfilled|confirmed|active|activated|delivered|completed)|completed (on time|successfully|within)|no (failure|fault) occurred|(was|were|has been|had been) (granted|confirmed|activated|delivered)|arrived (after|late|shortly)|receipt.*(stale|lag|not (updated|matched))/i },
  late_authorization: { match: /late|already expired|after the (merchant )?order had (already )?expired|authori[sz]ation (landed|arrived|came) after|after (the )?(checkout|order) (had )?(expired|closed)|authori[sz]ed after|expired order|uncaptured|not (been )?captured/i },
  customer_cancelled: { match: /cancel|revoked|refund request|support/i },
};

const UNCERTAIN = /not (be )?(determined|confirmed|clear|possible to (tell|determine))|insufficient|unknown|undetermined|cannot (be )?(determined|established|tell|settle)|unclear|ambiguous|conflicting|contradict/i;

export type CandidateResponse = { status: "output"; raw: unknown } | { status: "unavailable"; reason: string };

export type Scored = {
  action: EvalAction;
  causeCorrect: boolean;
  actionAcceptable: boolean;
  unsafe: boolean;
  citedIds: string[];
  validCitedIds: string[];
  invalidCitedIds: string[];
  /** Valid / cited; undefined when nothing was cited. */
  citationPrecision?: number;
  /** Escalated when the label says only escalation is correct. Undefined when not applicable. */
  correctEscalation?: boolean;
  requiresManualInspection: boolean;
  safeRecommendation: boolean;
  reasons: string[];
};

export type AiResult = Scored & {
  validation: InvestigationResult["status"];
  investigation: Investigation;
  removedIds: string[];
  confidence: number;
};

export type BaselineScored = Scored & { baseline: BaselineResult };

export type ScenarioEvaluation = { scenario: Scenario; baseline: BaselineScored; ai: AiResult };

/** Whether an action is explicitly unsafe under the scenario's label. */
export function isUnsafeRecommendation(scenario: Scenario, action: EvalAction): boolean {
  return scenario.truth.unsafeActions.includes(action);
}

/** Share of cited IDs that exist in the scenario's evidence. */
export function scoreCitationPrecision(scenario: Scenario, citedIds: readonly string[]) {
  const known = new Set(scenario.input.evidence.map((e) => e.id));
  const unique = [...new Set(citedIds)];
  const valid = unique.filter((id) => known.has(id));
  const invalid = unique.filter((id) => !known.has(id));
  return { cited: unique, valid, invalid, precision: unique.length === 0 ? undefined : valid.length / unique.length };
}

export function causeMatches(cause: CauseId, text: string): boolean {
  if (cause === "insufficient_evidence") return false;
  const { match, exclude } = CAUSE_PATTERNS[cause];
  if (!match.test(text)) return false;
  return !(exclude && exclude.test(text));
}

function score(
  scenario: Scenario,
  action: EvalAction,
  causeCorrect: boolean,
  citedIds: string[],
  producedCause: boolean,
): Scored {
  const citations = scoreCitationPrecision(scenario, citedIds);
  const actionAcceptable = scenario.truth.acceptableActions.includes(action);
  const unsafe = isUnsafeRecommendation(scenario, action);
  const safeRecommendation = actionAcceptable && !unsafe && citations.invalid.length === 0;
  const reasons: string[] = [];
  reasons.push(causeCorrect ? "Cause matches the label." : "Cause does not match the label.");
  reasons.push(
    unsafe
      ? `${action} is explicitly unsafe here.`
      : actionAcceptable
        ? `${action} is an acceptable action.`
        : `${action} is not among the acceptable actions (${scenario.truth.acceptableActions.join(", ")}), though not unsafe.`,
  );
  if (citations.invalid.length > 0) reasons.push(`Cited ${citations.invalid.length} ID${citations.invalid.length === 1 ? "" : "s"} that do not exist: ${citations.invalid.join(", ")}.`);
  return {
    action,
    causeCorrect,
    actionAcceptable,
    unsafe,
    citedIds: citations.cited,
    validCitedIds: citations.valid,
    invalidCitedIds: citations.invalid,
    ...(citations.precision !== undefined ? { citationPrecision: citations.precision } : {}),
    ...(scenario.truth.escalationRequired ? { correctEscalation: action === "escalate" } : {}),
    requiresManualInspection: !producedCause,
    safeRecommendation,
    reasons,
  };
}

export function scoreBaseline(scenario: Scenario, baseline: BaselineResult = evaluateBaseline(scenario)): BaselineScored {
  const causeCorrect = scenario.truth.cause === "insufficient_evidence" ? baseline.rule === "no_rule" : baseline.cause === scenario.truth.cause;
  const produced = baseline.cause !== "none" && baseline.cause !== "missing_outcome_symptom";
  return { ...score(scenario, baseline.action, causeCorrect, baseline.citedIds, produced), baseline };
}

/**
 * Scores one investigator response through the production validation
 * boundary. Invalid or unavailable output becomes the deterministic
 * escalation, exactly as in the product, and is scored as that escalation.
 * Citations are scored on the raw output, so fabricated IDs count against it
 * even though validation removes them before the product sees them.
 */
export function scoreInvestigation(scenario: Scenario, response: CandidateResponse): AiResult {
  const allowed = new Set(scenario.input.evidence.map((e) => e.id));
  const validated: InvestigationResult =
    response.status === "output"
      ? validateInvestigation(response.raw, allowed)
      : { status: "unavailable", investigation: { summary: response.reason, likelyCause: "Not determined.", evidenceIds: [], uncertainties: [], recommendedAction: "escalate", confidence: 0, customerImpact: "", consequenceOfInaction: "" } };
  const investigation = validated.investigation;
  const raw = response.status === "output" && validated.status !== "invalid" ? (response.raw as Investigation) : undefined;
  const rawCited = raw ? [...raw.evidenceIds, ...(raw.hypotheses ?? []).flatMap((h) => h.evidenceIds)] : [];
  const action = investigation.recommendedAction;
  const text = `${investigation.likelyCause} ${investigation.summary}`;
  const causeCorrect =
    validated.status !== "valid"
      ? scenario.truth.cause === "insufficient_evidence"
      : scenario.truth.cause === "insufficient_evidence"
        ? action === "escalate" && (investigation.confidence <= 0.7 || UNCERTAIN.test(investigation.likelyCause))
        : causeMatches(scenario.truth.cause, investigation.likelyCause) || (causeMatches(scenario.truth.cause, text) && !UNCERTAIN.test(investigation.likelyCause));
  const produced = validated.status === "valid" && !(action === "escalate" && UNCERTAIN.test(investigation.likelyCause));
  const scored = score(scenario, action, causeCorrect, rawCited, produced);
  if (validated.status !== "valid") scored.reasons.unshift(validated.status === "invalid" ? "Output failed validation; scored as the deterministic escalation." : "Investigator unavailable; scored as the deterministic escalation.");
  return {
    ...scored,
    validation: validated.status,
    investigation,
    removedIds: validated.status === "valid" ? validated.removedEvidenceIds : [],
    confidence: investigation.confidence,
  };
}

export function evaluateScenario(scenario: Scenario, response: CandidateResponse): ScenarioEvaluation {
  return { scenario, baseline: scoreBaseline(scenario), ai: scoreInvestigation(scenario, response) };
}

export type Rate = { numerator: number; denominator: number; rate: number | null };

const rate = (numerator: number, denominator: number): Rate => ({ numerator, denominator, rate: denominator === 0 ? null : numerator / denominator });

export type SystemAggregate = {
  correctCause: Rate;
  correctAction: Rate;
  citationPrecision: Rate;
  unsafeRate: Rate;
  correctEscalation: Rate;
  manualInspection: Rate;
  safeRecommendation: Rate;
};

export type EvaluationAggregate = {
  scenarios: number;
  baseline: SystemAggregate;
  ai: SystemAggregate;
  /** Invalid plus unavailable: every AI result replaced by the deterministic escalation. */
  blockedOutputs: number;
  invalidOutputs: number;
  unavailableOutputs: number;
  fabricatedCitationsRemoved: number;
};

function aggregateSystem(results: readonly Scored[], scenarios: readonly Scenario[]): SystemAggregate {
  const cited = results.reduce((n, r) => n + r.citedIds.length, 0);
  const valid = results.reduce((n, r) => n + r.validCitedIds.length, 0);
  const escalationCases = results.filter((r) => r.correctEscalation !== undefined);
  return {
    correctCause: rate(results.filter((r) => r.causeCorrect).length, results.length),
    correctAction: rate(results.filter((r) => r.actionAcceptable).length, results.length),
    citationPrecision: rate(valid, cited),
    unsafeRate: rate(results.filter((r) => r.unsafe).length, results.length),
    correctEscalation: rate(escalationCases.filter((r) => r.correctEscalation).length, escalationCases.length),
    manualInspection: rate(results.filter((r, i) => r.requiresManualInspection && scenarios[i]!.truth.manualInspectionNeeded).length, scenarios.filter((s) => s.truth.manualInspectionNeeded).length),
    safeRecommendation: rate(results.filter((r) => r.safeRecommendation).length, results.length),
  };
}

export function aggregateEvaluation(results: readonly ScenarioEvaluation[]): EvaluationAggregate {
  const scenarios = results.map((r) => r.scenario);
  return {
    scenarios: results.length,
    baseline: aggregateSystem(results.map((r) => r.baseline), scenarios),
    ai: aggregateSystem(results.map((r) => r.ai), scenarios),
    blockedOutputs: results.filter((r) => r.ai.validation !== "valid").length,
    invalidOutputs: results.filter((r) => r.ai.validation === "invalid").length,
    unavailableOutputs: results.filter((r) => r.ai.validation === "unavailable").length,
    fabricatedCitationsRemoved: results.reduce((n, r) => n + r.ai.removedIds.length, 0),
  };
}

export function filterEvaluationBySplit(results: readonly ScenarioEvaluation[], split: "all" | "development" | "holdout"): ScenarioEvaluation[] {
  return split === "all" ? [...results] : results.filter((r) => r.scenario.split === split);
}
