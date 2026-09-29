import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { askRay, buildAskInput, suggestedQuestions } from "@/services/agent/ask";
import { askIncidentInputSchema, type AgentGateway } from "@/services/agent/contracts";
import { setIntegrationConnected } from "@/services/configuration";
import { NOW, setup } from "./helpers";

const withAgent = (env: ReturnType<typeof setup>, askIncident: AgentGateway["askIncident"]) => ({ ...env, agent: { ...env.agent, askIncident } });

describe("Ask RAY", () => {
  it("offers questions worded from the incident's current state", () => {
    const env = setup();
    expect(suggestedQuestions(env.repos, "INC-0017", NOW)).toEqual([
      "Why are 5 cases held?",
      "What changed after deployment v2.3?",
      "What would happen if I approve this batch?",
    ]);
    for (const c of env.safeCases) env.repos.cases.save({ ...c, status: "resolved" });
    expect(suggestedQuestions(env.repos, "INC-0017", NOW)).not.toContain("What would happen if I approve this batch?");
  });

  it("answers from facts and evidence, citing what exists", async () => {
    const env = setup();
    const held = await askRay(env, "INC-0017", "Why are 5 cases held?");
    expect(held).toMatchObject({ inScope: true, unsupported: false, nextStep: "review_recovery", removedIds: [] });
    expect(held.citations.map((c) => c.id)).toEqual(["fact:held:duplicate_review", "fact:held:high_value"]);
    expect(held.answer).toContain("3 cases are held because they are duplicate payments");

    const deploy = await askRay(env, "INC-0017", "What changed after deployment v2.3?");
    const evidenceIds = new Set(buildAskInput(env.repos, "INC-0017", "q", NOW).evidence.map((e) => e.id));
    expect(deploy.citations.filter((c) => c.kind === "evidence").every((c) => evidenceIds.has(c.id))).toBe(true);
    expect(deploy.answer).toMatch(/deploy\.completed v2\.3/);
  });

  it("never executes anything, even when asked to approve", async () => {
    const env = setup();
    const before = JSON.stringify({ cases: env.repos.cases.list(), executions: env.repos.executions.list() });
    const answer = await askRay(env, "INC-0017", "What would happen if I approve this batch?");
    expect(answer.nextStep).toBe("review_recovery");
    expect(answer.answer).toMatch(/Policy is checked again before each one runs/);
    expect(JSON.stringify({ cases: env.repos.cases.list(), executions: env.repos.executions.list() })).toBe(before);
    expect(env.repos.audit.list().at(-1)!.result).toMatch(/Nothing was executed\.$/);
  });

  it("removes invented citations and flags answers with no evidence", async () => {
    const env = setup();
    const inventive = withAgent(env, async () => ({ inScope: true, answer: "It was the database.", citedIds: ["evt_made_up"], nextStep: "none" }));
    const result = await askRay(inventive, "INC-0017", "What caused this?");
    expect(result).toMatchObject({ removedIds: ["evt_made_up"], citations: [], unsupported: true, fallback: false });
  });

  it("falls back to deterministic answers when the model is unavailable or invalid", async () => {
    const env = setup();
    const down = await askRay(withAgent(env, async () => { throw new Error("down"); }), "INC-0017", "Why are 5 cases held?");
    expect(down).toMatchObject({ fallback: true, inScope: true });
    const invalid = await askRay(withAgent(env, async () => ({ nonsense: true })), "INC-0017", "Why are 5 cases held?");
    expect(invalid.fallback).toBe(true);
    expect(invalid.producedBy).toMatch(/^Deterministic answer/);
  });

  it("refuses questions outside the incident", async () => {
    const env = setup();
    expect(await askRay(env, "INC-0017", "What is the weather in Bengaluru?")).toMatchObject({ inScope: false, nextStep: "none", citations: [] });
  });

  it("respects the same source permissions as the investigator", async () => {
    const env = setup();
    setIntegrationConnected(env.repos, "platform_monitoring", false, ACTORS.operator, NOW);
    const input = buildAskInput(env.repos, "INC-0017", "What changed after deployment v2.3?", NOW);
    expect(input.evidence.some((e) => e.source === "platform_monitoring")).toBe(false);
    const answer = await askRay(env, "INC-0017", "What changed after deployment v2.3?");
    expect(answer.answer).toMatch(/No deployment or service events are available/);

    const leaky = withAgent(env, async () => ({ inScope: true, answer: "Deploy broke it.", citedIds: ["obs_RFinmEjjf39y"], nextStep: "none" }));
    expect((await askRay(leaky, "INC-0017", "What changed?")).removedIds).toEqual(["obs_RFinmEjjf39y"]);
  });

  it("audits each question by fingerprint, never storing the question or customer data", async () => {
    const env = setup();
    await askRay(env, "INC-0017", "Why are 5 cases held for Varun Reddy?");
    const entry = env.repos.audit.list().at(-1)!;
    expect(entry).toMatchObject({ action: "Asked RAY", targetId: "INC-0017", actor: ACTORS.operator });
    expect(entry.detail!.inputFingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(entry)).not.toMatch(/Varun|held for/);
  });

  it("sends only schema-valid input without customer contact details", () => {
    const env = setup();
    const input = buildAskInput(env.repos, "INC-0017", "Why are 5 cases held?", NOW);
    expect(askIncidentInputSchema.safeParse(input).success).toBe(true);
    const text = JSON.stringify(input);
    for (const c of env.repos.payments.customers()) {
      expect(text).not.toContain(c.email);
      expect(text).not.toContain(c.phone);
    }
  });
});
