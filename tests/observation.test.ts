import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { addSeconds } from "@/domain/time";
import { escalate } from "@/services/decisions";
import { primaryMetrics } from "@/services/metrics/overview";
import { checkObservations, overdueObservations, promoteOverdueObservations } from "@/services/observation";
import { evaluateCase } from "@/services/policy/currentState";
import { NOW, setup } from "./helpers";

/** Moves the clock past the waiting case's deadline with fresh data. */
function pastDeadline(env: ReturnType<typeof setup>) {
  env.clock.set(addSeconds(env.waitingCase.deadline!, 1));
  env.store.sync(env.clock.now());
  return env.clock.now().toISOString();
}

describe("Observed cases past their deadline", () => {
  it("stay observed, with no action, until the contract deadline", () => {
    const env = setup();
    expect(env.waitingCase.status).toBe("observing");
    expect(overdueObservations(env.repos, NOW)).toEqual([]);
    expect(promoteOverdueObservations(env.repos, NOW)).toEqual([]);
  });

  it("become open missing-outcome cases once the deadline passes", () => {
    const env = setup();
    const before = primaryMetrics(env.repos, NOW).revenueAtRisk.value;
    const asOf = pastDeadline(env);
    expect(promoteOverdueObservations(env.repos, asOf)).toEqual([env.waitingCase.id]);

    const c = env.repos.cases.get(env.waitingCase.id)!;
    expect(c).toMatchObject({ status: "open", type: "missing_outcome", defaultOutcome: "customer_contact" });
    expect(env.repos.outcomes.integrityEvents({ caseId: c.id }).map((e) => e.type)).toEqual(expect.arrayContaining(["outcome.deadline_missed", "case.opened"]));
    expect(env.repos.audit.list().some((e) => e.caseId === c.id && e.action === "Opened case")).toBe(true);
    expect(primaryMetrics(env.repos, asOf).revenueAtRisk.value).toBe(before + c.amountAtRisk);
    // Promotion happens once.
    expect(promoteOverdueObservations(env.repos, asOf)).toEqual([]);
  });

  it("are not promoted while data is stale", () => {
    const env = setup();
    env.clock.set(addSeconds(env.waitingCase.deadline!, 1));
    expect(promoteOverdueObservations(env.repos, env.clock.now().toISOString())).toEqual([]);
    expect(env.repos.cases.get(env.waitingCase.id)!.status).toBe("observing");
  });

  it("are investigated and escalated to Marrow, because recovery would be blocked", async () => {
    const env = setup();
    const asOf = pastDeadline(env);
    expect(await checkObservations(env)).toEqual([env.waitingCase.id]);

    const c = env.repos.cases.get(env.waitingCase.id)!;
    expect(c.investigation?.likelyCause).toMatch(/stalled/);
    expect(c.investigationRun?.citationsRemoved).toEqual([]);
    expect(c.recommendation?.action).toBe("escalate");
    // Retrying is blocked: no membership scope, and Marrow reports the activation in progress.
    const retry = evaluateCase(env.repos, c, { ...c.recommendation!, action: "retry_provisioning" }, asOf);
    expect(retry.result).toBe("blocked");
    expect(retry.checks.filter((check) => check.status === "failed").map((check) => check.id)).toEqual(
      expect.arrayContaining(["permission_available", "outcome_still_missing"]),
    );

    escalate(env.repos, c.id, "Membership activation stuck at Marrow", ACTORS.operator, asOf);
    expect(env.repos.cases.get(c.id)).toMatchObject({ status: "escalated" });
  });

  it("finish an investigation interrupted after promotion", async () => {
    const env = setup();
    promoteOverdueObservations(env.repos, pastDeadline(env));
    expect(env.repos.cases.get(env.waitingCase.id)!.investigation).toBeUndefined();
    expect(await checkObservations(env)).toEqual([]);
    expect(env.repos.cases.get(env.waitingCase.id)!.recommendation?.action).toBe("escalate");
  });
});
