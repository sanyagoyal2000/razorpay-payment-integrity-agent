import { describe, expect, it } from "vitest";
import {
  buildCaseInvestigationInput,
  INVESTIGATION_UNAVAILABLE,
  investigateCase,
  validateInvestigation,
} from "@/services/investigation";
import { createFixtureInvestigationAdapter } from "@/adapters/demo/investigation";
import { setup } from "./helpers";

describe("investigation boundary", () => {
  it("returns validated fixture investigations whose evidence exists in the supplied events", async () => {
    const { repos, investigator, safeCases } = setup();
    const input = buildCaseInvestigationInput(repos, safeCases[0]!.id);
    const result = await investigateCase(investigator, input);
    expect(result.status).toBe("valid");
    const ids = new Set(input.evidence.map((e) => e.id));
    for (const id of result.investigation.evidenceIds) expect(ids.has(id)).toBe(true);
    expect(result.investigation.recommendedAction).toBe("retry_provisioning");
  });

  it("removes unsupported evidence", () => {
    const raw = { ...validRaw(), evidenceIds: ["evt_real", "evt_invented"] };
    const result = validateInvestigation(raw, new Set(["evt_real"]));
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.investigation.evidenceIds).toEqual(["evt_real"]);
    expect(result.removedEvidenceIds).toEqual(["evt_invented"]);
  });

  it("escalates invalid output", () => {
    for (const raw of [{ ...validRaw(), confidence: 1.4 }, { ...validRaw(), recommendedAction: "issue_refund" }, { summary: "x" }, "not json"]) {
      const result = validateInvestigation(raw, new Set(["evt_real"]));
      expect(result.status).toBe("invalid");
      expect(result.investigation.recommendedAction).toBe("escalate");
    }
  });

  it("escalates when no cited evidence can be verified", () => {
    const result = validateInvestigation({ ...validRaw(), evidenceIds: ["evt_invented"] }, new Set(["evt_real"]));
    expect(result.status).toBe("invalid");
    expect(result.investigation.recommendedAction).toBe("escalate");
  });

  it("falls back to a rule-based escalation when the investigator is unavailable", async () => {
    const { repos, store, safeCases } = setup();
    const adapter = createFixtureInvestigationAdapter((id) => store.investigationResponse(id), () => false);
    const result = await investigateCase(adapter, buildCaseInvestigationInput(repos, safeCases[0]!.id));
    expect(result.status).toBe("unavailable");
    expect(result.investigation.summary).toBe(INVESTIGATION_UNAVAILABLE);
    expect(result.investigation.recommendedAction).toBe("escalate");
  });

  it("sends only case data, never customer details", () => {
    const { repos, safeCases } = setup();
    const c = safeCases[0]!;
    const customer = repos.payments.customer(c.customerId)!;
    const serialised = JSON.stringify(buildCaseInvestigationInput(repos, c.id));
    expect(serialised).not.toContain(customer.name);
    expect(serialised).not.toContain(customer.email);
    expect(serialised).not.toContain(customer.phone);
    expect(serialised).not.toContain(customer.id);
  });
});

function validRaw() {
  return {
    summary: "Learning access failed after payment.",
    likelyCause: "HTTP 500 from /learning-access.",
    evidenceIds: ["evt_real"],
    uncertainties: [],
    recommendedAction: "retry_provisioning",
    confidence: 0.97,
    customerImpact: "No access.",
    consequenceOfInaction: "Support contact likely.",
  };
}
