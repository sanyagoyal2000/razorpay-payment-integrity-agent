import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { addSeconds, istToIso } from "@/domain/time";
import { FIXTURE_ANCHOR_DATE } from "@/fixtures/build";
import { setIntegrationConnected, setWriteAuthority } from "@/services/configuration";
import { approveAndStart, ExecutionError } from "@/services/execution";
import { earnedAutonomy } from "@/services/metrics/autonomy";
import { primaryMetrics } from "@/services/metrics/overview";
import { proactiveBriefing } from "@/services/views/briefing";
import {
  decisionSummary,
  evidenceCounts,
  incidentSectionHref,
  parseIncidentTab,
  recommendationReasons,
  recoveryAuthority,
  recoveryConfidence,
} from "@/services/views/incidentDecision";
import { AUTOMATION_EVIDENCE_HREF, incidentWorkspace, recoveryFacts } from "@/services/views/incidents";
import { groupEvidence } from "@/services/views/evidence";
import { NOW, setup } from "./helpers";

const source = (file: string) => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");

/** The JSX between one TabPanel's opening tag and the next TabPanel. */
function panel(page: string, value: string): string {
  const start = page.indexOf(`<TabPanel value="${value}">`);
  expect(start, value).toBeGreaterThan(0);
  const end = page.indexOf("</TabPanel>", start);
  return page.slice(start, end);
}

describe("Incident tabs", () => {
  const page = source("ui/incidents/IncidentWorkspacePage.tsx");

  it("defaults to Decision and reads the tab from the URL", () => {
    expect(parseIncidentTab(null)).toBe("decision");
    expect(parseIncidentTab("nonsense")).toBe("decision");
    expect(parseIncidentTab("investigation")).toBe("investigation");
    expect(parseIncidentTab("evidence")).toBe("evidence");
    expect(page).toMatch(/useSearchParams\(\)/);
    expect(page).toMatch(/parseIncidentTab\(searchParams\.get\("tab"\)\)/);
    expect(page).toMatch(/router\.push\(/);
  });

  it("links open the tab that holds the section", () => {
    expect(incidentSectionHref("INC-0017", "investigation")).toBe("/payment-integrity/incidents/INC-0017?tab=investigation#investigation");
    expect(incidentSectionHref("INC-0017", "recovery")).toBe("/payment-integrity/incidents/INC-0017#recovery");
    expect(incidentSectionHref("INC-0017", "evidence")).toBe("/payment-integrity/incidents/INC-0017?tab=evidence#evidence");
    expect(page).toMatch(/onInvestigate=\{\(\) => selectTab\("investigation"\)\}/);
  });

  it("keeps the full evidence and timeline on Evidence & history, not on Decision", () => {
    const decision = panel(page, "decision");
    const evidence = panel(page, "evidence");
    for (const heavy of ["<EvidenceSection", "<HistorySection", "<InvestigationPanel", "<ContextAuthorityView"]) expect(decision).not.toContain(heavy);
    expect(evidence).toContain("<EvidenceSection");
    expect(evidence).toContain("<HistorySection");
    expect(evidence).toContain("audit-log?incident=");
    for (const primary of ["<DecisionSummary", "<WhatHappened", "<RecoverySection", "<ContainmentSection"]) expect(decision).toContain(primary);
    const investigation = panel(page, "investigation");
    for (const part of ["<WhyRayRecommends", "<InvestigationPanel", "<UncertaintiesPanel", "<AuthoritySummary", "Ask RAY"]) expect(investigation).toContain(part);
    expect(page).toMatch(/isLazy/);
  });
});

describe("Decision summary", () => {
  it("answers what happened, what is at risk and what is recommended, from state", () => {
    const env = setup();
    const s = decisionSummary(env.repos, env.incident, NOW, new Date(NOW));
    expect(s).toMatchObject({
      headline: "43 customers paid but do not have course access",
      atRisk: "₹1,82,457 is at risk.",
      cause: "The enrolment service failed after deployment v2.3 and has now recovered.",
      recommendation: "Retry enrolment for 38 customers worth ₹1,51,962. 5 cases are excluded for individual review.",
      safeCount: 38,
    });
    expect(s.status[0]).toMatch(/^Started /);
    expect(s.status.some((p) => p.startsWith("Service recovered"))).toBe(true);

    const early = decisionSummary(env.repos, env.incident, istToIso(FIXTURE_ANCHOR_DATE, "14:15:00"), new Date(NOW));
    expect(early.cause).toMatch(/is still failing\.$/);
    expect(early.safeCount).toBe(0);
  });
});

describe("Why RAY recommends this", () => {
  it("states only what the evidence and eligibility support", () => {
    const env = setup();
    const reasons = recommendationReasons(env.repos, env.incident, NOW);
    expect(reasons.map((r) => r.text)).toEqual([
      "All 43 payments were captured by Razorpay.",
      "Webhooks reached LearnLoop for every payment.",
      "Enrolment failed for 43 payments after deployment v2.3.",
      "The enrolment service has recovered.",
      "The 38 safe cases have an exact payment-to-order match.",
      "3 duplicate payments and 2 high-value cases are excluded for individual review.",
    ]);
    const ids = new Set(env.repos.payments.list().flatMap((p) => [...env.repos.payments.events(p.id).map((e) => e.id), ...env.repos.payments.deliveriesForPayment(p.id).map((d) => d.id)]));
    expect(reasons.find((r) => r.id === "captured")!.evidenceIds.every((id) => ids.has(id))).toBe(true);

    const before = recommendationReasons(env.repos, env.incident, istToIso(FIXTURE_ANCHOR_DATE, "14:15:00"));
    expect(before.find((r) => r.id === "health")!.text).toBe("The enrolment service is still failing, so recovery waits.");
    expect(before.some((r) => r.id === "match")).toBe(false);
  });

  it("keeps the fixed-rule and investigator figures behind 'See how RAY investigated'", () => {
    const why = source("ui/incidents/WhyRayRecommends.tsx");
    expect(why).toContain("See how RAY investigated");
    expect(why).toContain("<ContributionDetails");
    const env = setup();
    const byId = Object.fromEntries(incidentWorkspace(env.repos, "INC-0017", NOW)!.contribution.metrics.map((m) => [m.id, m.value]));
    expect(byId).toMatchObject({ detected: 43, causes: 4, safe: 38, held: 5 });
  });
});

describe("Authority for this recovery", () => {
  it("derives the summary from the contract and integration permissions", () => {
    const env = setup();
    expect(recoveryAuthority(env.repos, env.incident, NOW).summary).toEqual([
      "Read access to 3 connected sources",
      "Retry enrolment requires merchant approval",
      "Refund duplicate is not permitted",
    ]);
    setIntegrationConnected(env.repos, "learnloop_enrolment", false, ACTORS.operator, NOW);
    setIntegrationConnected(env.repos, "learnloop_enrolment", true, ACTORS.operator, NOW);
    expect(recoveryAuthority(env.repos, env.incident, NOW).summary[1]).toBe("Retry enrolment is not permitted");
    setWriteAuthority(env.repos, "learnloop_enrolment", true, ACTORS.operator, NOW);
    expect(recoveryAuthority(env.repos, env.incident, NOW).summary[1]).toBe("Retry enrolment requires merchant approval");
  });

  it("keeps the full permission matrix on Agent details", () => {
    expect(source("ui/agent/AgentDetailsPage.tsx")).toContain("<ContextAuthorityView");
    expect(source("ui/incidents/AuthoritySummary.tsx")).not.toContain("<ContextAuthorityView");
  });
});

describe("Confidence, approval and automatic execution", () => {
  it("derives investigation confidence and the automatic threshold independently", () => {
    const env = setup();
    const base = recoveryConfidence(env.repos, env.incident, NOW);
    expect(base).toMatchObject({ investigation: 0.93, automaticThreshold: 0.95, mode: "Suggest only" });
    expect(base.explanation).toMatch(/^Automatic execution requires 95% confidence.*You may approve this recovery because all mandatory policy checks pass for these 38 cases\. Policy is checked again before execution\.$/);

    const controls = env.repos.config.globalControls();
    env.repos.config.saveGlobalControls({ ...controls, minimumConfidence: 0.97 });
    expect(recoveryConfidence(env.repos, env.incident, NOW)).toMatchObject({ investigation: 0.93, automaticThreshold: 0.97 });

    env.repos.incidents.save({ ...env.incident, investigation: { ...env.incident.investigation!, confidence: 0.99 } });
    expect(recoveryConfidence(env.repos, env.repos.incidents.get("INC-0017")!, NOW)).toMatchObject({ investigation: 0.99, automaticThreshold: 0.97 });
  });

  it("shows the real blocking reason, and approval never bypasses a failed check", () => {
    const env = setup();
    const stale = addSeconds(NOW, 180);
    expect(recoveryConfidence(env.repos, env.incident, stale).explanation).toMatch(/^Blocked by policy: /);
    env.clock.set(stale);
    expect(() => approveAndStart(env, { caseId: env.safeCases[0]!.id, action: "retry_provisioning", actor: ACTORS.operator, approvalSource: "merchant" })).toThrow(ExecutionError);
  });
});

describe("Recovery plan and learning", () => {
  it("keeps four facts visible and failure behaviour one click away", () => {
    const env = setup();
    const facts = recoveryFacts(env.repos, env.incident, ["safe"], NOW);
    expect(facts.facts).toEqual(["38 customers · ₹1,51,962", "Retry enrolment once for each payment", "No customer message will be sent", "Success requires course_access_granted"]);
    expect(facts.ifItFails).toHaveLength(5);
    expect(facts.learning).toBe("Verified outcomes from this recovery will update retry enrolment automation eligibility.");
    expect(AUTOMATION_EVIDENCE_HREF).toBe("/payment-integrity/automations#earned-autonomy");
  });

  it("never counts approval agreement as a verified outcome", () => {
    const env = setup();
    const e = earnedAutonomy(env.repos, "retry_provisioning");
    expect(e.approvedWithoutEdits).toBe(48);
    expect(e.verifiedSuccessful).toBe(49);
    expect(e.verifiedCaseIds).not.toContain("CS-10412");
  });
});

describe("Evidence counts", () => {
  it("reports distinct counts without adjusting them to match", () => {
    const env = setup();
    const counts = evidenceCounts(env.repos, env.incident, NOW, groupEvidence(env.repos, env.incident.investigation!.evidenceIds))!;
    expect(counts).toEqual({ eventsAnalysed: 373, citationsValidated: 30, keyEventsShown: 19, connectedSources: 3 });
  });
});

describe("Metric scopes", () => {
  it("uses the whole open portfolio on Overview and the incident in the briefing", () => {
    const env = setup();
    const metrics = primaryMetrics(env.repos, NOW);
    expect(metrics.revenueAtRisk.value).toBe(189_955);
    expect(metrics.revenueAtRisk.caseIds).toHaveLength(45);
    expect(proactiveBriefing(env.repos, NOW).body).toContain("₹1,82,457 across 43 customers is at risk in INC-0017.");
    expect(source("ui/overview/PrimaryMetrics.tsx")).toContain("Revenue at risk across all open cases");
    expect(source("ui/overview/ValueDelivered.tsx")).toContain("Verified business impact (last 30 days)");
  });
});
