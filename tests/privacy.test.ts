import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { maskEmail, maskPhone } from "@/domain/privacy";
import { OPERATOR } from "@/fixtures/catalogue";
import type { AgentGateway } from "@/services/agent/contracts";
import { reinvestigateCase } from "@/services/agent";
import { communicationSummary } from "@/services/communication";
import { contactCustomer, DecisionError } from "@/services/decisions";
import { approveAndStart, runExecution } from "@/services/execution";
import { PrivacyError, revealCustomerContact } from "@/services/privacy";
import { POLICY_VERSION } from "@/services/versions";
import { auditExport, auditRows } from "@/services/views/audit";
import { caseDetail } from "@/services/views/cases";
import { clockSleep, NOW, setup } from "./helpers";

describe("Customer contact details", () => {
  it("masks email and phone", () => {
    expect(maskEmail("varun.reddy33@yahoo.co.in")).toBe("v••••••••••••@yahoo.co.in");
    expect(maskPhone("+91 79959 56219")).toBe("+91 ••••• •6219");
  });

  it("keeps full contact details out of the case view model", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const customer = env.repos.payments.customer(c.customerId)!;
    const text = JSON.stringify(caseDetail(env.repos, c.id, NOW));
    expect(text).not.toContain(customer.email);
    expect(text).not.toContain(customer.phone);
    expect(text).toContain(maskEmail(customer.email));
  });

  it("reveals only for permitted roles, and audits every reveal", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const customer = env.repos.payments.customer(c.customerId)!;
    expect(revealCustomerContact(env.repos, c.id, OPERATOR, NOW)).toEqual({ email: customer.email, phone: customer.phone });
    const entry = env.repos.audit.forCase(c.id).at(-1)!;
    expect(entry).toMatchObject({ action: "Revealed customer contact", actor: OPERATOR.name });
    expect(JSON.stringify(entry)).not.toContain(customer.email);
    expect(() => revealCustomerContact(env.repos, c.id, { name: "Support agent", role: "Support" }, NOW)).toThrow(PrivacyError);
  });
});

describe("Outbound communication", () => {
  it("summarises channel, consent, recipients, opt-outs, format and review", () => {
    const env = setup();
    const cases = env.repos.cases.forIncident("INC-0017");
    const template = env.repos.config.contract("ctr_course_purchase")!.customerNotificationTemplate;
    const summary = communicationSummary(env.repos, cases.map((c) => c.customerId), template, template);
    expect(summary).toMatchObject({ recipients: 42, optedOut: 1, format: "template", reviewRequired: true });
    expect(summary.channel).toMatch(/^Email/);
    expect(communicationSummary(env.repos, [cases[0]!.customerId], "Edited text", template).format).toBe("free_form");
  });

  it("never messages a customer who opted out of email", () => {
    const env = setup();
    const optedOut = env.repos.cases.forIncident("INC-0017").find((c) => env.repos.payments.customer(c.customerId)!.emailOptOut)!;
    expect(() => contactCustomer(env.repos, optedOut.id, ACTORS.operator, NOW, "Your payment is safe.")).toThrow(DecisionError);
  });
});

describe("Audit detail", () => {
  it("records idempotency key, policy version, trigger and state for executions", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const execution = approveAndStart(env, { caseId: c.id, action: "retry_provisioning", actor: ACTORS.operator, approvalSource: "merchant" });
    await runExecution(env, execution.id, { sleep: clockSleep(env.clock) });
    const events = env.repos.audit.forCase(c.id).filter((e) => e.detail?.invocationId === execution.id);
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const e of events) expect(e.detail).toMatchObject({ idempotencyKey: execution.idempotencyKey, policyVersion: POLICY_VERSION, trigger: "merchant" });
  });

  it("records what produced an investigation, the sources read and fingerprints, not contents", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    await reinvestigateCase(env, c.id);
    const detail = env.repos.audit.forCase(c.id).at(-1)!.detail!;
    expect(detail).toMatchObject({ trigger: "merchant", producedBy: "Deterministic fixtures (offline)" });
    expect(detail.invocationId).toBeDefined();
    expect(detail.sources).toEqual(expect.arrayContaining(["Razorpay", "LearnLoop"]));
    expect(detail.inputFingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(detail.outputFingerprint).toMatch(/^[0-9a-f]{8}$/);

    const down: AgentGateway = { ...env.agent, investigateCase: async () => { throw new Error("down"); } };
    await reinvestigateCase({ ...env, agent: down }, c.id);
    expect(env.repos.audit.forCase(c.id).at(-1)!.detail!.producedBy).toBe("Deterministic fallback: investigator unavailable");
  });

  it("exports machine-readable entries without customer contact details", () => {
    const env = setup();
    const rows = auditRows(env.repos, NOW);
    const exported = auditExport(rows, NOW);
    expect(exported).toMatchObject({ format: "payment-integrity.audit.v1", count: rows.length });
    const text = JSON.stringify(exported);
    for (const customer of env.repos.payments.customers()) {
      expect(text).not.toContain(customer.email);
      expect(text).not.toContain(customer.phone);
    }
    expect(text).not.toMatch(/@[a-z0-9-]+\.(com|in|co\.in)\b/i);
  });
});
