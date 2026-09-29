import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { sum } from "@/domain/money";
import { applyContainment, containmentOptions, engineeringIncident, monitoringProgress } from "@/services/containment";
import { customerStatus } from "@/services/customerStatus";
import { approveBulk, runExecutions } from "@/services/execution";
import { incidentTotals } from "@/services/metrics/cases";
import { groupEvidence, resolveEvidence } from "@/services/views/evidence";
import {
  DEFAULT_INCIDENT_FILTERS,
  describeIncidentFilters,
  filterIncidents,
  incidentRows,
  incidentWorkspace,
  recoveryPlan,
} from "@/services/views/incidents";
import { overviewModel, requiredDecision } from "@/services/views/overview";
import { clockSleep, NOW, setup } from "./helpers";

describe("Overview model", () => {
  it("reconciles every figure with the cases behind it", () => {
    const env = setup();
    const model = overviewModel(env.repos, NOW);
    const amount = (ids: string[]) => sum(ids.map((id) => env.repos.cases.get(id)!.amountAtRisk));
    expect(model.metrics.revenueAtRisk.value).toBe(amount(model.metrics.revenueAtRisk.caseIds));
    expect(model.metrics.revenueAtRisk.value).toBe(182_457 + 4_999 + 2_499);
    expect(model.incidents).toHaveLength(1);
    expect(model.incidents[0]).toMatchObject({ id: "INC-0017", revenueAtRisk: 182_457, affectedCustomers: 43 });
    expect(model.incidents[0]!.requiredDecision).toBe("Approve recovery for 38 cases (₹1,51,962); review 5 more individually");
  });

  it("lists cases needing attention, with the waiting case marked as needing no action", () => {
    const env = setup();
    const rows = overviewModel(env.repos, NOW).attention;
    const types = rows.map((r) => r.type);
    expect(types.filter((t) => t === "Late authorisation")).toHaveLength(1);
    expect(types.filter((t) => t === "Duplicate payment")).toHaveLength(3);
    expect(rows.filter((r) => r.type === "Missing outcome")).toHaveLength(2);
    expect(types).toContain("Inventory conflict");
    const waiting = rows.find((r) => r.type === "Delayed processing")!;
    expect(waiting.attentionRequired).toBe(false);
    expect(waiting.reason).toMatch(/within the normal range/);
    expect(rows.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("groups bursts of activity into single entries", () => {
    const env = setup();
    const activity = overviewModel(env.repos, NOW).activity;
    const blocked = activity.find((a) => a.category === "Action blocked" && a.incidentId === "INC-0017")!;
    expect(blocked.count).toBeGreaterThan(1);
    expect(activity.some((a) => a.category === "Incident created")).toBe(true);
  });
});

describe("Incidents list", () => {
  it("filters by state, severity, contract, date and amount", () => {
    const env = setup();
    const rows = incidentRows(env.repos);
    expect(filterIncidents(rows, DEFAULT_INCIDENT_FILTERS)).toHaveLength(3);
    expect(filterIncidents(rows, { ...DEFAULT_INCIDENT_FILTERS, state: "open" }).map((r) => r.id)).toEqual(["INC-0017"]);
    expect(filterIncidents(rows, { ...DEFAULT_INCIDENT_FILTERS, state: "resolved" })).toHaveLength(2);
    expect(filterIncidents(rows, { ...DEFAULT_INCIDENT_FILTERS, severities: ["low"] }).map((r) => r.id)).toEqual(["INC-0011"]);
    expect(filterIncidents(rows, { ...DEFAULT_INCIDENT_FILTERS, contractIds: ["ctr_membership_activation"] })).toHaveLength(1);
    expect(filterIncidents(rows, { ...DEFAULT_INCIDENT_FILTERS, amount: "over_1l" }).map((r) => r.id)).toEqual(["INC-0017"]);
    expect(filterIncidents(rows, { ...DEFAULT_INCIDENT_FILTERS, from: "2026-06-15", to: "2026-06-15" }).map((r) => r.id)).toEqual(["INC-0017"]);
    const none = { ...DEFAULT_INCIDENT_FILTERS, state: "resolved" as const, severities: ["critical" as const] };
    expect(filterIncidents(rows, none)).toHaveLength(0);
    expect(describeIncidentFilters(none, (id) => id)).toEqual(["Resolved incidents", "Severity: critical"]);
  });
});

describe("Incident workspace", () => {
  it("shows only evidence that resolves to a recorded event, including the v2.3 deploy", () => {
    const env = setup();
    const workspace = incidentWorkspace(env.repos, "INC-0017", NOW)!;
    const shown = workspace.evidence.flatMap((g) => g.items.map((i) => i.id));
    expect(shown).toHaveLength(new Set(env.incident.investigation!.evidenceIds).size);
    expect(workspace.evidence.map((g) => g.label)).toEqual([
      "Deployment",
      "Service errors",
      "Payment captures",
      "Webhook deliveries",
      "Fulfilment failures",
      "Missing Outcome Receipts",
      "Service recovery",
      "Successful post-recovery outcomes",
      "Similar case sequences",
    ]);
    expect(workspace.evidence[0]!.items[0]!.title).toBe("deploy.completed v2.3 · enrolment-service");
    expect(resolveEvidence(env.repos, "evt_does_not_exist")).toBeUndefined();
    expect(groupEvidence(env.repos, ["evt_does_not_exist"])).toEqual([]);
  });

  it("previews only bulk-eligible cases in the recovery plan", () => {
    const env = setup();
    const safe = recoveryPlan(env.repos, env.incident, ["safe"], NOW);
    expect(safe).toMatchObject({ customers: 38, revenueAddressed: 151_962, excluded: [] });
    const all = recoveryPlan(env.repos, env.incident, ["safe", "duplicate_review", "high_value"], NOW);
    expect(all.revenueAddressed).toBe(151_962);
    expect(all.excluded).toHaveLength(5);
    const duplicatesOnly = recoveryPlan(env.repos, env.incident, ["duplicate_review"], NOW);
    expect(duplicatesOnly.eligibleCaseIds).toHaveLength(0);
    expect(duplicatesOnly.excluded.every((e) => e.reason === "Duplicate payments need individual review")).toBe(true);
  });

  it("updates the required decision, history and evidence after recovery", async () => {
    const env = setup();
    const { executions } = approveBulk(env, env.incidentCases.map((c) => c.id), ACTORS.operator);
    await runExecutions(env, executions.map((e) => e.id), { sleep: clockSleep(env.clock) });
    const asOf = env.clock.now().toISOString();
    const incident = env.repos.incidents.get("INC-0017")!;
    expect(requiredDecision(env.repos, incident, asOf)).toBe("Review 5 cases individually");
    const workspace = incidentWorkspace(env.repos, "INC-0017", asOf)!;
    expect(workspace.history[0]!.change).toMatch(/38 customer outcomes verified/);
    expect(workspace.history.some((h) => /Approved retry enrolment for 38 cases \(₹1,51,962\)/.test(h.change))).toBe(true);
    const activity = overviewModel(env.repos, asOf).activity;
    expect(activity.find((a) => a.category === "Outcome verified")!.count).toBe(38);
    expect(activity.find((a) => a.category === "Case resolved")!.count).toBe(38);
    const receipts = workspace.evidence.find((g) => g.label === "Missing Outcome Receipts")!;
    expect(receipts.items).toHaveLength(3);
    expect(receipts.items[0]!.detail).toMatch(/confirmed later/);
  });
});

describe("Containment", () => {
  it("require review turns off bulk recovery for every open case in the incident", () => {
    const env = setup();
    applyContainment(env.repos, "INC-0017", "require_review", ACTORS.operator, NOW);
    const groups = incidentWorkspace(env.repos, "INC-0017", NOW)!.groups;
    expect(groups.find((g) => g.id === "safe")).toBeUndefined();
    expect(sum(groups.map((g) => g.value))).toBe(182_457);
    expect(recoveryPlan(env.repos, env.incident, ["individual_review", "duplicate_review", "high_value"], NOW).eligibleCaseIds).toHaveLength(0);
    expect(env.repos.incidents.get("INC-0017")!.status).toBe("contained");
    expect(requiredDecision(env.repos, env.repos.incidents.get("INC-0017")!, NOW)).toBe("Review 43 cases individually");
  });

  it("access pending changes what affected customers see", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    expect(customerStatus(env.repos, c).status).toBe("under_review");
    applyContainment(env.repos, "INC-0017", "access_pending", ACTORS.operator, NOW);
    expect(customerStatus(env.repos, env.repos.cases.get(c.id)!)).toMatchObject({
      status: "recovery_in_progress",
      message: "We found your payment. Your access is being restored, and you will not be charged again.",
    });
    expect(customerStatus(env.repos, env.refusalCase).status).toBe("under_review");
  });

  it("monitoring counts purchases that arrive after the decision, up to 50", () => {
    const env = setup();
    applyContainment(env.repos, "INC-0017", "monitor_next_purchases", ACTORS.operator, NOW);
    const incident = () => env.repos.incidents.get("INC-0017")!;
    const horizon = env.repos.scheduled.horizon();
    expect(monitoringProgress(env.repos, incident(), NOW, horizon)).toMatchObject({ observed: 0, confirmed: 0, complete: false });
    env.clock.advance(15 * 60);
    const partial = monitoringProgress(env.repos, incident(), env.clock.now().toISOString(), horizon)!;
    expect(partial.observed).toBeGreaterThan(5);
    expect(partial.observed).toBeLessThan(50);
    env.clock.advance(3 * 3600);
    expect(monitoringProgress(env.repos, incident(), env.clock.now().toISOString(), horizon)).toMatchObject({ observed: 50, confirmed: 50, complete: true });
  });

  it("tracks the engineering incident it creates", () => {
    const env = setup();
    applyContainment(env.repos, "INC-0017", "engineering_incident", ACTORS.operator, NOW);
    expect(engineeringIncident(env.repos.incidents.get("INC-0017")!)).toEqual({ reference: "INC-0017-ENG", openedAt: NOW, status: "Open" });
  });

  it("notifies each affected customer once and records the decision", () => {
    const env = setup();
    const decision = applyContainment(env.repos, "INC-0017", "notify_customers", ACTORS.operator, NOW);
    // One affected customer opted out of email: 42 are notified and the opt-out is recorded, not contacted.
    expect(decision.caseIds).toHaveLength(42);
    expect(decision.detail).toContain("1 opted out of email and was not contacted");
    const notContacted = env.repos.cases.forIncident("INC-0017").filter((c) => c.customerContact !== "notified");
    expect(notContacted).toHaveLength(1);
    expect(env.repos.payments.customer(notContacted[0]!.customerId)!.emailOptOut).toBe(true);
    expect(env.repos.audit.forIncident("INC-0017").at(-1)).toMatchObject({ action: "Notify affected customers", actor: ACTORS.operator });
    const option = containmentOptions(env.repos, env.repos.incidents.get("INC-0017")!, NOW).find((o) => o.action === "notify_customers")!;
    expect(option.decision).toBeDefined();
    expect(() => applyContainment(env.repos, "INC-0017", "notify_customers", ACTORS.operator, NOW)).toThrow();
  });

  it("does not count merchant notifications as customer contact", () => {
    const env = setup();
    const before = overviewModel(env.repos, NOW).value.supportContactsAvoided.value;
    applyContainment(env.repos, "INC-0017", "notify_customers", ACTORS.operator, NOW);
    expect(overviewModel(env.repos, NOW).value.supportContactsAvoided.value).toBe(before);
  });

  it("blocks customer messages when the kill switch is on", () => {
    const env = setup();
    env.repos.config.saveGlobalControls({ ...env.repos.config.globalControls(), automationPaused: true });
    const option = containmentOptions(env.repos, env.incident, NOW).find((o) => o.action === "notify_customers")!;
    expect(option.unavailableReason).toMatch(/paused/);
  });

  it("never changes payments", () => {
    const env = setup();
    const statuses = env.repos.payments.list().map((p) => p.status);
    for (const action of ["access_pending", "require_review", "engineering_incident", "monitor_next_purchases"] as const) {
      applyContainment(env.repos, "INC-0017", action, ACTORS.operator, NOW);
    }
    expect(env.repos.payments.list().map((p) => p.status)).toEqual(statuses);
    expect(incidentTotals(env.repos.incidents.get("INC-0017")!, env.repos.cases.list()).remainingAtRisk).toBe(182_457);
  });
});
