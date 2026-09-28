import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { sum } from "@/domain/money";
import { approveBulk, runExecution } from "@/services/execution";
import { incidentTotals, isAtRisk, toIncident } from "@/services/metrics/cases";
import { primaryMetrics, valueDelivered } from "@/services/metrics/overview";
import { groupIncidentCases, planBulkRecovery } from "@/services/recovery/groups";
import { earnedAutonomy } from "@/services/metrics/autonomy";
import { clockSleep, setup } from "./helpers";

type Env = ReturnType<typeof setup>;

function amountOf(env: Env, caseIds: readonly string[]): number {
  return sum(caseIds.map((id) => env.repos.cases.get(id)!.amountAtRisk));
}

/** Every displayed aggregate must equal the sum of the cases behind it. */
function assertReconciles(env: Env) {
  const asOf = env.clock.now().toISOString();
  const all = env.repos.cases.list();
  const metrics = primaryMetrics(env.repos, asOf);
  expect(metrics.revenueAtRisk.value).toBe(amountOf(env, metrics.revenueAtRisk.caseIds));
  expect(metrics.revenueAtRisk.value).toBe(sum(all.filter(isAtRisk).map((c) => c.amountAtRisk)));
  expect(metrics.customersAffected.value).toBe(new Set(metrics.customersAffected.caseIds.map((id) => env.repos.cases.get(id)!.customerId)).size);

  for (const record of env.repos.incidents.list()) {
    const totals = incidentTotals(record, all);
    const own = all.filter((c) => c.incidentId === record.id);
    expect(totals.initialAmountAtRisk).toBe(sum(own.map((c) => c.amountAtRisk)));
    expect(totals.remainingAtRisk).toBe(amountOf(env, totals.openCaseIds));
    expect(totals.resolvedAmount).toBe(amountOf(env, totals.resolvedCaseIds));
    expect(toIncident(record, all).amountAtRisk).toBe(totals.remainingAtRisk);
    const groups = groupIncidentCases(env.repos, record.id, asOf);
    expect(sum(groups.map((g) => g.value))).toBe(totals.remainingAtRisk);
    for (const group of groups) expect(group.value).toBe(amountOf(env, group.caseIds));
  }

  const value = valueDelivered(env.repos, asOf);
  expect(value.gmvResolvedBeforeRefundOrDispute.value).toBe(amountOf(env, value.gmvResolvedBeforeRefundOrDispute.caseIds));
  expect(value.avoidableRefundsPrevented.amount).toBe(amountOf(env, value.avoidableRefundsPrevented.caseIds));
  expect(value.avoidableRefundsPrevented.value).toBe(value.avoidableRefundsPrevented.caseIds.length);
  expect(value.supportContactsAvoided.value).toBe(value.supportContactsAvoided.caseIds.length);
  for (const id of value.gmvResolvedBeforeRefundOrDispute.caseIds) {
    expect(["auto_refund", "customer_contact"]).toContain(env.repos.cases.get(id)!.defaultOutcome);
  }
}

describe("aggregate reconciliation", () => {
  it("reconciles before any recovery", () => {
    const env = setup();
    assertReconciles(env);
    const totals = incidentTotals(env.incident, env.repos.cases.list());
    expect(totals.initialAmountAtRisk).toBe(182_457);
    expect(totals.remainingAtRisk).toBe(182_457);
    expect(totals.affectedCustomers).toBe(43);
    expect(totals.refundExposure).toBe(10_497);
    const groups = groupIncidentCases(env.repos, "INC-0017", env.clock.now().toISOString());
    expect(groups.map((g) => [g.id, g.caseIds.length, g.value, g.policy])).toEqual([
      ["safe", 38, 151_962, "Eligible after approval"],
      ["duplicate_review", 3, 10_497, "Manual review"],
      ["high_value", 2, 19_998, "Approval required"],
    ]);
  });

  it("never includes duplicate or high-value cases in bulk recovery", () => {
    const env = setup();
    const plan = planBulkRecovery(env.repos, env.incidentCases.map((c) => c.id), env.clock.now().toISOString());
    expect(plan.eligible).toHaveLength(38);
    expect(plan.value).toBe(151_962);
    expect(plan.eligible.some((c) => c.type === "duplicate_payment" || c.amountAtRisk > 5000)).toBe(false);
    expect(plan.excluded.map((e) => e.caseId).sort()).toEqual([...env.duplicateCases, ...env.highValueCases].map((c) => c.id).sort());
  });

  it("reconciles after the 38 safe cases are resolved: ₹30,495 remains and the incident is contained", async () => {
    const env = setup();
    const before = primaryMetrics(env.repos, env.clock.now().toISOString());
    const valueBefore = valueDelivered(env.repos, env.clock.now().toISOString());

    const { executions } = approveBulk(env, env.incidentCases.map((c) => c.id), ACTORS.operator);
    expect(executions).toHaveLength(38);
    for (const execution of executions) {
      expect((await runExecution(env, execution.id, { sleep: clockSleep(env.clock) })).status).toBe("resolved");
    }

    assertReconciles(env);
    const asOf = env.clock.now().toISOString();
    const incident = env.repos.incidents.get("INC-0017")!;
    const totals = incidentTotals(incident, env.repos.cases.list());
    expect(totals.initialAmountAtRisk).toBe(182_457);
    expect(totals.resolvedAmount).toBe(151_962);
    expect(totals.remainingAtRisk).toBe(30_495);
    expect(incident.status).toBe("contained");
    expect(env.repos.incidents.updates("INC-0017").at(-1)).toMatchObject({ exposure: 30_495, caseCount: 43 });

    const after = primaryMetrics(env.repos, asOf);
    expect(before.revenueAtRisk.value - after.revenueAtRisk.value).toBe(151_962);
    expect(before.customersAffected.value - after.customersAffected.value).toBe(38);
    const valueAfter = valueDelivered(env.repos, asOf);
    expect(valueAfter.gmvResolvedBeforeRefundOrDispute.value - valueBefore.gmvResolvedBeforeRefundOrDispute.value).toBe(151_962);
    expect(valueAfter.supportContactsAvoided.value - valueBefore.supportContactsAvoided.value).toBe(38);
  });
});

describe("earned autonomy", () => {
  it("is computed from merchant decisions, not stated", () => {
    const env = setup();
    expect(earnedAutonomy(env.repos, "retry_provisioning")).toMatchObject({ considered: 50, approvedWithoutEdits: 48 });
  });
});
