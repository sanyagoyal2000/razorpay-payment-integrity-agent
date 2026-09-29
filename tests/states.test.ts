import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { applyContainment } from "@/services/containment";
import { lookupPayment, NOT_FOUND_MESSAGE, normaliseOrderId, validateLookup } from "@/services/customerLookup";
import { approveAndStart, ExecutionError, runExecution } from "@/services/execution";
import { evaluateCase, STALE_AFTER_MS } from "@/services/policy/currentState";
import { overviewModel } from "@/services/views/overview";
import { systemStatus } from "@/services/views/systemStatus";
import { clockSleep, NOW, setup } from "./helpers";

function customerOf(env: ReturnType<typeof setup>, caseId: string) {
  const c = env.repos.cases.get(caseId)!;
  const payment = env.repos.payments.get(c.paymentId)!;
  return { phone: env.repos.payments.customer(c.customerId)!.phone, orderId: payment.merchantOrderId };
}

describe("Check my payment", () => {
  it("shows under review, then recovery in progress, then resolved as the case moves", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const who = customerOf(env, c.id);
    expect(lookupPayment(env.repos, who, NOW)).toMatchObject({ status: "under_review", message: "Your payment is safe. A specialist is reviewing the order before any further action." });
    applyContainment(env.repos, "INC-0017", "access_pending", ACTORS.operator, NOW);
    expect(lookupPayment(env.repos, who, NOW)).toMatchObject({ status: "recovery_in_progress", message: "We found your payment. Your access is being restored, and you will not be charged again." });
    const execution = approveAndStart(env, { caseId: c.id, action: "retry_provisioning", actor: ACTORS.operator, approvalSource: "merchant" });
    await runExecution(env, execution.id, { sleep: clockSleep(env.clock) });
    const resolved = lookupPayment(env.repos, who, env.clock.now().toISOString());
    expect(resolved.status).toBe("resolved");
    expect(resolved.message).toBe(`Your ₹${c.amountAtRisk.toLocaleString("en-IN")} payment was successful and your learning package access is now active.`);
  });

  it("requires the matching phone number and never reveals that the order exists", () => {
    const env = setup();
    const who = customerOf(env, env.safeCases[0]!.id);
    expect(lookupPayment(env.repos, { ...who, phone: "+91 90000 00000" }, NOW)).toEqual({ status: "not_found", message: NOT_FOUND_MESSAGE });
    expect(lookupPayment(env.repos, { ...who, orderId: "MR-9999999" }, NOW)).toEqual({ status: "not_found", message: NOT_FOUND_MESSAGE });
    expect(lookupPayment(env.repos, { phone: who.phone.replace(/\D/g, "").slice(-10), orderId: who.orderId.toLowerCase().replace("-", " ") }, NOW).status).toBe("under_review");
  });

  it("confirms healthy payments and explains second charges without internal detail", () => {
    const env = setup();
    const healthy = env.repos.payments.list().find((p) => p.status === "captured" && env.repos.outcomes.receiptForPayment(p.id)?.status === "confirmed" && !env.repos.cases.list().some((c) => c.paymentId === p.id))!;
    const phone = env.repos.payments.customer(healthy.customerId)!.phone;
    expect(lookupPayment(env.repos, { phone, orderId: healthy.merchantOrderId }, NOW).status).toBe("resolved");
    const dup = env.duplicateCases[0]!;
    const second = env.repos.payments.get(dup.relatedPaymentIds[0]!)!;
    const result = lookupPayment(env.repos, { phone: env.repos.payments.customer(dup.customerId)!.phone, orderId: second.merchantOrderId }, NOW);
    expect(result.status).toBe("under_review");
    for (const r of [result, lookupPayment(env.repos, customerOf(env, env.refusalCase.id), NOW), lookupPayment(env.repos, customerOf(env, env.lateAuthCase.id), NOW)]) {
      expect(JSON.stringify(r)).not.toMatch(/confidence|webhook|HTTP|policy|threshold|agent|inventory|%/i);
    }
  });

  it("validates input before looking anything up", () => {
    expect(validateLookup("12345", "abc")).toEqual({ phone: expect.any(String), orderId: expect.any(String) });
    expect(validateLookup("+91 98765 43210", "mr 4301232")).toEqual({});
    expect(normaliseOrderId(" mr4301232 ")).toBe("MR-4301232");
  });
});

describe("Stale data and dependency failures", () => {
  it("blocks consequential actions when data is stale, and allows them after a refresh", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    env.clock.advance(STALE_AFTER_MS / 1000 + 1);
    const asOf = env.clock.now().toISOString();
    const verdict = evaluateCase(env.repos, c, c.recommendation!, asOf);
    expect(verdict.result).toBe("blocked");
    expect(verdict.checks.find((x) => x.id === "data_fresh")!.status).toBe("failed");
    expect(() => approveAndStart(env, { caseId: c.id, action: "retry_provisioning", actor: ACTORS.operator, approvalSource: "merchant" })).toThrow(ExecutionError);
    expect(systemStatus(env.repos, asOf).map((n) => n.id)).toEqual(["stale"]);
    expect(env.store.sync(env.clock.now())).toBe(true);
    expect(evaluateCase(env.repos, c, c.recommendation!, asOf).result).toBe("requires_approval");
  });

  it("explains a system-wide block once instead of flagging every case", () => {
    const env = setup();
    const before = overviewModel(env.repos, NOW).attention.length;
    env.clock.advance(STALE_AFTER_MS / 1000 + 1);
    const asOf = env.clock.now().toISOString();
    const model = overviewModel(env.repos, asOf);
    expect(model.incidents[0]!.requiredDecision).toBe("None until the data is refreshed");
    expect(model.attention.length).toBe(before);
  });

  it("cannot refresh while the data feed is down", () => {
    const env = setup();
    env.repos.config.saveFlags({ ...env.repos.config.flags(), dataFeedAvailable: false });
    env.clock.advance(STALE_AFTER_MS / 1000 + 1);
    expect(env.store.sync(env.clock.now())).toBe(false);
    expect(systemStatus(env.repos, env.clock.now().toISOString())[0]!.description).toMatch(/^Last successful update/);
  });

  it("shows each degraded dependency with the specified wording", () => {
    const env = setup();
    env.repos.config.saveFlags({ ...env.repos.config.flags(), outcomeVerificationAvailable: false, investigationAvailable: false, policyServiceAvailable: false });
    const notices = systemStatus(env.repos, NOW);
    expect(notices.map((n) => n.id)).toEqual(["outcome_verification", "policy_service", "investigation"]);
    expect(notices[0]!.description).toBe("Merchant outcome verification is temporarily unavailable. No recovery actions will be executed until the connection is restored.");
    expect(notices[2]!.description).toMatch(/^Automated investigation unavailable\. Deterministic detection remains active\./);
  });
});

describe("No open incidents", () => {
  it("resolves the incident once every case is closed, leaving Overview with no active incidents", async () => {
    const env = setup();
    const { approveBulk, runExecutions } = await import("@/services/execution");
    const { rejectRecommendation } = await import("@/services/decisions");
    const { executions } = approveBulk(env, env.incidentCases.map((c) => c.id), ACTORS.operator);
    await runExecutions(env, executions.map((e) => e.id), { sleep: clockSleep(env.clock) });
    env.store.sync(env.clock.now());
    for (const c of [...env.duplicateCases, ...env.highValueCases]) {
      rejectRecommendation(env.repos, c.id, "Handled directly by Marrow support", ACTORS.operator, env.clock.now().toISOString());
    }
    const asOf = env.clock.now().toISOString();
    expect(env.repos.incidents.get("INC-0017")!.status).toBe("resolved");
    const model = overviewModel(env.repos, asOf);
    expect(model.incidents).toEqual([]);
    expect(model.metrics.openIncidents.value).toBe(0);
  });
});
