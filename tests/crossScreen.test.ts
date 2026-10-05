import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { sum } from "@/domain/money";
import { addSeconds, istToIso } from "@/domain/time";
import { FIXTURE_ANCHOR_DATE } from "@/fixtures/build";
import { describeCaseInvestigation } from "@/services/agent";
import { automationSummary, runAutomaticActions } from "@/services/automation";
import { applyContainment, notificationPreview } from "@/services/containment";
import { saveContract, contractToForm, ConfigurationError } from "@/services/configuration";
import { caseInvestigationFreshness } from "@/services/investigation/freshness";
import { agentLifecycle } from "@/services/lifecycle";
import { incidentTotals } from "@/services/metrics/cases";
import { primaryMetrics, valueDelivered, wrongActionRate } from "@/services/metrics/overview";
import {
  caseCounts,
  exposureOf,
  openCasesByContract,
  pendingApprovalCaseIds,
  productClaims,
  productOverlaps,
  resolvedMetrics,
} from "@/services/metrics/selectors";
import { checkObservations } from "@/services/observation";
import { evaluateCase } from "@/services/policy/currentState";
import { caseDetail, caseRows } from "@/services/views/cases";
import { contractRows, integrationRows } from "@/services/views/configuration";
import { failureWindow } from "@/services/views/incidents";
import { attentionRows, attentionSummary, overviewModel } from "@/services/views/overview";
import { approveBulk, runExecution } from "@/services/execution";
import { clockSleep, setup } from "./helpers";

type Env = ReturnType<typeof setup>;

/** Every cross-screen invariant, checked at the env's current time. */
function assertInvariants(env: Env) {
  const asOf = env.clock.now().toISOString();
  const { repos } = env;

  // Overview attention: the heading counts exactly the rows shown.
  const rows = attentionRows(repos, asOf);
  const summary = attentionSummary(rows);
  expect(summary.decisions + summary.observing).toBe(rows.length);
  expect(summary.heading).toContain(`${summary.decisions} ${summary.decisions === 1 ? "case needs" : "cases need"}`);

  // Approvals waiting = open cases with a recommendation that needs approval.
  const counts = caseCounts(repos, asOf);
  const pending = pendingApprovalCaseIds(repos, asOf);
  expect(counts.pendingApproval).toBe(pending.length);
  const lifecycle = agentLifecycle(repos, asOf);
  if (lifecycle.state === "awaiting_approval") {
    expect([...lifecycle.caseIds].sort()).toEqual([...pending].sort());
    expect(lifecycle.reason).toContain(`${counts.pendingApproval} of ${counts.open} open cases`);
  }

  // Open cases per contract sum to total open cases, on every screen that shows either.
  const metrics = primaryMetrics(repos, asOf);
  const contracts = contractRows(repos, asOf);
  expect(sum(contracts.map((c) => c.openCases))).toBe(counts.open);
  expect(sum([...openCasesByContract(repos).values()].map((ids) => ids.length))).toBe(counts.open);
  expect(metrics.revenueAtRisk.caseIds).toHaveLength(counts.open);
  expect(metrics.exposure.caseCount).toBe(counts.open);
  expect(caseRows(repos, asOf).filter((r) => ["open", "review_required", "approved", "executing", "escalated"].includes(r.status))).toHaveLength(counts.open);

  // Incident customers = notification recipients + documented exclusions.
  for (const incident of repos.incidents.list().filter((i) => i.status !== "resolved")) {
    const totals = incidentTotals(incident, repos.cases.list());
    const { audience } = notificationPreview(repos, incident);
    expect(audience.customers).toBe(totals.customersAtRisk);
    expect(audience.recipients + audience.optedOut + audience.alreadyContacted).toBe(audience.customers);
    expect(audience.label).toMatch(new RegExp(`^${audience.recipients} of ${audience.customers}`));
  }

  // Resolved, contacts and executed figures come from nested sets of the same records and window.
  const resolved = resolvedMetrics(repos, asOf);
  const value = valueDelivered(repos, asOf);
  const wrong = wrongActionRate(repos, asOf);
  expect(resolved.beforeContact.length).toBe(resolved.contactsAvoided.length + resolved.refundsPrevented.length);
  expect(resolved.valueCounted.length).toBe(resolved.beforeContact.length + resolved.afterCustomerContact.length);
  expect(resolved.verified.length).toBe(resolved.verifiedByAction.length + resolved.verifiedOnArrival.length);
  expect(resolved.executedActions.length).toBe(resolved.verifiedByAction.length + resolved.reversedActions.length);
  expect(metrics.resolvedBeforeContact.value).toBe(resolved.beforeContact.length);
  expect(metrics.resolvedSplit).toEqual({ contactsAvoided: value.supportContactsAvoided.value, refundsPrevented: value.avoidableRefundsPrevented.value });
  expect(value.gmvResolvedBeforeRefundOrDispute.caseIds).toEqual(resolved.valueCounted);
  // "One estimated contact per case" holds literally.
  expect(value.supportContactsAvoided.value).toBe(value.supportContactsAvoided.caseIds.length);
  expect(wrong.executed).toEqual(resolved.executedActions);

  // No product appears in two active contracts.
  expect(productOverlaps(repos)).toEqual([]);

  // A case reads the same on Overview and on the Cases list.
  const byId = new Map(caseRows(repos, asOf).map((r) => [r.id, r]));
  for (const row of rows) expect(row.type).toBe(byId.get(row.caseId)!.typeLabel);
}

describe("cross-screen invariants", () => {
  it("hold on the seeded data", () => {
    const env = setup();
    assertInvariants(env);
    const asOf = env.clock.now().toISOString();
    expect(caseCounts(env.repos, asOf)).toMatchObject({ open: 45, pendingApproval: 44, observing: 1 });
    expect(attentionSummary(attentionRows(env.repos, asOf)).heading).toBe("7 cases need an individual decision · 1 is being observed");
    const resolved = resolvedMetrics(env.repos, asOf);
    expect([resolved.beforeContact.length, resolved.contactsAvoided.length, resolved.refundsPrevented.length, resolved.valueCounted.length, resolved.afterCustomerContact.length]).toEqual([67, 65, 2, 71, 4]);
    expect([resolved.executedActions.length, resolved.reversedActions.length]).toEqual([70, 1]);
  });

  it("keep holding as the simulation runs: deadlines pass, automatic actions run and new purchases arrive", async () => {
    const env = setup();
    for (let minute = 0; minute < 15; minute += 1) {
      env.clock.advance(60);
      env.store.sync(env.clock.now());
      await checkObservations(env);
      runAutomaticActions(env, env.clock.now().toISOString());
      assertInvariants(env);
    }
    const asOf = env.clock.now().toISOString();
    // CS-10530 crossed its deadline and is now a missing outcome on every screen at once.
    const waiting = env.repos.cases.get(env.waitingCase.id)!;
    expect(waiting.type).toBe("missing_outcome");
    expect(attentionRows(env.repos, asOf).find((r) => r.caseId === waiting.id)?.type).toBe("Missing outcome");
    expect(caseRows(env.repos, asOf).find((r) => r.id === waiting.id)?.typeLabel).toBe("Missing outcome");
    expect(caseCounts(env.repos, asOf)).toMatchObject({ open: 46, observing: 0 });
  });

  it("hold after notifying customers and after resolving the 38 safe cases", async () => {
    const env = setup();
    const asOf = env.clock.now().toISOString();
    applyContainment(env.repos, "INC-0017", "notify_customers", ACTORS.operator, asOf);
    const { audience } = notificationPreview(env.repos, env.incident);
    expect(audience).toMatchObject({ customers: 43, recipients: 0, optedOut: 1, alreadyContacted: 42 });
    assertInvariants(env);
    env.store.sync(env.clock.now());
    const { executions } = approveBulk(env, env.safeCases.map((c) => c.id), ACTORS.operator);
    for (const e of executions) await runExecution(env, e.id, { sleep: clockSleep(env.clock), pollMs: 1000 });
    expect(env.safeCases.every((c) => env.repos.cases.get(c.id)!.status === "resolved")).toBe(true);
    assertInvariants(env);
    expect(incidentTotals(env.incident, env.repos.cases.list()).remainingAtRisk).toBe(30_495);
  });
});

describe("1. Observation crossing its deadline", () => {
  it("measures the delay now, not at detection, and is linked to the Membership activation contract", () => {
    const env = setup();
    const asOf = env.clock.now().toISOString();
    const detail = caseDetail(env.repos, env.waitingCase.id, asOf)!;
    expect(detail.contract.id).toBe("ctr_membership_activation");
    expect(detail.contract.expectedOutcome).toBe("membership_activated");
    // Captured 14:23:31, now 14:25:41: 130 s, above the 96 s 95th percentile.
    expect(detail.observation).toMatchObject({ delaySeconds: 130, withinNormalRange: false, deadlinePassed: false });
  });

  it("says the deadline passed while it waits for fresh data to promote", () => {
    const env = setup();
    env.clock.set(addSeconds(env.waitingCase.deadline!, 30));
    const row = attentionRows(env.repos, env.clock.now().toISOString()).find((r) => r.caseId === env.waitingCase.id)!;
    expect(row.reason).toMatch(/^Contract deadline passed/);
  });
});

describe("2. Distinct, labelled counts", () => {
  it("words approvals against open cases", () => {
    const env = setup();
    expect(agentLifecycle(env.repos, env.clock.now().toISOString()).reason).toBe("44 of 45 open cases have a recommendation waiting for your approval.");
  });

  it("documents the one customer excluded from the incident notification", () => {
    const env = setup();
    expect(notificationPreview(env.repos, env.incident).audience.label).toBe("42 of 43 · 1 opted out of email");
  });
});

describe("3. Failure time versus case-opened time", () => {
  it("shows every INC-0017 failure happened before recovery, though cases opened after it", () => {
    const env = setup();
    const window = failureWindow(env.repos, env.incident, env.clock.now().toISOString());
    expect(window.failuresAfterRecovery).toBe(0);
    expect(window.lastFailureAt! < window.recoveredAt!).toBe(true);
    expect(window.lastCaseOpenedAt! > window.recoveredAt!).toBe(true);
    expect(window.summary).toBe("Last failure 14:18:24 IST, before recovery at 14:18:40 IST; cases opened up to 14:20:23 IST as their 2-minute deadlines passed. No failures after recovery.");
    for (const id of ["CS-10522", "CS-10523", "CS-10524", "CS-10525", "CS-10526", "CS-10527"]) {
      const row = caseRows(env.repos, env.clock.now().toISOString()).find((r) => r.id === id)!;
      expect(row.failedAt! < window.recoveredAt!).toBe(true);
    }
  });
});

describe("4. Stale investigations", () => {
  it("dates a fixture investigation no earlier than the recovery event it cites", () => {
    const env = setup();
    const c = env.repos.cases.get("CS-10489")!;
    const run = describeCaseInvestigation(env.repos, c, env.clock.now().toISOString())!;
    expect(run.serviceHealth?.status).toBe("healthy");
    expect(caseInvestigationFreshness(env.repos, c, run, env.clock.now().toISOString())?.stale).toBe(false);
  });

  it("marks an investigation stale when service health changed after it ran", () => {
    const env = setup();
    const asOf = env.clock.now().toISOString();
    const c = env.repos.cases.get("CS-10489")!;
    const ranAt = istToIso(FIXTURE_ANCHOR_DATE, "14:16:00");
    const run = { ...describeCaseInvestigation(env.repos, c, asOf)!, at: ranAt, serviceHealth: { service: "learning-access-service", status: "down" as const } };
    env.repos.cases.save({ ...c, investigationRun: run });
    const detail = caseDetail(env.repos, c.id, asOf)!;
    expect(detail.investigationFreshness).toMatchObject({ stale: true, ranAt, changedAt: istToIso(FIXTURE_ANCHOR_DATE, "14:18:40") });
    expect(detail.investigationFreshness?.changes).toEqual(["Learning Access Service recovered after the investigation ran."]);
  });
});

describe("5. Duplicate accounting", () => {
  it("keeps case, payment and customer counts distinct and the second charges separate", () => {
    const env = setup();
    const exposure = exposureOf(env.repos, env.incidentCases);
    expect(exposure).toMatchObject({ caseCount: 43, paymentCount: 46, customerCount: 43, amountAtRisk: 182_457, duplicateCharges: 10_497, duplicateChargeCount: 3 });
    expect(overviewModel(env.repos, env.clock.now().toISOString()).metrics.exposure.duplicateCharges).toBe(10_497);
  });
});

describe("7. Confidence thresholds", () => {
  it("names the threshold and its source next to the confidence", () => {
    const env = setup();
    const dup = env.duplicateCases[0]!;
    const verdict = evaluateCase(env.repos, dup, dup.recommendation!, env.clock.now().toISOString());
    expect(verdict.checks.find((c) => c.id === "confidence_threshold")?.explanation).toBe("Action confidence 90% is below the threshold · required ≥95% (contract and global).");
  });
});

describe("8. Automatic escalation", () => {
  it("runs the escalations policy allows, and the banner and Slack integration reflect it", () => {
    const env = setup();
    const asOf = env.clock.now().toISOString();
    env.store.sync(env.clock.now());
    const before = automationSummary(env.repos, asOf);
    expect(before.headline).toBe("1 action can run automatically (Escalate)");
    // The last automatic run was a retry 16 days ago, before retries became suggest-only; no escalation has run.
    expect(before.lastRunAt! < asOf).toBe(true);
    expect(integrationRows(env.repos, asOf).find((i) => i.id === "incident_management")?.lastSuccessfulEventAt).toBeUndefined();
    expect(before.eligibleNow).toEqual([env.refusalCase.id]);

    expect(runAutomaticActions(env, asOf).map((r) => r.caseId)).toEqual([env.refusalCase.id]);
    expect(env.repos.cases.get(env.refusalCase.id)!.status).toBe("escalated");
    const after = automationSummary(env.repos, asOf);
    expect(after.lastRunCaseId).toBe(env.refusalCase.id);
    expect(integrationRows(env.repos, asOf).find((i) => i.id === "incident_management")?.lastSuccessfulEventAt).toBe(asOf);
    // Nothing that needs approval ran.
    expect(env.repos.executions.list().filter((e) => e.approvalSource === "policy_automatic" && e.startedAt === asOf)).toEqual([]);
    expect(runAutomaticActions(env, asOf)).toEqual([]);
  });

  it("runs nothing while automation is paused", () => {
    const env = setup();
    env.store.sync(env.clock.now());
    env.repos.config.saveGlobalControls({ ...env.repos.config.globalControls(), automationPaused: true });
    expect(runAutomaticActions(env, env.clock.now().toISOString())).toEqual([]);
  });
});

describe("9. Contracts and products", () => {
  it("rejects saving an active contract that claims another active contract's product", () => {
    const env = setup();
    const course = env.repos.config.contract("ctr_course_purchase")!;
    expect(productClaims(env.repos, course.id).get("prd_plus_membership")?.contractName).toBe("Membership activation");
    const form = { ...contractToForm(course), productScope: [...course.productScope, "prd_plus_membership"] };
    expect(() => saveContract(env.repos, form, ACTORS.operator, env.clock.now().toISOString(), course.id)).toThrow(ConfigurationError);
    // A draft may list it; the check applies when it becomes active.
    expect(() => saveContract(env.repos, { ...form, status: "draft" }, ACTORS.operator, env.clock.now().toISOString(), course.id)).not.toThrow();
  });
});
