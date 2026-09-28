import { CATEGORY_LABELS, EVALUATION_SCENARIOS } from "@/fixtures/evaluation/scenarios";
import {
  aggregateEvaluation,
  evaluateScenario,
  filterEvaluationBySplit,
  type CandidateResponse,
  type EvaluationAggregate,
  type Rate,
  type ScenarioEvaluation,
} from "@/services/evaluation/scoring";
import type { EvalAction, Scenario, ScenarioCategory } from "@/services/evaluation/types";

/** Committed candidate outputs. A future live runner can produce the same shape. */
export type CapturedOutputs = {
  version: string;
  capturedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  scenarioCount: number;
  outputs: Record<string, { status: "output"; raw: unknown; durationMs: number } | { status: "unavailable"; reason: string; durationMs: number } | undefined>;
};

/** Source of investigator outputs for the benchmark. Captured outputs today; a live runner could implement the same. */
export type CandidateSource = { label: string; responseFor(scenarioId: string): CandidateResponse };

export function capturedCandidateSource(captured: CapturedOutputs): CandidateSource {
  return {
    label: "captured investigator output",
    responseFor: (id) => {
      const entry = captured.outputs[id];
      if (!entry) return { status: "unavailable", reason: "No captured output for this scenario" };
      return entry.status === "output" ? { status: "output", raw: entry.raw } : { status: "unavailable", reason: entry.reason };
    },
  };
}

export type EvaluationSplit = "all" | "development" | "holdout";

export const ACTION_LABELS: Record<EvalAction, string> = {
  wait: "Wait",
  replay_webhook: "Replay webhook",
  retry_provisioning: "Retry provisioning",
  capture: "Capture payment",
  prepare_refund: "Prepare refund",
  refund_duplicate: "Refund duplicate",
  escalate: "Escalate",
};

export const CAUSE_LABELS: Record<Scenario["truth"]["cause"], string> = {
  webhook_delivery_failure: "Webhook delivery failed",
  fulfilment_failure: "Fulfilment service failed",
  fulfilment_failure_not_deploy: "Outage that predates a deployment",
  bad_deployment: "Bad deployment",
  normal_delay: "Normal processing delay",
  duplicate_payment: "Duplicate payment",
  inventory_conflict: "Inventory conflict",
  incorrect_match: "Payment matched to the wrong order",
  already_fulfilled: "Outcome already fulfilled",
  late_authorization: "Late authorisation",
  customer_cancelled: "Customer cancelled after fulfilment",
  insufficient_evidence: "Insufficient evidence; escalate",
};

export type MetricRow = {
  id: string;
  label: string;
  baseline: Rate | null;
  ai: Rate | null;
  lowerIsBetter: boolean;
  interpretation: string;
  emphasis?: boolean;
  /** Metrics that cannot be scored from this dataset. */
  unscored?: string;
};

const pct = (r: Rate | null) => (r?.rate === null || r === null ? "n/a" : `${Math.round(r.rate * 1000) / 10}%`);

function interpret(baseline: Rate, ai: Rate, lowerIsBetter: boolean, noun: string): string {
  if (baseline.rate === null || ai.rate === null) return "Not enough cases to compare.";
  const diff = Math.round((ai.rate - baseline.rate) * 1000) / 10;
  if (diff === 0) return `Same ${noun} for both.`;
  const aiBetter = lowerIsBetter ? diff < 0 : diff > 0;
  return `${aiBetter ? "AI investigator" : "Fixed rules"} ${aiBetter === lowerIsBetter ? "lower" : "higher"} by ${Math.abs(diff)} points.`;
}

function metricRows(a: EvaluationAggregate): MetricRow[] {
  const row = (id: string, label: string, key: keyof EvaluationAggregate["ai"], lowerIsBetter: boolean, noun: string, emphasis = false): MetricRow => ({
    id,
    label,
    baseline: a.baseline[key],
    ai: a.ai[key],
    lowerIsBetter,
    interpretation: interpret(a.baseline[key], a.ai[key], lowerIsBetter, noun),
    ...(emphasis ? { emphasis } : {}),
  });
  return [
    row("unsafe", "Unsafe-action recommendation rate", "unsafeRate", true, "rate", true),
    row("safe", "Safe recommendation rate", "safeRecommendation", false, "rate"),
    row("cause", "Correct top root cause", "correctCause", false, "accuracy"),
    row("action", "Correct safe action", "correctAction", false, "accuracy"),
    row("citations", "Evidence citation precision", "citationPrecision", false, "precision"),
    row("escalation", "Correct escalation under insufficient evidence", "correctEscalation", false, "rate"),
    row("manual", "Cases still requiring manual log inspection", "manualInspection", true, "rate"),
    {
      id: "time",
      label: "Merchant time saved",
      baseline: null,
      ai: null,
      lowerIsBetter: false,
      interpretation: "Not measured. Requires a merchant study.",
      unscored: "Requires merchant study",
    },
  ];
}

export type CompositionRow = { category: ScenarioCategory; label: string; total: number; development: number; holdout: number };

function composition(scenarios: readonly Scenario[]) {
  const categories = [...new Set(scenarios.map((s) => s.category))];
  const kind = (s: Scenario) =>
    s.truth.escalationRequired ? "must_escalate" : s.truth.acceptableActions.every((a) => a === "wait" || a === "escalate") ? "wait_or_escalate" : "safe_to_act";
  return {
    byCategory: categories.map(
      (category): CompositionRow => ({
        category,
        label: CATEGORY_LABELS[category],
        total: scenarios.filter((s) => s.category === category).length,
        development: scenarios.filter((s) => s.category === category && s.split === "development").length,
        holdout: scenarios.filter((s) => s.category === category && s.split === "holdout").length,
      }),
    ),
    clear: scenarios.filter((s) => s.shape === "clear").length,
    ambiguous: scenarios.filter((s) => s.shape !== "clear").length,
    shapes: (["clear", "multiple_causes", "missing_evidence", "contradictory"] as const).map((shape) => ({ shape, count: scenarios.filter((s) => s.shape === shape).length })),
    safeToAct: scenarios.filter((s) => kind(s) === "safe_to_act").length,
    waitOrEscalate: scenarios.filter((s) => kind(s) === "wait_or_escalate").length,
    mustEscalate: scenarios.filter((s) => kind(s) === "must_escalate").length,
  };
}

export type ScenarioRow = {
  id: string;
  category: string;
  split: Scenario["split"];
  truth: string;
  baselineAction: string;
  baselineResult: "safe" | "not_acceptable" | "unsafe";
  aiAction: string;
  aiResult: "safe" | "not_acceptable" | "unsafe";
  aiValidation: ScenarioEvaluation["ai"]["validation"];
  citation: string;
};

const resultOf = (r: { unsafe: boolean; safeRecommendation: boolean }) => (r.unsafe ? "unsafe" : r.safeRecommendation ? "safe" : "not_acceptable");

function scenarioRow(e: ScenarioEvaluation): ScenarioRow {
  const { ai } = e;
  return {
    id: e.scenario.id,
    category: CATEGORY_LABELS[e.scenario.category],
    split: e.scenario.split,
    truth: CAUSE_LABELS[e.scenario.truth.cause],
    baselineAction: ACTION_LABELS[e.baseline.action],
    baselineResult: resultOf(e.baseline),
    aiAction: ACTION_LABELS[ai.action],
    aiResult: resultOf(ai),
    aiValidation: ai.validation,
    citation:
      ai.validation !== "valid"
        ? ai.validation === "invalid" ? "Output blocked" : "No output"
        : ai.citedIds.length === 0
          ? "None cited"
          : `${ai.validCitedIds.length} of ${ai.citedIds.length} valid`,
  };
}

/** Everything the Investigator validation page shows, computed from labels and captured outputs. */
export function evaluationModel(captured: CapturedOutputs, split: EvaluationSplit, scenarios: readonly Scenario[] = EVALUATION_SCENARIOS) {
  const source = capturedCandidateSource(captured);
  const all = scenarios.map((s) => evaluateScenario(s, source.responseFor(s.id)));
  const selected = filterEvaluationBySplit(all, split);
  const aggregate = aggregateEvaluation(selected);
  const escalationCases = selected.filter((r) => r.scenario.truth.escalationRequired);
  return {
    meta: {
      scenarios: scenarios.length,
      categories: new Set(scenarios.map((s) => s.category)).size,
      development: scenarios.filter((s) => s.split === "development").length,
      holdout: scenarios.filter((s) => s.split === "holdout").length,
      capturedAt: captured.capturedAt,
      version: captured.version,
      provider: captured.provider,
      model: captured.model,
      promptVersion: captured.promptVersion,
      sourceLabel: source.label,
    },
    split,
    aggregate,
    metrics: metricRows(aggregate),
    safety: {
      unsafeAi: aggregate.ai.unsafeRate,
      unsafeBaseline: aggregate.baseline.unsafeRate,
      aiCorrectEscalations: { numerator: escalationCases.filter((r) => r.ai.correctEscalation).length, denominator: escalationCases.length },
      blockedOutputs: aggregate.blockedOutputs,
      invalidOutputs: aggregate.invalidOutputs,
      unavailableOutputs: aggregate.unavailableOutputs,
      fabricatedCitationsRemoved: aggregate.fabricatedCitationsRemoved,
    },
    composition: composition(scenarios),
    rows: selected.map(scenarioRow),
    results: selected,
  };
}

export type EvaluationModel = ReturnType<typeof evaluationModel>;
export { pct as formatRate };
