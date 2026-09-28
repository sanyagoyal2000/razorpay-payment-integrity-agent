import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTORS } from "@/domain/types";
import { createLiveAgentGateway } from "@/adapters/live/agent";
import { createDemoAgentGateway } from "@/adapters/demo/agent";
import type { AgentGateway } from "@/services/agent/contracts";
import {
  checkCustomerMessage,
  describeCaseInvestigation,
  draftContract,
  draftCustomerMessage,
  explainEarnedAutonomy,
  messageInputForCase,
  reinvestigateCase,
  reinvestigateIncident,
} from "@/services/agent";
import { draftContractByRule } from "@/services/agent/rules";
import { buildCaseInvestigationInput } from "@/services/investigation";
import { NOW, setup } from "./helpers";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("live agent gateway", () => {
  const router = (live: boolean, task: (url: string) => Response) =>
    vi.fn(async (url: string) => (url === "/api/agent/status" ? json(200, { live }) : task(url))) as unknown as typeof fetch;

  it("uses the deterministic agent without calling any task when the server has no credentials", async () => {
    const env = setup();
    const fetchStub = router(false, () => json(500, {}));
    const gateway = createLiveAgentGateway(env.agent, fetchStub);
    const input = buildCaseInvestigationInput(env.repos, env.safeCases[0]!.id);
    expect(await gateway.investigateCase(input)).toEqual(env.store.investigationResponse(env.safeCases[0]!.id));
    await gateway.investigateCase(input);
    expect((fetchStub as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(["/api/agent/status"]);
  });

  it("returns live output and treats server-rejected output as unusable", async () => {
    const env = setup();
    const input = { audience: "one_customer" as const, situation: "under_review" as const, productName: "X", facts: [] };
    expect(await createLiveAgentGateway(env.agent, router(true, () => json(200, { output: { subject: "S", body: "B" } }))).draftMessage(input)).toEqual({ subject: "S", body: "B" });
    expect(await createLiveAgentGateway(env.agent, router(true, () => json(422, { error: "invalid_output" }))).draftMessage(input)).toBeNull();
    await expect(createLiveAgentGateway(env.agent, router(true, () => json(502, {}))).investigateCase(buildCaseInvestigationInput(env.repos, env.safeCases[0]!.id))).rejects.toThrow();
  });
});

describe("agent API route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("reports availability, and returns 503 without credentials, 404 for unknown tasks and 400 for invalid input", async () => {
    vi.stubEnv("AGENT_PROVIDER", "api");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const status = await import("@/app/api/agent/status/route");
    expect(await status.GET().json()).toEqual({ live: false });
    const { POST } = await import("@/app/api/agent/[task]/route");
    const call = (task: string, body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: { task } });
    expect((await call("draft-message", {})).status).toBe(503);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    expect((await call("unknown", {})).status).toBe(404);
    expect((await call("draft-message", { audience: "everyone" })).status).toBe(400);
  });

  it("calls claude-opus-5 with structured output and maps refusals to 422", async () => {
    vi.stubEnv("AGENT_PROVIDER", "api");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const parse = vi.fn();
    vi.doMock("@anthropic-ai/sdk", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
      class FakeAnthropic {
        beta = { messages: { parse } };
      }
      Object.assign(FakeAnthropic, actual.default);
      return { ...actual, default: FakeAnthropic };
    });
    const { POST } = await import("@/app/api/agent/[task]/route");
    const body = { audience: "one_customer", situation: "under_review", productName: "SQL for Data Analysis", amount: 2499, facts: ["Paid"] };
    const call = () => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: { task: "draft-message" } });

    parse.mockResolvedValueOnce({ stop_reason: "end_turn", parsed_output: { subject: "Your payment", body: "Hi {first_name}, your payment is safe." } });
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ output: { subject: "Your payment", body: "Hi {first_name}, your payment is safe." } });
    const request = parse.mock.calls[0]![0];
    expect(request.model).toBe("claude-opus-5");
    expect(request.fallbacks).toBe("default");
    expect(request.output_config.format).toBeDefined();
    expect(JSON.stringify(request.messages)).not.toMatch(/@|\+91/);

    parse.mockResolvedValueOnce({ stop_reason: "refusal", parsed_output: null });
    expect((await call()).status).toBe(422);
  });
});

describe("Claude CLI provider (default)", () => {
  const fake = path.resolve(__dirname, "stubs/fake-claude.mjs");
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is the default provider and needs no API key", async () => {
    vi.stubEnv("AGENT_PROVIDER", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CLAUDE_CLI_PATH", fake);
    const { agentProvider, isLiveAgentConfigured } = await import("@/server/claude");
    expect(agentProvider()).toBe("claude-cli");
    expect(isLiveAgentConfigured()).toBe(true);
    vi.stubEnv("CLAUDE_CLI_PATH", "/nonexistent/claude");
    expect(isLiveAgentConfigured()).toBe(false);
  });

  it("runs the CLI headless with no tools and validates its structured output", async () => {
    const log = path.join(os.tmpdir(), `fake-claude-${process.pid}.json`);
    vi.stubEnv("CLAUDE_CLI_PATH", fake);
    vi.stubEnv("FAKE_CLAUDE_LOG", log);
    vi.stubEnv("FAKE_CLAUDE_RESULT", JSON.stringify({ type: "result", is_error: false, structured_output: { subject: "Your payment", body: "Hi {first_name}, your payment is safe." } }));
    const { POST } = await import("@/app/api/agent/[task]/route");
    const body = { audience: "one_customer", situation: "under_review", productName: "SQL for Data Analysis", amount: 2499, facts: ["Paid"] };
    const response = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: { task: "draft-message" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ output: { subject: "Your payment", body: "Hi {first_name}, your payment is safe." } });
    const recorded = JSON.parse(fs.readFileSync(log, "utf8")) as { args: string[]; prompt: string; cwd: string };
    expect(recorded.args).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--json-schema", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--model", "claude-opus-5"]));
    expect(JSON.parse(recorded.prompt)).toEqual(body);
    expect(fs.realpathSync(recorded.cwd)).toBe(fs.realpathSync(os.tmpdir()));
    const schema = JSON.parse(recorded.args[recorded.args.indexOf("--json-schema") + 1]!);
    expect(schema.required).toEqual(["subject", "body"]);
    expect(JSON.stringify(schema)).not.toMatch(/minLength|minimum|maximum/);
  });

  it("maps CLI failures and invalid output to the same errors as the API path", async () => {
    vi.stubEnv("CLAUDE_CLI_PATH", fake);
    const body = { audience: "one_customer", situation: "under_review", productName: "X", facts: [] };
    const call = async () => {
      vi.resetModules();
      const { POST } = await import("@/app/api/agent/[task]/route");
      return POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: { task: "draft-message" } });
    };
    vi.stubEnv("FAKE_CLAUDE_RESULT", JSON.stringify({ is_error: false, structured_output: { subject: "" } }));
    expect((await call()).status).toBe(422);
    vi.stubEnv("FAKE_CLAUDE_RESULT", JSON.stringify({ is_error: true, subtype: "error_during_execution" }));
    expect((await call()).status).toBe(502);
    vi.stubEnv("FAKE_CLAUDE_RESULT", "not json");
    vi.stubEnv("FAKE_CLAUDE_EXIT", "1");
    expect((await call()).status).toBe(502);
  });
});

describe("re-investigation", () => {
  it("records what was examined, checks citations and updates the recommendation", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const steps: string[] = [];
    const result = await reinvestigateCase(env, c.id, (p) => steps.push(p.step));
    expect(result.status).toBe("valid");
    expect(steps).toEqual(["gathering", "comparing", "checking_health", "validating", "preparing"]);
    const saved = env.repos.cases.get(c.id)!;
    expect(saved.investigationRun).toMatchObject({ status: "valid", citationsRemoved: [] });
    expect(saved.investigationRun!.eventsExamined).toBeGreaterThan(5);
    expect(saved.investigation!.hypotheses!.find((h) => h.verdict === "supported")!.cause).toMatch(/v2\.3/);
    expect(env.repos.audit.forCase(c.id).at(-1)).toMatchObject({ action: "Re-investigated case", actor: ACTORS.agent });
  });

  it("removes invented citations, including inside hypotheses", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const original = env.store.investigationResponse(c.id) as { evidenceIds: string[]; hypotheses: Array<{ evidenceIds: string[] }> };
    const agent: AgentGateway = {
      ...env.agent,
      investigateCase: async () => ({
        ...original,
        evidenceIds: [...original.evidenceIds, "evt_invented"],
        hypotheses: original.hypotheses.map((h, i) => (i === 0 ? { ...h, evidenceIds: [...h.evidenceIds, "whd_invented"] } : h)),
      }),
    };
    await reinvestigateCase({ ...env, agent }, c.id);
    const saved = env.repos.cases.get(c.id)!;
    expect(saved.investigationRun!.citationsRemoved.sort()).toEqual(["evt_invented", "whd_invented"]);
    expect(JSON.stringify(saved.investigation)).not.toMatch(/invented/);
  });

  it("escalates when the agent fails, and policy still decides", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const agent: AgentGateway = { ...env.agent, investigateCase: async () => { throw new Error("down"); } };
    const result = await reinvestigateCase({ ...env, agent }, c.id);
    expect(result.status).toBe("unavailable");
    expect(env.repos.cases.get(c.id)!.recommendation!.action).toBe("escalate");
  });

  it("describes fixture investigations without re-running them", async () => {
    const env = setup();
    const run = describeCaseInvestigation(env.repos, env.safeCases[0]!)!;
    expect(run.citationsRemoved).toEqual([]);
    expect(Object.keys(run.sources)).toEqual(expect.arrayContaining(["Razorpay", "LearnLoop", "LearnLoop Observability"]));
    const incident = await reinvestigateIncident(env, "INC-0017");
    expect(incident.status).toBe("valid");
    expect(env.repos.incidents.get("INC-0017")!.investigationRun!.status).toBe("valid");
  });
});

describe("drafts and suggestions", () => {
  it("drafts customer messages that pass the customer-safety check", async () => {
    const env = setup();
    for (const c of [env.safeCases[0]!, env.duplicateCases[0]!, env.refusalCase, env.lateAuthCase]) {
      const draft = await draftCustomerMessage(env.agent, messageInputForCase(env.repos, c));
      expect(draft.flagged).toEqual([]);
      expect(draft.body).toContain("{first_name}");
    }
    expect(checkCustomerMessage("Your ₹2,499 and ₹4,999 payments are safe.")).toEqual([]);
    expect(checkCustomerMessage("Request failed with 503")).toEqual(["HTTP or error codes"]);
    expect(checkCustomerMessage("Our webhook returned HTTP 500 and the AI is 97% confident")).toEqual(
      expect.arrayContaining(["confidence scores", "webhooks or APIs", "HTTP or error codes", "AI or agents"]),
    );
  });

  it("flags unsafe live drafts instead of hiding them", async () => {
    const env = setup();
    const agent: AgentGateway = { ...env.agent, draftMessage: async () => ({ subject: "Update", body: "Hi {first_name}, our enrolment service had an outage after a deployment." }) };
    const draft = await draftCustomerMessage(agent, messageInputForCase(env.repos, env.safeCases[0]!));
    expect(draft.flagged).toEqual(["system internals"]);
  });

  it("drafts Outcome Contracts from plain language and enforces limits", async () => {
    const workshop = draftContractByRule({
      description: "Workshop seats must be confirmed within 3 minutes. Recover automatically for bookings under ₹2,000.",
      products: [{ id: "prd_system_design_workshop", name: "System Design Live Workshop", kind: "event_seat", price: 2499 }],
      fulfilmentServices: ["enrolment-service"],
      globalMaxAutomaticValue: 5000,
    });
    expect(workshop).toMatchObject({ expectedOutcome: "booking_confirmed", deadlineSeconds: 180, maxAutomaticValue: 2000, requiresInventoryCheck: true, productScope: ["prd_system_design_workshop"] });
    const env = setup();
    const agent: AgentGateway = { ...env.agent, draftContract: async (input) => ({ ...draftContractByRule(input), maxAutomaticValue: 50_000, productScope: ["prd_unknown"] }) };
    const checked = await draftContract({ repos: env.repos, agent }, "Course access within 2 minutes");
    expect(checked.maxAutomaticValue).toBe(5000);
    expect(checked.productScope).toEqual([]);
    expect(checked.corrections).toHaveLength(2);
  });

  it("explains earned autonomy from decisions and never exceeds global limits", async () => {
    const env = setup();
    const explanation = await explainEarnedAutonomy(env, "retry_provisioning", NOW);
    expect(explanation.headline).toBe("Retry provisioning was approved without edits in 48 of the last 50 eligible cases.");
    expect(explanation.suggestedMaxValue).toBeLessThanOrEqual(5000);
    expect(explanation.risks.length).toBeGreaterThan(0);
    const bold: AgentGateway = { ...env.agent, explainAutonomy: async () => ({ headline: "h", explanation: "e", risks: ["r"], suggestedMode: "automatic_below_threshold", suggestedMaxValue: 99_999, suggestedMinimumConfidence: 0.5 }) };
    const cached = await explainEarnedAutonomy({ repos: env.repos, agent: bold }, "retry_provisioning", NOW);
    expect(cached.headline).toBe(explanation.headline);
    const clamped = await explainEarnedAutonomy({ repos: env.repos, agent: bold }, "retry_provisioning", NOW, true);
    expect(clamped.suggestedMaxValue).toBe(5000);
    expect(clamped.suggestedMinimumConfidence).toBe(0.95);
    expect(env.repos.config.actionPolicies().find((p) => p.action === "retry_provisioning")!.mode).toBe("suggest_only");
  });
});

it("demo gateway is deterministic", async () => {
  const env = setup();
  const demo = createDemoAgentGateway((id) => env.store.investigationResponse(id));
  const input = messageInputForCase(env.repos, env.safeCases[0]!);
  expect(await demo.draftMessage(input)).toEqual(await demo.draftMessage(input));
});
