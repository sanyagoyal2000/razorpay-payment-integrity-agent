import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { addSeconds } from "@/domain/time";
import { setActionMode } from "@/services/configuration";
import { approveAndStart, ExecutionError } from "@/services/execution";
import { collapseAll, EVIDENCE_GROUPS, expandAll, initialExpansion, setGroupExpanded } from "@/services/views/evidence";
import { merchantIntent, outcomeLabel, reasonsSourceSummary, recommendationReasons, recoveryConfidence, recoveryModeView, selectedActionConfidence } from "@/services/views/incidentDecision";
import { incidentWorkspace } from "@/services/views/incidents";
import { NOW, setup } from "./helpers";

const source = (file: string) => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");

describe("P0.1 Three confidence concepts", () => {
  it("takes diagnosis confidence from the incident investigation", () => {
    const env = setup();
    expect(recoveryConfidence(env.repos, env.incident, NOW).investigation).toBe(env.incident.investigation!.confidence);
    env.repos.incidents.save({ ...env.incident, investigation: { ...env.incident.investigation!, confidence: 0.81 } });
    expect(recoveryConfidence(env.repos, env.repos.incidents.get("INC-0017")!, NOW).investigation).toBe(0.81);
  });

  it("uses the minimum confidence across selected, eligible cases, and follows the selection", () => {
    const env = setup();
    const safe = selectedActionConfidence(env.repos, env.incident, ["safe"], NOW)!;
    const expected = Math.min(...env.safeCases.filter((c) => c.amountAtRisk <= 5000).map((c) => c.recommendation!.confidence));
    expect(safe).toBe(expected);
    expect(Math.round(safe * 100)).toBe(97);
    // Held groups are not bulk-eligible, so they add nothing; deselecting everything leaves no value.
    expect(selectedActionConfidence(env.repos, env.incident, ["safe", "duplicate_review", "high_value"], NOW)).toBe(safe);
    expect(selectedActionConfidence(env.repos, env.incident, [], NOW)).toBeUndefined();
    // Lowering one selected case's confidence moves the minimum.
    const target = env.repos.cases.get(env.safeCases[0]!.id)!;
    env.repos.cases.save({ ...target, recommendation: { ...target.recommendation!, confidence: 0.955 } });
    expect(selectedActionConfidence(env.repos, env.incident, ["safe"], NOW)).toBe(0.955);
  });

  it("reads the automatic threshold from automation controls and the mode from the action's configuration", () => {
    const env = setup();
    expect(recoveryModeView(env.repos, env.incident, NOW)).toMatchObject({
      mode: "Suggest only",
      consequence: "Merchant approval required",
      blocked: false,
      tooltip: "Automatic execution requires at least 95% action confidence and an eligible automation mode. Restore learning access is currently configured as Suggest only.",
    });
    env.repos.config.saveGlobalControls({ ...env.repos.config.globalControls(), minimumConfidence: 0.98 });
    setActionMode(env.repos, "retry_provisioning", "always_require_approval", ACTORS.operator, NOW);
    const changed = recoveryModeView(env.repos, env.incident, NOW);
    expect(changed.tooltip).toBe("Automatic execution requires at least 98% action confidence and an eligible automation mode. Restore learning access is currently configured as Always require approval.");
    expect(changed.mode).toBe("Always require approval");
  });

  it("shows the blocked state, and approval never bypasses a failed policy check", () => {
    const env = setup();
    const stale = addSeconds(NOW, 180);
    const view = recoveryModeView(env.repos, env.incident, stale);
    expect(view.blocked).toBe(true);
    expect(view.consequence).toMatch(/^Blocked by policy: /);
    env.clock.set(stale);
    expect(() => approveAndStart(env, { caseId: env.safeCases[0]!.id, action: "retry_provisioning", actor: ACTORS.operator, approvalSource: "merchant" })).toThrow(ExecutionError);
  });

  it("labels the normal safe group 'Approval required'", () => {
    const env = setup();
    expect(incidentWorkspace(env.repos, "INC-0017", NOW)!.groups.find((g) => g.id === "safe")!.policy).toBe("Approval required");
    expect(source("services/recovery/groups.ts")).not.toContain("Eligible after approval");
  });
});

describe("P0.2 Evidence disclosure", () => {
  const expectedDefaults: Record<string, boolean> = {
    Deployment: false,
    "Service errors": true,
    "Payment captures": false,
    "Webhook deliveries": false,
    "Fulfilment failures": true,
    "Missing Outcome Receipts": false,
    "Service recovery": true,
    "Successful post-recovery outcomes": true,
    "Similar case sequences": false,
  };

  it("opens groups by evidence role, not by title", () => {
    const env = setup();
    const groups = incidentWorkspace(env.repos, "INC-0017", NOW)!.evidence;
    expect(Object.fromEntries(groups.map((g) => [g.label, g.defaultExpanded]))).toEqual(expectedDefaults);
    expect(source("services/views/evidence.ts")).not.toMatch(/label === "|defaultExpanded: \w+\.label/);
  });

  it("expands all, collapses all, and toggles groups independently without removing evidence", () => {
    const env = setup();
    const groups = incidentWorkspace(env.repos, "INC-0017", NOW)!.evidence;
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(Object.values(expandAll(groups)).every(Boolean)).toBe(true);
    expect(Object.values(collapseAll(groups)).every((v) => !v)).toBe(true);
    const initial = initialExpansion(groups);
    const key = groups.find((g) => !g.defaultExpanded)!.key;
    const toggled = setGroupExpanded(initial, key, true);
    expect(toggled[key]).toBe(true);
    expect(Object.entries(toggled).filter(([k]) => k !== key)).toEqual(Object.entries(initial).filter(([k]) => k !== key));
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(total);
    expect(total).toBe(new Set(env.incident.investigation!.evidenceIds).size);
    const section = source("ui/incidents/EvidenceSection.tsx");
    expect(section).toContain("Expand all");
    expect(section).toContain("Collapse all");
    expect(section).toMatch(/isExpanded=\{expanded\[group\.key\]/);
  });

  it("collapses cause evidence cited only by ruled-out causes", () => {
    const env = setup();
    const inv = env.incident.investigation!;
    const serviceErrors = incidentWorkspace(env.repos, "INC-0017", NOW)!.evidence.find((g) => g.label === "Service errors")!.items.map((i) => i.id);
    const hypotheses = inv.hypotheses!.map((h) => ({ ...h, evidenceIds: h.evidenceIds.filter((id) => !serviceErrors.includes(id)) }));
    hypotheses.push({ cause: "Unrelated errors", verdict: "ruled_out", evidenceIds: serviceErrors, reasoning: "Not related." });
    env.repos.incidents.save({ ...env.incident, investigation: { ...inv, hypotheses } });
    expect(incidentWorkspace(env.repos, "INC-0017", NOW)!.evidence.find((g) => g.label === "Service errors")!.defaultExpanded).toBe(false);
    expect(EVIDENCE_GROUPS.length).toBeGreaterThan(8);
  });
});

describe("P0.3 Reasons without repeated counts", () => {
  it("drops the per-reason count and adds one derived source line", () => {
    const env = setup();
    const reasons = recommendationReasons(env.repos, env.incident, NOW);
    expect(reasonsSourceSummary(reasons)).toBe("Supported by validated payment, webhook, fulfilment and service-health evidence.");
    expect(reasonsSourceSummary(reasons.filter((r) => r.id !== "webhooks"))).toBe("Supported by validated payment, fulfilment and service-health evidence.");
    expect(source("ui/incidents/WhyRayRecommends.tsx")).not.toMatch(/Based on/);
  });

  it("keeps the detailed counts under 'See how RAY investigated'", () => {
    const env = setup();
    const ids = incidentWorkspace(env.repos, "INC-0017", NOW)!.contribution.metrics.map((m) => m.id);
    expect(ids).toEqual(["detected", "examined", "causes", "safe", "held"]);
    const why = source("ui/incidents/WhyRayRecommends.tsx");
    expect(why).toContain("See how RAY investigated");
    expect(why).toContain("<ContributionDetails");
    expect(source("ui/incidents/WhyAgentNeeded.tsx")).toMatch(/metric\.detail/);
  });
});

describe("P0.4 Merchant intent in plain language", () => {
  it("shows the outcome and verification source without raw keys on Decision", () => {
    const env = setup();
    const intent = merchantIntent(env.repos, env.incident);
    expect(intent).toMatchObject({ expectedOutcome: "Learning package access within 2 minutes", verifiedThrough: "Learning Access Service" });
    expect(`${intent.expectedOutcome} ${intent.verifiedThrough}`).not.toMatch(/_/);
    const whatHappened = source("ui/incidents/WhatHappened.tsx");
    expect(whatHappened).not.toMatch(/expectedOutcome\}|verificationMethod|matchingKey/);
  });

  it("keeps event names and matching keys on the technical view", () => {
    const env = setup();
    expect(merchantIntent(env.repos, env.incident).technical).toMatchObject({ outcomeEvent: "learning_access_granted", matchingKey: "merchant_order_id" });
    const page = source("ui/incidents/IncidentWorkspacePage.tsx");
    const evidenceTab = page.slice(page.indexOf('<TabPanel value="evidence">'));
    expect(evidenceTab).toContain("intent.technical.outcomeEvent");
    expect(evidenceTab).toContain("intent.technical.matchingKey");
  });

  it("uses each contract's own language", () => {
    expect(outcomeLabel("learning_access_granted")).toBe("Learning package access");
    expect(outcomeLabel("booking_confirmed")).toBe("Confirmed booking");
    expect(outcomeLabel("membership_activated")).toBe("Membership activation");
    expect(outcomeLabel("wallet_credited")).toBe("Wallet credit");
    expect(outcomeLabel("plan_upgraded")).toBe("Plan upgrade");
    const env = setup();
    const booking = env.repos.incidents.get("INC-0017")!;
    const asBooking = { ...booking, outcomeContractId: "ctr_event_booking" };
    const intent = merchantIntent(env.repos, asBooking);
    expect(intent.expectedOutcome).toBe("Confirmed booking within 5 minutes");
    expect(intent.verifiedThrough).toBe("Booking service");
  });
});
