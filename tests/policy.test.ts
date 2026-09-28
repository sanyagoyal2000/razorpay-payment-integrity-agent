import { describe, expect, it } from "vitest";
import type { IntegrityCase, Recommendation } from "@/domain/types";
import { istToIso } from "@/domain/time";
import { FIXTURE_ANCHOR_DATE } from "@/fixtures/build";
import { evaluatePolicy } from "@/services/policy/evaluatePolicy";
import { buildCurrentState, evaluateCase } from "@/services/policy/currentState";
import { NOW, setup } from "./helpers";

const checkStatus = (verdict: ReturnType<typeof evaluatePolicy>, id: string) => verdict.checks.find((c) => c.id === id)?.status;

function fulfilment(c: IntegrityCase): Recommendation {
  return { ...c.recommendation!, action: "retry_provisioning" };
}

describe("policy engine", () => {
  it("makes safe incident cases eligible for bulk approval after the service recovers", () => {
    const { repos, safeCases } = setup();
    for (const c of safeCases) {
      const verdict = evaluateCase(repos, c, c.recommendation!, NOW);
      expect(verdict.result).toBe("requires_approval");
      expect(verdict.approvalScope).toBe("bulk");
      expect(verdict.checks.every((check) => check.status === "passed")).toBe(true);
    }
  });

  it("shows every spec check for a retry", () => {
    const { repos, safeCases } = setup();
    const verdict = evaluateCase(repos, safeCases[0]!, safeCases[0]!.recommendation!, NOW);
    const labels = verdict.checks.map((c) => c.label);
    for (const label of [
      "Payment captured",
      "Payment not refunded",
      "Outcome still missing",
      "No successful duplicate",
      "Enrolment service healthy",
      "Idempotency key available",
      "Amount within limit",
      "Permission available",
    ]) {
      expect(labels).toContain(label);
    }
  });

  it("blocks recovery while the enrolment service is down", () => {
    const { repos, safeCases } = setup();
    const during = istToIso(FIXTURE_ANCHOR_DATE, "14:12:00");
    const c = safeCases.find((x) => x.detectedAt < during)!;
    const verdict = evaluateCase(repos, c, c.recommendation!, during);
    expect(verdict.result).toBe("blocked");
    expect(checkStatus(verdict, "fulfilment_service_healthy")).toBe("failed");
  });

  it("requires individual approval for high-value cases", () => {
    const { repos, highValueCases } = setup();
    for (const c of highValueCases) {
      const verdict = evaluateCase(repos, c, c.recommendation!, NOW);
      expect(verdict.result).toBe("requires_approval");
      expect(verdict.approvalScope).toBe("individual");
      expect(checkStatus(verdict, "amount_within_limit")).toBe("failed");
    }
  });

  it("requires individual review for duplicate payments", () => {
    const { repos, duplicateCases } = setup();
    for (const c of duplicateCases) {
      expect(c.recommendation!.action).toBe("review_duplicate");
      const verdict = evaluateCase(repos, c, c.recommendation!, NOW);
      expect(verdict.result).toBe("requires_approval");
      expect(verdict.approvalScope).toBe("individual");
      expect(checkStatus(verdict, "no_successful_duplicate")).toBe("failed");
    }
  });

  it("blocks fulfilment of the inventory-conflict case and recommends human review", () => {
    const { repos, refusalCase } = setup();
    expect(refusalCase.recommendation!.action).toBe("escalate");
    const verdict = evaluateCase(repos, refusalCase, fulfilment(refusalCase), NOW);
    expect(verdict.result).toBe("blocked");
    expect(checkStatus(verdict, "payment_captured")).toBe("passed");
    expect(checkStatus(verdict, "payment_not_refunded")).toBe("passed");
    expect(checkStatus(verdict, "inventory_unchanged")).toBe("failed");
    expect(checkStatus(verdict, "replacement_inventory")).toBe("unknown");
    expect(evaluateCase(repos, refusalCase, refusalCase.recommendation!, NOW).result).toBe("allowed");
  });

  it("requires approval to capture a late authorisation before its deadline, and blocks after", () => {
    const { repos, lateAuthCase } = setup();
    const verdict = evaluateCase(repos, lateAuthCase, lateAuthCase.recommendation!, NOW);
    expect(verdict.result).toBe("requires_approval");
    expect(verdict.approvalScope).toBe("individual");
    const payment = repos.payments.get(lateAuthCase.paymentId)!;
    const afterDeadline = new Date(Date.parse(payment.captureDeadline!) + 1000).toISOString();
    const late = evaluateCase(repos, lateAuthCase, lateAuthCase.recommendation!, afterDeadline);
    expect(late.result).toBe("blocked");
    expect(checkStatus(late, "capture_deadline")).toBe("failed");
  });

  it("recommends nothing for the waiting case", () => {
    const { waitingCase } = setup();
    expect(waitingCase.status).toBe("observing");
    expect(waitingCase.recommendation).toBeUndefined();
  });

  it("blocks execution when the kill switch is on but still allows escalation", () => {
    const { repos, safeCases, refusalCase } = setup();
    repos.config.saveGlobalControls({ ...repos.config.globalControls(), automationPaused: true });
    const verdict = evaluateCase(repos, safeCases[0]!, safeCases[0]!.recommendation!, NOW);
    expect(verdict.result).toBe("blocked");
    expect(checkStatus(verdict, "kill_switch")).toBe("failed");
    expect(evaluateCase(repos, refusalCase, refusalCase.recommendation!, NOW).result).toBe("allowed");
  });

  it("blocks actions outside the granted permission scope", () => {
    const { repos, safeCases, duplicateCases } = setup();
    const refund = { ...duplicateCases[0]!.recommendation!, action: "refund_duplicate" as const };
    const refundVerdict = evaluateCase(repos, duplicateCases[0]!, refund, NOW);
    expect(refundVerdict.result).toBe("blocked");
    expect(checkStatus(refundVerdict, "permission_available")).toBe("failed");

    const enrolment = repos.config.integration("learnloop_enrolment")!;
    repos.config.saveIntegration({ ...enrolment, status: "revoked" });
    const verdict = evaluateCase(repos, safeCases[0]!, safeCases[0]!.recommendation!, NOW);
    expect(verdict.result).toBe("blocked");
    expect(checkStatus(verdict, "permission_available")).toBe("failed");
  });

  it("allows automatic execution only in automatic mode within thresholds", () => {
    const { repos, safeCases, highValueCases } = setup();
    const policy = repos.config.actionPolicies().find((p) => p.action === "retry_provisioning")!;
    repos.config.saveActionPolicy({ ...policy, mode: "automatic_below_threshold" });
    expect(evaluateCase(repos, safeCases[0]!, safeCases[0]!.recommendation!, NOW).result).toBe("allowed");
    expect(evaluateCase(repos, highValueCases[0]!, highValueCases[0]!.recommendation!, NOW).result).toBe("requires_approval");
    repos.config.saveActionPolicy({ ...policy, mode: "disabled" });
    expect(evaluateCase(repos, safeCases[0]!, safeCases[0]!.recommendation!, NOW).result).toBe("blocked");
  });

  it("requires individual approval below the confidence threshold", () => {
    const { repos, safeCases } = setup();
    const c = safeCases[0]!;
    const verdict = evaluateCase(repos, c, { ...c.recommendation!, confidence: 0.8 }, NOW);
    expect(verdict.result).toBe("requires_approval");
    expect(verdict.approvalScope).toBe("individual");
    expect(checkStatus(verdict, "confidence_threshold")).toBe("failed");
  });

  it("blocks refunded payments and outcomes that already arrived", () => {
    const { repos, safeCases } = setup();
    const c = safeCases[0]!;
    const state = buildCurrentState(repos, c, "retry_provisioning", NOW);
    const refunded = evaluatePolicy(c, c.recommendation!, { ...state, payment: { ...state.payment, status: "refunded" } });
    expect(refunded.result).toBe("blocked");
    expect(checkStatus(refunded, "payment_not_refunded")).toBe("failed");
    const completed = evaluatePolicy(c, c.recommendation!, { ...state, outcome: { state: "completed" } });
    expect(completed.result).toBe("blocked");
    expect(checkStatus(completed, "outcome_still_missing")).toBe("failed");
  });

  it("blocks every action when the policy service or outcome verification is unavailable", () => {
    const { repos, safeCases } = setup();
    const c = safeCases[0]!;
    repos.config.saveFlags({ ...repos.config.flags(), outcomeVerificationAvailable: false });
    expect(checkStatus(evaluateCase(repos, c, c.recommendation!, NOW), "outcome_verification_available")).toBe("failed");
    repos.config.saveFlags({ ...repos.config.flags(), outcomeVerificationAvailable: true, policyServiceAvailable: false });
    const verdict = evaluateCase(repos, c, c.recommendation!, NOW);
    expect(verdict.result).toBe("blocked");
    expect(verdict.checks[0]!.id).toBe("policy_service_available");
  });

  it("is deterministic", () => {
    const { repos, safeCases } = setup();
    const c = safeCases[0]!;
    const state = buildCurrentState(repos, c, "retry_provisioning", NOW);
    expect(evaluatePolicy(c, c.recommendation!, state)).toEqual(evaluatePolicy(c, c.recommendation!, structuredClone(state)));
  });
});
