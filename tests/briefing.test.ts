import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatINR, sum } from "@/domain/money";
import { addSeconds, istToIso } from "@/domain/time";
import { FIXTURE_ANCHOR_DATE } from "@/fixtures/build";
import type { AgentGateway } from "@/services/agent/contracts";
import { reinvestigateCase, reinvestigateIncident, describeIncidentInvestigation } from "@/services/agent";
import { ESCALATION_PREPARED, healthStage } from "@/services/agent/progress";
import { incidentTotals } from "@/services/metrics/cases";
import { agentContribution, NO_USABLE_INVESTIGATION, WITHOUT_INVESTIGATION } from "@/services/views/agentContribution";
import { compareIncidentPriority, proactiveBriefing, type IncidentPriority } from "@/services/views/briefing";
import { incidentWorkspace } from "@/services/views/incidents";
import { NOW, setup } from "./helpers";

function withoutInvestigation(env: ReturnType<typeof setup>) {
  const { investigation, investigationRun, ...rest } = env.repos.incidents.get("INC-0017")!;
  void investigation;
  void investigationRun;
  env.repos.incidents.save(rest);
}

describe("Proactive briefing", () => {
  it("summarises one actionable incident from repository state", () => {
    const env = setup();
    const b = proactiveBriefing(env.repos, NOW);
    const totals = incidentTotals(env.incident, env.repos.cases.list());
    expect(b.state).toBe("action");
    expect(b.heading).toBe("Payment Integrity found one incident requiring a decision");
    expect(b.totalAtRisk).toBe(totals.remainingAtRisk);
    expect(b.totalAtRisk).toBe(182457);
    expect(b.featured).toMatchObject({ customers: 43, safe: { count: 38, value: 151962 }, held: 5, service: { healthy: true } });
    expect(b.body).toContain(`${formatINR(182457)} across 43 customers is at risk`);
    expect(b.body).toContain(`38 cases worth ${formatINR(151962)} are eligible for safe recovery`);
    expect(b.primaryAction).toEqual({ label: "Review 38 recoveries", target: { kind: "incident", incidentId: "INC-0017", section: "recovery" } });
    expect(b.secondaryActions[0]!.label).toBe("View investigation");
  });

  it("recomputes after the safe cases are recovered", () => {
    const env = setup();
    for (const c of env.safeCases) env.repos.cases.save({ ...c, status: "resolved" });
    const b = proactiveBriefing(env.repos, NOW);
    expect(b.totalAtRisk).toBe(30495);
    expect(b.featured).toMatchObject({ customers: 5, safe: { count: 0 }, held: 5 });
    expect(b.primaryAction?.label).toBe("Review 5 cases");
    expect(b.body).toContain("No cases are eligible for bulk recovery");
  });

  it("ranks multiple incidents deterministically and summarises the total", () => {
    const env = setup();
    const other = env.repos.incidents.get("INC-0014")!;
    env.repos.incidents.save({ ...other, status: "contained" });
    const b = proactiveBriefing(env.repos, NOW);
    expect(b.incidentCount).toBe(2);
    expect(b.heading).toBe("Payment Integrity found 2 incidents requiring a decision");
    expect(b.featured!.id).toBe("INC-0017");
    expect(b.secondaryActions.map((a) => a.label)).toContain("View all incidents");

    const base: IncidentPriority = { incidentId: "A", severityRank: 1, revenueAtRisk: 100, customers: 1, startedAt: "2026-01-01T00:00:00.000Z" };
    const sorted = [
      { ...base, incidentId: "old", startedAt: "2025-12-01T00:00:00.000Z" },
      { ...base, incidentId: "more-customers", customers: 9 },
      { ...base, incidentId: "more-revenue", revenueAtRisk: 900 },
      { ...base, incidentId: "critical", severityRank: 0 },
      { ...base, incidentId: "deadline", severityRank: 3, deadline: "2026-01-02T00:00:00.000Z" },
      base,
    ].sort(compareIncidentPriority);
    expect(sorted.map((p) => p.incidentId)).toEqual(["deadline", "critical", "more-revenue", "more-customers", "old", "A"]);
  });

  it("shows only symptoms while the investigation is in progress", () => {
    const env = setup();
    withoutInvestigation(env);
    const b = proactiveBriefing(env.repos, NOW);
    expect(b.state).toBe("investigating");
    expect(b.heading).toBe("Payment Integrity is investigating 43 successful payments with missing outcomes");
    expect(b.body).not.toMatch(/Likely cause|v2\.3|eligible/);
    expect(b.primaryAction?.label).toBe("View incident");
  });

  it("does not call recovery safe while the service is failing", () => {
    const env = setup();
    const b = proactiveBriefing(env.repos, istToIso(FIXTURE_ANCHOR_DATE, "14:15:00"));
    expect(b.state).toBe("service_unhealthy");
    expect(b.body).toContain("The enrolment service is still failing. Recovery is blocked until the service becomes healthy.");
    expect(b.body).not.toMatch(/safe recovery/);
    expect(b.primaryAction?.label).toBe("View incident");
  });

  it("leads with the blocker and offers no recovery while data is stale", () => {
    const env = setup();
    const b = proactiveBriefing(env.repos, addSeconds(NOW, 180));
    expect(b.state).toBe("blocked");
    expect(b.heading).toBe("Data is out of date");
    expect(b.primaryAction).toBeUndefined();
    expect(b.secondaryActions.every((a) => !/recover/i.test(a.label))).toBe(true);
  });

  it("requires manual review when the investigator is unavailable", () => {
    const env = setup();
    withoutInvestigation(env);
    env.store.setFlags({ ...env.repos.config.flags(), investigationAvailable: false });
    const b = proactiveBriefing(env.repos, NOW);
    expect(b.state).toBe("investigator_unavailable");
    expect(b.heading).toBe("Rules detected 43 payments with missing outcomes");
    expect(b.body).toContain("Automated root-cause investigation is unavailable, so the incident requires manual review.");
  });

  it("is calm when no incident needs action", () => {
    const env = setup();
    env.repos.incidents.save({ ...env.incident, status: "resolved" });
    const b = proactiveBriefing(env.repos, NOW);
    expect(b).toMatchObject({ state: "clear", heading: "No payment integrity incidents require action", incidentCount: 0, totalAtRisk: 0 });
    expect(b.secondaryActions).toEqual([{ label: "View resolved incidents", target: { kind: "incidents", filter: "resolved" } }]);
  });
});

describe("Why the agent was needed", () => {
  it("derives every figure from the run, hypotheses and recovery groups", () => {
    const env = setup();
    const c = agentContribution(env.repos, env.incident, NOW);
    const run = describeIncidentInvestigation(env.repos, "INC-0017", NOW)!;
    const byId = Object.fromEntries(c.metrics.map((m) => [m.id, m]));
    expect(c.state).toBe("valid");
    expect(byId.detected!.value).toBe(43);
    expect(byId.examined).toMatchObject({ value: run.eventsExamined, detail: `events across ${Object.keys(run.sources).length} connected sources` });
    expect(byId.causes).toMatchObject({ value: 4, detail: "1 supported, 3 ruled out, 0 inconclusive" });
    expect(byId.safe).toMatchObject({ value: 38, detail: `cases worth ${formatINR(151962)}` });
    expect(byId.held).toMatchObject({ value: 5, detail: "3 duplicate payments, 2 above the value limit" });
    expect(sum(byId.safe!.caseIds!.map((id) => env.repos.cases.get(id)!.amountAtRisk))).toBe(151962);
    expect(c.conclusion).toBe(WITHOUT_INVESTIGATION);
  });

  it("claims no AI success when the investigation is unusable", () => {
    const env = setup();
    env.repos.incidents.save({ ...env.incident, investigationRun: { ...describeIncidentInvestigation(env.repos, "INC-0017", NOW)!, status: "invalid" } });
    const c = agentContribution(env.repos, env.repos.incidents.get("INC-0017")!, NOW);
    expect(c).toMatchObject({ state: "failed", notice: NO_USABLE_INVESTIGATION });
    expect(c.conclusion).toBeUndefined();
    expect(c.metrics.map((m) => m.id)).not.toContain("safe");
  });

  it("drops the conclusion when no case is safe to recover in bulk", () => {
    const env = setup();
    for (const c of env.safeCases) env.repos.cases.save({ ...c, status: "resolved" });
    const c = agentContribution(env.repos, env.incident, NOW);
    expect(c.state).toBe("no_safe");
    expect(c.conclusion).toBeUndefined();
  });

  it("keeps incident figures out of the UI layer", () => {
    const dir = path.join(__dirname, "../src/ui");
    const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".tsx"));
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/1,82,457|1,51,962|30,495|\b373\b|\b416\b/);
    }
  });
});

describe("Observable investigation stages", () => {
  it("reports stages in order with counts from the investigation input", async () => {
    const env = setup();
    const stages: Array<{ step: string; status: string; detail: string }> = [];
    await reinvestigateIncident(env, "INC-0017", (s) => stages.push(s));
    expect(stages.map((s) => s.step)).toEqual(["gathering", "comparing", "checking_health", "validating", "preparing"]);
    const run = env.repos.incidents.get("INC-0017")!.investigationRun!;
    expect(stages[0]!.detail).toBe(`Collected ${run.eventsExamined} payment, webhook, merchant, observability and outcome receipt events from ${Object.keys(run.sources).length} sources.`);
    expect(stages[1]!.detail).toBe("Compared 43 cases for shared timing, service and outcome patterns.");
    expect(stages[2]!.detail).toMatch(/^Enrolment service recovered at \d\d:\d\d IST\.$/);
    expect(stages[3]!.detail).toBe(`Checked ${run.citationsChecked} citations against recorded events; none removed.`);
    expect(stages[4]!.detail).toBe("38 cases are eligible for recovery; 5 require individual review.");
    expect(run.stages).toEqual(stages);
  });

  it("words a failing service as failing", () => {
    expect(healthStage({ service: "enrolment-service", status: "down", since: NOW }, NOW).detail).toMatch(/^Enrolment service still failing since \d\d:\d\d IST\.$/);
  });

  it("counts removed citations", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const original = env.store.investigationResponse(c.id) as { evidenceIds: string[] };
    const agent: AgentGateway = { ...env.agent, investigateCase: async () => ({ ...original, evidenceIds: [...original.evidenceIds, "evt_invented"] }) };
    const stages: Array<{ step: string; detail: string }> = [];
    await reinvestigateCase({ ...env, agent }, c.id, (s) => stages.push(s));
    expect(stages.find((s) => s.step === "validating")!.detail).toMatch(/; 1 removed\.$/);
  });

  it("never reports a prepared recommendation after the investigator fails", async () => {
    for (const [status, investigateCase] of [
      ["unavailable", async () => { throw new Error("down"); }],
      ["invalid", async () => ({ nonsense: true })],
    ] as const) {
      const env = setup();
      const stages: Array<{ step: string; status: string; detail: string }> = [];
      const result = await reinvestigateCase({ ...env, agent: { ...env.agent, investigateCase } }, env.safeCases[0]!.id, (s) => stages.push(s));
      expect(result.status).toBe(status);
      expect(stages.find((s) => s.step === "gathering")!.status).toBe("complete");
      expect(stages.find((s) => s.step === "checking_health")!.status).toBe("complete");
      expect(stages.find((s) => s.step === "comparing")!.status).toBe("failed");
      expect(stages.find((s) => s.step === "validating")!.status).toBe(status === "unavailable" ? "skipped" : "failed");
      expect(stages.at(-1)).toEqual({ step: "preparing", status: "failed", detail: ESCALATION_PREPARED });
      expect(env.repos.cases.get(env.safeCases[0]!.id)!.recommendation!.origin).toBe("rule_fallback");
    }
  });

  it("exposes only observable facts, never model reasoning, in the disclosure", () => {
    const env = setup();
    const production = incidentWorkspace(env.repos, "INC-0017", NOW)!.investigation!.production!;
    expect(Object.keys(production).sort()).toEqual(
      ["at", "casesCompared", "citationsChecked", "citationsRemoved", "eventsExamined", "hypotheses", "result", "resultLabel", "serviceHealth", "sources", "stages"].sort(),
    );
    expect(JSON.stringify(production)).not.toMatch(/thinking|prompt|chain|scratch|token/i);
  });
});
