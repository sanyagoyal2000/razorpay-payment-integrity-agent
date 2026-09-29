import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import type { AgentGateway } from "@/services/agent/contracts";
import { explainEarnedAutonomy } from "@/services/agent";
import { evaluateAutonomyEligibility, type EligibilityContext } from "@/services/autonomyEligibility";
import { assessAutonomy, ConfigurationError, keepReviewFirst, switchOnEarnedAutomation } from "@/services/configuration";
import { earnedAutonomy, type AutonomyEvidence } from "@/services/metrics/autonomy";
import { NOW, setup } from "./helpers";

/** Clears the one known wrong action so the fixture sample becomes eligible. */
function withoutWrongAction(env: ReturnType<typeof setup>) {
  const wrong = env.repos.cases.list().find((c) => c.wrongAction)!;
  const { wrongAction, ...rest } = wrong;
  void wrongAction;
  env.repos.cases.save(rest);
}

function context(env: ReturnType<typeof setup>): EligibilityContext {
  return {
    contracts: env.repos.config.contracts(),
    grantedScopes: env.repos.config.integrations().filter((i) => i.status === "connected").flatMap((i) => [...i.scopes.read, ...i.scopes.write]),
  };
}

describe("Earned autonomy evidence", () => {
  it("measures verified outcomes, not just agreement, on the current fixtures", () => {
    const env = setup();
    const e = earnedAutonomy(env.repos, "retry_provisioning");
    expect(e).toMatchObject({ recommendationsReviewed: 50, approvedWithoutEdits: 48, executed: 50, verifiedSuccessful: 49, wrongActions: 1, failedExecutions: 0 });
    expect(e.verificationRate).toBeCloseTo(0.98);
    expect(e.wrongActionCaseIds).toEqual(["CS-10412"]);
    expect(e.verifiedCaseIds).not.toContain("CS-10412");
    expect(e.contracts).toEqual([{ id: "ctr_course_purchase", name: "Medical learning package purchase", executed: 50, verified: 49 }]);
    expect(e.amounts!.max).toBeLessThanOrEqual(5000);
  });

  it("keeps retry provisioning review-first while a wrong action is in the window", () => {
    const env = setup();
    const { eligibility } = assessAutonomy(env.repos);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.headline).toBe("Keep retry provisioning review-first");
    expect(eligibility.summary).toBe(
      "48 of the last 50 recommendations were approved without edits, but one executed action was later reversed. More verified outcomes without an incorrect action are required before Payment Integrity recommends automation.",
    );
    expect(eligibility.criteria.filter((c) => !c.met).map((c) => c.id)).toEqual(["no_wrong_actions"]);
    expect(eligibility.suggestion).toBeUndefined();
  });

  it("becomes eligible only when every criterion is met", () => {
    const env = setup();
    withoutWrongAction(env);
    const { eligibility } = assessAutonomy(env.repos);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.summary).toBe(
      "This action produced a verified outcome in 50 of the last 50 executed cases, with no known incorrect outcomes. Payment Integrity can recommend limited automation below ₹5,000 when investigation confidence is at least 95%.",
    );
    expect(eligibility.suggestion).toMatchObject({ contracts: [{ id: "ctr_course_purchase" }], maxValue: 5000, minimumConfidence: 0.95, requiredPermissions: ["grant_learning_access"] });
    expect(eligibility.suggestion!.alwaysReviewCaseTypes).toEqual(expect.arrayContaining(["duplicate_payment", "inventory_conflict"]));
  });

  it("never lets merchant approval alone unlock automation", () => {
    const env = setup();
    const base = earnedAutonomy(env.repos, "retry_provisioning");
    const allApproved: AutonomyEvidence = { ...base, approvedWithoutEdits: 50, executed: 0, verifiedSuccessful: 0, verificationRate: 0, wrongActions: 0, wrongActionCaseIds: [], contracts: [] };
    expect(evaluateAutonomyEligibility(allApproved, env.repos.config.globalControls(), context(env)).eligible).toBe(false);
  });

  it("does not count unverified or failed executions as success", () => {
    const env = setup();
    withoutWrongAction(env);
    const executions = env.repos.executions.list().filter((e) => e.action === "retry_provisioning").sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    env.repos.executions.save({ ...executions[0]!, status: "awaiting_outcome" });
    env.repos.executions.save({ ...executions[1]!, status: "failed" });
    const failedCase = env.repos.cases.get(executions[1]!.caseId)!;
    env.repos.cases.save({ ...failedCase, status: "escalated" });
    const { evidence, eligibility } = assessAutonomy(env.repos);
    expect(evidence.verifiedSuccessful).toBe(48);
    expect(evidence.awaitingVerificationCaseIds).toEqual([executions[0]!.caseId]);
    expect(evidence.failedCaseIds).toEqual([executions[1]!.caseId]);
    expect(evidence.unresolvedFailureCaseIds).toEqual([executions[1]!.caseId]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.criteria.filter((c) => !c.met).map((c) => c.id)).toEqual(["verified_success", "no_unresolved_failures"]);
  });

  it("blocks when exact matching is switched off or the action is review-only", () => {
    const env = setup();
    withoutWrongAction(env);
    const evidence = earnedAutonomy(env.repos, "retry_provisioning");
    const controls = { ...env.repos.config.globalControls(), neverActOnLowConfidenceMatch: false };
    expect(evaluateAutonomyEligibility(evidence, controls, context(env)).criteria.find((c) => c.id === "exact_match_required")!.met).toBe(false);
    const refund = evaluateAutonomyEligibility({ ...evidence, action: "refund_duplicate" }, env.repos.config.globalControls(), context(env));
    expect(refund.eligible).toBe(false);
    expect(refund.criteria.find((c) => c.id === "compatible_scope")!.detail).toBe("Refund duplicate is review-only.");
  });

  it("keeps suggested limits inside global controls", () => {
    const env = setup();
    withoutWrongAction(env);
    const evidence = earnedAutonomy(env.repos, "retry_provisioning");
    const controls = { ...env.repos.config.globalControls(), maxAutomaticValue: 2000, minimumConfidence: 0.97 };
    const result = evaluateAutonomyEligibility(evidence, controls, context(env));
    expect(result.suggestion).toMatchObject({ maxValue: 2000, minimumConfidence: 0.97 });
  });

  it("does not let the agent's explanation override ineligibility", async () => {
    const env = setup();
    const eager: AgentGateway = {
      ...env.agent,
      explainAutonomy: async () => ({ headline: "Safe to automate", explanation: "Approve it all.", risks: ["none"], suggestedMode: "automatic_below_threshold", suggestedMaxValue: 50_000, suggestedMinimumConfidence: 0.5 }),
    };
    const result = await explainEarnedAutonomy({ repos: env.repos, agent: eager }, "retry_provisioning", NOW, true);
    expect(result.eligibility.eligible).toBe(false);
    expect(result.suggestedMode).toBe("suggest_only");
    expect(result.suggestedMaxValue).toBe(5000);
    expect(result.suggestedMinimumConfidence).toBe(0.95);
    expect(env.repos.config.actionPolicies().find((p) => p.action === "retry_provisioning")!.mode).toBe("suggest_only");
  });

  it("switches on only with explicit confirmation of an eligible action, and audits it", () => {
    const env = setup();
    expect(() => switchOnEarnedAutomation(env.repos, "retry_provisioning", ACTORS.operator, NOW)).toThrow(ConfigurationError);
    expect(env.repos.config.actionPolicies().find((p) => p.action === "retry_provisioning")!.mode).toBe("suggest_only");

    withoutWrongAction(env);
    switchOnEarnedAutomation(env.repos, "retry_provisioning", ACTORS.operator, NOW);
    expect(env.repos.config.actionPolicies().find((p) => p.action === "retry_provisioning")!.mode).toBe("automatic_below_threshold");
    const entry = env.repos.audit.list().find((e) => e.action === "Switched on earned automation")!;
    expect(entry).toMatchObject({ actor: ACTORS.operator, targetId: "retry_provisioning", approvalSource: "merchant" });
    expect(entry.result).toContain("50 of 50 executed actions verified, 0 wrong");

    keepReviewFirst(env.repos, "retry_provisioning", ACTORS.operator, NOW);
    expect(env.repos.audit.list().some((e) => e.action === "Kept review-first")).toBe(true);
  });
});
