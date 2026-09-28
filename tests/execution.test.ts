import { describe, expect, it } from "vitest";
import { ACTORS, type Execution } from "@/domain/types";
import {
  advanceExecution,
  approveAndStart,
  EXECUTION_STATES,
  ExecutionError,
  runExecution,
} from "@/services/execution";
import { idempotencyKey } from "@/services/policy/currentState";
import { memoryPersistence } from "@/repositories/store";
import { createAppServices } from "@/services/container";
import { clockSleep, fixtures, setup } from "./helpers";

const approve = (caseId: string, action: Parameters<typeof approveAndStart>[1]["action"] = "retry_provisioning") => ({
  caseId,
  action,
  actor: ACTORS.operator,
  approvalSource: "merchant" as const,
});

describe("execution state machine", () => {
  it("runs through every state and resolves only after the outcome is verified", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const started = approveAndStart(env, approve(c.id));
    expect(env.repos.cases.get(c.id)!.status).toBe("approved");

    const finished = await runExecution(env, started.id, { sleep: clockSleep(env.clock) });
    expect(finished.status).toBe("resolved");
    expect(finished.steps.map((s) => s.state)).toEqual(EXECUTION_STATES);

    const resolved = env.repos.cases.get(c.id)!;
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution).toMatchObject({ method: "approved_recovery", action: "retry_provisioning" });
    const receipt = env.repos.outcomes.receiptForPayment(c.paymentId)!;
    expect(receipt.status).toBe("confirmed");
    const granted = env.repos.outcomes.receipt(receipt.id)!.outcomeEventId!;
    expect(env.repos.outcomes.events(env.repos.payments.get(c.paymentId)!.merchantOrderId).find((e) => e.id === granted)?.type).toBe("course_access_granted");

    const actions = env.repos.audit.forCase(c.id).map((e) => e.action);
    for (const action of ["Approved recovery", "Re-checked policy before execution", "Retry enrolment: request sent", "Verified outcome", "Resolved case"]) {
      expect(actions).toContain(action);
    }
  });

  it("does not resolve while the outcome is pending", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    let execution: Execution = approveAndStart(env, approve(c.id));
    for (let i = 0; i < 5; i += 1) execution = advanceExecution(env, execution.id);
    expect(execution.status).toBe("awaiting_outcome");
    expect(advanceExecution(env, execution.id).status).toBe("awaiting_outcome");
    expect(env.repos.cases.get(c.id)!.status).toBe("executing");
  });

  it("prevents duplicate execution for the same payment and action", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const first = approveAndStart(env, approve(c.id));
    expect(() => approveAndStart(env, approve(c.id))).toThrow(ExecutionError);

    // A second execution record for the same key, as if two approvals raced.
    const racing: Execution = { ...first, id: "exe_race", steps: [first.steps[0]!] };
    env.repos.executions.save(racing);
    advanceExecution(env, first.id);
    advanceExecution(env, racing.id);
    advanceExecution(env, first.id);
    const raced = advanceExecution(env, racing.id);
    expect(raced.status).toBe("stopped");
    expect(raced.failure).toBe("duplicate_execution");

    await runExecution(env, first.id, { sleep: clockSleep(env.clock) });
    const order = env.repos.payments.get(c.paymentId)!.merchantOrderId;
    const grants = env.repos.outcomes.events(order).filter((e) => e.type === "course_access_granted");
    expect(grants).toHaveLength(1);
    expect(env.repos.executions.withKey(idempotencyKey(c.paymentId, "retry_provisioning")).filter((e) => e.status === "resolved")).toHaveLength(1);
  });

  it("stops if the case changed after approval", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const execution = approveAndStart(env, approve(c.id));
    const current = env.repos.cases.get(c.id)!;
    env.repos.cases.save({ ...current, customerContact: "customer_initiated" });
    const stopped = advanceExecution(env, execution.id);
    expect(stopped.status).toBe("stopped");
    expect(stopped.failure).toBe("case_changed");
    expect(env.repos.outcomes.events(env.repos.payments.get(c.paymentId)!.merchantOrderId).some((e) => e.metadata?.["initiatedBy"] === "payment_integrity")).toBe(false);
  });

  it("re-checks policy before acting: the kill switch stops an approved execution", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const execution = approveAndStart(env, approve(c.id));
    env.repos.config.saveGlobalControls({ ...env.repos.config.globalControls(), automationPaused: true });
    const stopped = advanceExecution(env, execution.id);
    expect(stopped.status).toBe("stopped");
    expect(stopped.failure).toBe("policy_blocked");
    expect(env.repos.cases.get(c.id)!.status).toBe("open");
    expect(env.repos.audit.forCase(c.id).at(-1)!.action).toBe("Stopped execution");
  });

  it("refuses to approve an action blocked by policy", () => {
    const env = setup();
    expect(() => approveAndStart(env, approve(env.refusalCase.id))).toThrow(/blocked by policy/);
    expect(env.repos.cases.get(env.refusalCase.id)!.status).toBe("review_required");
  });

  it("refuses automatic execution unless policy allows it", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    expect(() => approveAndStart(env, { ...approve(c.id), actor: ACTORS.policy, approvalSource: "policy_automatic" })).toThrow(ExecutionError);
  });

  it("escalates when the outcome is not verified within the contract deadline", async () => {
    const env = setup();
    const silentMerchant = { fulfil: () => ({ accepted: true, responseCode: 202, eventIds: [] }) };
    const deps = { ...env, merchant: silentMerchant };
    const c = env.safeCases[0]!;
    const execution = approveAndStart(deps, approve(c.id));
    const finished = await runExecution(deps, execution.id, { sleep: clockSleep(env.clock), pollMs: 10_000 });
    expect(finished.status).toBe("failed");
    expect(finished.failure).toBe("outcome_not_verified");
    expect(env.repos.cases.get(c.id)!.status).toBe("escalated");
    expect(env.repos.outcomes.receiptForPayment(c.paymentId)!.status).toBe("missing");
  });

  it("captures a late authorisation, then verifies access", async () => {
    const env = setup();
    const c = env.lateAuthCase;
    const execution = approveAndStart(env, approve(c.id, "capture"));
    const finished = await runExecution(env, execution.id, { sleep: clockSleep(env.clock) });
    expect(finished.status).toBe("resolved");
    expect(env.repos.payments.get(c.paymentId)!.status).toBe("captured");
    expect(env.repos.outcomes.receiptForPayment(c.paymentId)!.status).toBe("confirmed");
  });

  it("persists state so a reload shows the same result", async () => {
    const persistence = memoryPersistence();
    const env = setup({ persistence });
    const c = env.safeCases[0]!;
    const execution = approveAndStart(env, approve(c.id));
    await runExecution(env, execution.id, { sleep: clockSleep(env.clock) });

    const reloaded = createAppServices(fixtures, env.clock, persistence);
    expect(reloaded.repos.cases.get(c.id)!.status).toBe("resolved");
    expect(reloaded.repos.executions.get(execution.id)!.status).toBe("resolved");
    expect(reloaded.repos.audit.list().length).toBe(env.repos.audit.list().length);
    expect(reloaded.store.offsetMinutes).toBe(env.store.offsetMinutes);
  });
});
