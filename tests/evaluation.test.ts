import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import dataset from "@/fixtures/dataset.json";
import captured from "@/fixtures/evaluation/captured-outputs.json";
import { EVALUATION_SCENARIOS } from "@/fixtures/evaluation/scenarios";
import { evaluateBaseline } from "@/services/evaluation/baseline";
import {
  aggregateEvaluation,
  evaluateScenario,
  filterEvaluationBySplit,
  isUnsafeRecommendation,
  scoreCitationPrecision,
  scoreInvestigation,
} from "@/services/evaluation/scoring";
import type { EvalAction, Scenario } from "@/services/evaluation/types";
import { evaluationModel, type CapturedOutputs } from "@/services/views/evaluation";

const byId = (id: string) => EVALUATION_SCENARIOS.find((s) => s.id === id)!;

function output(scenario: Scenario, action: EvalAction, likelyCause: string, evidenceIds = scenario.truth.requiredEvidenceIds) {
  return {
    status: "output" as const,
    raw: {
      summary: likelyCause,
      likelyCause,
      evidenceIds,
      uncertainties: [],
      recommendedAction: action,
      confidence: 0.9,
      customerImpact: "The customer has not received the outcome.",
      consequenceOfInaction: "The customer may contact support.",
      hypotheses: [{ cause: likelyCause, verdict: "supported", evidenceIds, reasoning: "Cited events show it." }],
    },
  };
}

describe("Evaluation dataset", () => {
  it("has 40 deterministic scenarios, four per category, 32 development and 8 holdout", () => {
    expect(EVALUATION_SCENARIOS).toHaveLength(40);
    const perCategory = new Map<string, number>();
    for (const s of EVALUATION_SCENARIOS) perCategory.set(s.category, (perCategory.get(s.category) ?? 0) + 1);
    expect([...perCategory.values()]).toEqual(Array(10).fill(4));
    expect(EVALUATION_SCENARIOS.filter((s) => s.split === "development")).toHaveLength(32);
    expect(EVALUATION_SCENARIOS.filter((s) => s.split === "holdout")).toHaveLength(8);
    expect(new Set(EVALUATION_SCENARIOS.map((s) => s.id)).size).toBe(40);
  });

  it("labels every scenario completely and cites only its own evidence", () => {
    for (const s of EVALUATION_SCENARIOS) {
      const ids = new Set(s.input.evidence.map((e) => e.id));
      expect(s.truth.requiredEvidenceIds.every((id) => ids.has(id)), s.id).toBe(true);
      expect(s.truth.acceptableActions.length, s.id).toBeGreaterThan(0);
      expect(s.truth.acceptableActions.some((a) => s.truth.unsafeActions.includes(a)), s.id).toBe(false);
      expect(s.reviewerNote.length, s.id).toBeGreaterThan(20);
      if (s.truth.escalationRequired) expect(s.truth.acceptableActions, s.id).toEqual(["escalate"]);
    }
  });

  it("contains no customer PII", () => {
    const text = JSON.stringify(EVALUATION_SCENARIOS) + JSON.stringify(captured);
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/\+91[\s-]?\d{5}/);
    for (const customer of (dataset as { customers: Array<{ name: string }> }).customers) expect(text, customer.name).not.toContain(customer.name);
  });
});

describe("Scoring", () => {
  it("counts only existing evidence IDs as valid citations", () => {
    const s = byId("SC-01A");
    const real = s.input.evidence[0]!.id;
    expect(scoreCitationPrecision(s, [real, "evt_fake", real])).toEqual({ cited: [real, "evt_fake"], valid: [real], invalid: ["evt_fake"], precision: 0.5 });
    expect(scoreCitationPrecision(s, []).precision).toBeUndefined();
  });

  it("always marks explicitly unsafe actions unsafe", () => {
    for (const s of EVALUATION_SCENARIOS) {
      for (const action of s.truth.unsafeActions) {
        expect(isUnsafeRecommendation(s, action), `${s.id} ${action}`).toBe(true);
        const scored = scoreInvestigation(s, output(s, action, "Some cause"));
        expect(scored.unsafe, `${s.id} ${action}`).toBe(true);
        expect(scored.safeRecommendation, `${s.id} ${action}`).toBe(false);
      }
    }
  });

  it("scores invalid or unavailable output as an escalation", () => {
    const s = byId("SC-01A");
    const invalid = scoreInvestigation(s, { status: "output", raw: { nonsense: true } });
    expect(invalid).toMatchObject({ validation: "invalid", action: "escalate", unsafe: false });
    const unavailable = scoreInvestigation(s, { status: "unavailable", reason: "down" });
    expect(unavailable).toMatchObject({ validation: "unavailable", action: "escalate" });
  });

  it("does not treat an unnecessary escalation as unsafe", () => {
    const s = byId("SC-01A");
    const scored = scoreInvestigation(s, output(s, "escalate", "Webhook deliveries to LearnLoop failed with 503"));
    expect(scored).toMatchObject({ unsafe: false, actionAcceptable: false, safeRecommendation: false, causeCorrect: true });
  });

  it("does not count a correct cause with an unsafe action as safe", () => {
    const s = byId("SC-02C");
    const scored = scoreInvestigation(s, output(s, "retry_provisioning", "Enrolment service outage returning 500 errors"));
    expect(scored).toMatchObject({ causeCorrect: true, unsafe: true, safeRecommendation: false });
  });

  it("does not count a correct action with fabricated evidence as safe", () => {
    const s = byId("SC-01A");
    const scored = scoreInvestigation(s, output(s, "replay_webhook", "order.paid webhook deliveries failed with 503", [...s.truth.requiredEvidenceIds, "whd_invented"]));
    expect(scored.validation).toBe("valid");
    expect(scored.removedIds).toEqual(["whd_invented"]);
    expect(scored).toMatchObject({ actionAcceptable: true, unsafe: false, safeRecommendation: false, invalidCitedIds: ["whd_invented"] });
  });

  it("keeps the fixed baseline deterministic", () => {
    for (const s of EVALUATION_SCENARIOS) expect(evaluateBaseline(structuredClone(s))).toEqual(evaluateBaseline(s));
  });
});

describe("Aggregation", () => {
  const results = EVALUATION_SCENARIOS.map((s) => evaluateScenario(s, output(s, s.truth.acceptableActions[0]!, "Not determined from the evidence")));

  it("uses correct denominators", () => {
    const a = aggregateEvaluation(results);
    expect(a.scenarios).toBe(40);
    expect(a.ai.correctAction.denominator).toBe(40);
    expect(a.ai.correctEscalation.denominator).toBe(EVALUATION_SCENARIOS.filter((s) => s.truth.escalationRequired).length);
    expect(a.ai.manualInspection.denominator).toBe(EVALUATION_SCENARIOS.filter((s) => s.truth.manualInspectionNeeded).length);
    expect(a.ai.citationPrecision.denominator).toBe(results.reduce((n, r) => n + r.ai.citedIds.length, 0));
    expect(a.ai.correctAction.numerator).toBe(40);
  });

  it("keeps development and holdout metrics separate", () => {
    const dev = filterEvaluationBySplit(results, "development");
    const holdout = filterEvaluationBySplit(results, "holdout");
    expect(dev.every((r) => r.scenario.split === "development")).toBe(true);
    expect(holdout.every((r) => r.scenario.split === "holdout")).toBe(true);
    expect(aggregateEvaluation(dev).scenarios + aggregateEvaluation(holdout).scenarios).toBe(40);
    expect(evaluationModel(captured as CapturedOutputs, "holdout").rows.map((r) => r.id).sort()).toEqual(holdout.map((r) => r.scenario.id).sort());
  });

  it("computes every displayed figure from labels and captured outputs", () => {
    const model = evaluationModel(captured as CapturedOutputs, "all");
    const unsafe = model.metrics.find((m) => m.id === "unsafe")!;
    expect(unsafe.ai!.numerator).toBe(model.results.filter((r) => r.ai.unsafe).length);
    expect(unsafe.baseline!.numerator).toBe(model.results.filter((r) => r.baseline.unsafe).length);
    expect(model.metrics[0]!.id).toBe("unsafe");
    expect(model.metrics.find((m) => m.id === "time")).toMatchObject({ unscored: "Requires merchant study", ai: null, baseline: null });
    expect(Object.keys((captured as CapturedOutputs).outputs).sort()).toEqual(EVALUATION_SCENARIOS.map((s) => s.id).sort());
  });

  it("never executes anything: evaluation code has no execution, adapter or network imports", () => {
    const files = [
      ...fs.readdirSync(path.join(__dirname, "../src/services/evaluation")).map((f) => path.join("src/services/evaluation", f)),
      "src/services/views/evaluation.ts",
      "src/ui/developer/EvaluationsPage.tsx",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
      expect(source, file).not.toMatch(/@\/services\/execution|@\/adapters|@\/services\/decisions|@\/services\/containment|\bfetch\(/);
    }
  });
});
