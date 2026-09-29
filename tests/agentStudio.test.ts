import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { addSeconds } from "@/domain/time";
import { setIntegrationConnected, setWriteAuthority } from "@/services/configuration";
import { approveAndStart, advanceExecution } from "@/services/execution";
import { agentLifecycle, incidentLifecycle } from "@/services/lifecycle";
import { AGENT_PURPOSE, agentProfile, contextAndAuthority } from "@/services/views/agentProfile";
import { NOW, setup } from "./helpers";

describe("Operational lifecycle", () => {
  it("is derived from records: awaiting approval on the fixtures", () => {
    const env = setup();
    expect(incidentLifecycle(env.repos, env.incident, NOW)).toMatchObject({ state: "awaiting_approval", label: "Awaiting approval" });
    expect(agentLifecycle(env.repos, NOW).state).toBe("awaiting_approval");
  });

  it("moves through executing and verifying as an execution runs", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const execution = approveAndStart(env, { caseId: c.id, action: "retry_provisioning", actor: ACTORS.operator, approvalSource: "merchant" });
    expect(incidentLifecycle(env.repos, env.incident, NOW)).toMatchObject({ state: "executing", caseIds: [c.id] });
    let e = execution;
    for (let i = 0; i < 6 && e.status !== "awaiting_outcome"; i += 1) e = advanceExecution(env, e.id);
    expect(e.status).toBe("awaiting_outcome");
    expect(incidentLifecycle(env.repos, env.incident, NOW).state).toBe("verifying_outcome");
  });

  it("is blocked while data is stale, investigating without findings, resolved when all cases close", () => {
    const env = setup();
    expect(incidentLifecycle(env.repos, env.incident, addSeconds(NOW, 180)).state).toBe("blocked");

    const { investigation, investigationRun, ...rest } = env.incident;
    void investigation;
    void investigationRun;
    env.repos.incidents.save(rest);
    expect(incidentLifecycle(env.repos, env.repos.incidents.get("INC-0017")!, NOW).state).toBe("investigating");

    const resolved = env.repos.incidents.list().find((i) => i.status === "resolved")!;
    expect(incidentLifecycle(env.repos, resolved, NOW).state).toBe("resolved");
  });
});

describe("Context & authority", () => {
  it("lists readable context and per-action authority for the contract", () => {
    const env = setup();
    const course = contextAndAuthority(env.repos, env.repos.config.contract("ctr_course_purchase")!);
    expect(course.context.map((c) => c.id)).toEqual(["payments", "webhooks", "deployments", "fulfilment", "receipts"]);
    expect(course.context.every((c) => c.available)).toBe(true);
    const by = Object.fromEntries(course.actions.map((a) => [a.label, a.authorityLabel]));
    expect(by).toMatchObject({
      "Retry enrolment": "Suggest only",
      "Capture payment": "Approval required",
      "Refund duplicate": "Not permitted",
      "Escalate for review": "Automatic within limits",
    });

    const booking = contextAndAuthority(env.repos, env.repos.config.contract("ctr_event_booking")!);
    expect(booking.context.find((c) => c.id === "inventory")!.available).toBe(true);
    expect(booking.actions.find((a) => a.action === "retry_provisioning")).toMatchObject({ label: "Reconfirm booking", authority: "not_permitted" });
  });

  it("never grants authority by connecting a source", () => {
    const env = setup();
    const contract = env.repos.config.contract("ctr_course_purchase")!;
    setIntegrationConnected(env.repos, "learnloop_enrolment", false, ACTORS.operator, NOW);
    expect(contextAndAuthority(env.repos, contract).context.find((c) => c.id === "fulfilment")!.available).toBe(false);

    setIntegrationConnected(env.repos, "learnloop_enrolment", true, ACTORS.operator, NOW);
    const reconnected = contextAndAuthority(env.repos, contract);
    expect(reconnected.context.find((c) => c.id === "fulfilment")!.available).toBe(true);
    expect(reconnected.actions.find((a) => a.action === "retry_provisioning")).toMatchObject({ authority: "not_permitted", detail: "Write access to LearnLoop Enrolment API has not been granted." });

    setWriteAuthority(env.repos, "learnloop_enrolment", true, ACTORS.operator, NOW);
    expect(contextAndAuthority(env.repos, contract).actions.find((a) => a.action === "retry_provisioning")!.authority).toBe("suggest_only");
  });
});

describe("Agent details", () => {
  it("states the specialist job, state, systems, permission mode and outcome", () => {
    const env = setup();
    const p = agentProfile(env.repos, NOW);
    expect(p.purpose).toBe(AGENT_PURPOSE);
    expect(p.lifecycle.state).toBe("awaiting_approval");
    expect(p.connected.find((c) => c.name === "LearnLoop Observability")!.access).toBe("Read only");
    expect(p.permissionMode.label).toBe("Review-first; 1 automatic within limits");
    expect(p.verifiedOutcomes.caseIds.length).toBeGreaterThan(0);
  });
});

describe("RAY visual layer", () => {
  const ui = path.join(__dirname, "../src/ui");
  const files = fs.readdirSync(ui, { recursive: true }).map(String).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

  it("defines RAY colours in one theme file only", () => {
    for (const file of files) {
      if (file === path.join("ray", "theme.ts")) continue;
      const source = fs.readFileSync(path.join(ui, file), "utf8");
      expect(source, file).not.toMatch(/onSea|hsla\(|#[0-9a-f]{6}\b/i);
    }
  });

  it("keeps transactional buttons on Blade's standard colours", () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(ui, file), "utf8");
      for (const button of source.match(/<Button[^>]*>/g) ?? []) expect(button, file).not.toMatch(/RAY|ray\./);
    }
  });
});
