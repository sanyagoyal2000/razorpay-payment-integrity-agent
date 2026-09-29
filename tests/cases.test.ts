import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { istTime } from "@/domain/time";
import {
  applyDecision,
  contactCustomer,
  DecisionError,
  escalate,
  prepareRefund,
  rejectRecommendation,
  requestAlternateInventory,
  waitAndRecheck,
} from "@/services/decisions";
import { runExecution } from "@/services/execution";
import { auditRows, DEFAULT_AUDIT_FILTERS, filterAudit } from "@/services/views/audit";
import { bulkSelection, caseDetail, caseRows, DEFAULT_CASE_FILTERS, filterCases } from "@/services/views/cases";
import { clockSleep, NOW, setup } from "./helpers";

describe("Case list", () => {
  it("searches by payment ID, order ID, customer name, email and phone", () => {
    const env = setup();
    const rows = caseRows(env.repos, NOW);
    const target = rows.find((r) => r.id === env.safeCases[0]!.id)!;
    for (const query of [target.paymentId, target.orderId, target.razorpayOrderId, target.customer.split(" ")[0]!, target.email, target.phone.slice(-5)]) {
      expect(filterCases(rows, { ...DEFAULT_CASE_FILTERS, query }).map((r) => r.id)).toContain(target.id);
    }
    const duplicate = rows.find((r) => r.id === env.duplicateCases[0]!.id)!;
    expect(filterCases(rows, { ...DEFAULT_CASE_FILTERS, query: duplicate.relatedPaymentIds[0]! }).map((r) => r.id)).toEqual([duplicate.id]);
    expect(filterCases(rows, { ...DEFAULT_CASE_FILTERS, query: "no such customer" })).toHaveLength(0);
  });

  it("filters by status, type and amount", () => {
    const env = setup();
    const rows = caseRows(env.repos, NOW);
    expect(filterCases(rows, { ...DEFAULT_CASE_FILTERS, statuses: ["observing"] })).toHaveLength(1);
    expect(filterCases(rows, { ...DEFAULT_CASE_FILTERS, types: ["duplicate_payment"], statuses: ["review_required"] })).toHaveLength(3);
    expect(filterCases(rows, { ...DEFAULT_CASE_FILTERS, amount: "10k_1l" })).toHaveLength(0);
  });

  it("allows bulk selection only when every case shares the same safe action and eligibility", () => {
    const env = setup();
    expect(bulkSelection(env.repos, env.safeCases.slice(0, 5).map((c) => c.id), NOW).allowed).toBe(true);
    const mixed = bulkSelection(env.repos, [env.safeCases[0]!.id, env.duplicateCases[0]!.id], NOW);
    expect(mixed.allowed).toBe(false);
    expect(mixed.reason).toMatch(/1 of 2/);
    expect(bulkSelection(env.repos, [env.refusalCase.id], NOW).allowed).toBe(false);
  });
});

describe("Case detail", () => {
  it("builds the payment-to-outcome timeline in order, tagged by source", () => {
    const env = setup();
    const reference = env.incidentCases.find((c) => istTime(env.repos.payments.get(c.paymentId)!.createdAt).startsWith("14:07"))!;
    const detail = caseDetail(env.repos, reference.id, NOW)!;
    const titles = detail.timeline.map((e) => `${istTime(e.at)} ${e.source} ${e.title}`);
    expect(titles.slice(0, 7)).toEqual([
      "14:07:02 razorpay Order created",
      "14:07:08 razorpay Payment authorised",
      "14:07:09 razorpay Payment captured",
      "14:07:10 razorpay order.paid webhook sent",
      "14:07:10 merchant Merchant webhook returned HTTP 200",
      "14:07:11 merchant Learning access requested",
      "14:07:11 merchant Learning access request failed: HTTP 500",
    ]);
    expect(titles).toContain("14:09:09 agent Outcome deadline missed");
    expect(titles).toContain("14:09:10 agent Integrity case opened");
    expect(titles).toContain("14:18:40 merchant Learning Access Service recovered");
    expect(detail.unresolvedEvidence).toEqual([]);
  });

  it("shows the refusal as a deliberate block with the spec's checks and alternatives", () => {
    const env = setup();
    const detail = caseDetail(env.repos, env.refusalCase.id, NOW)!;
    expect(detail.refusal).toBe(true);
    expect(detail.primary!.action).toBe("retry_provisioning");
    expect(detail.primary!.verdict.result).toBe("blocked");
    expect(detail.primary!.disabledReason).toMatch(/overbook/);
    expect(detail.refusalOptions.map((o) => [o.label, o.disabledReason ?? "enabled"])).toEqual([
      ["Review alternate inventory", "enabled"],
      ["Notify customer", "enabled"],
      ["Prepare refund", "enabled"],
      ["Escalate for review", "enabled"],
    ]);
  });

  it("offers every Edit action with its verdict and disables inapplicable ones", () => {
    const env = setup();
    const detail = caseDetail(env.repos, env.safeCases[0]!.id, NOW)!;
    const byAction = Object.fromEntries(detail.editOptions.map((o) => [o.action, o]));
    expect(byAction["retry_provisioning"]!.disabledReason).toBeUndefined();
    expect(byAction["review_duplicate"]!.disabledReason).toBe("Only for duplicate payments.");
    expect(byAction["wait"]!.verdict.result).toBe("allowed");
  });
});

describe("Merchant decisions", () => {
  it("requires a reason to reject, and closes the case with an audit event", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    expect(() => rejectRecommendation(env.repos, c.id, "no", ACTORS.operator, NOW)).toThrow(DecisionError);
    rejectRecommendation(env.repos, c.id, "Customer already refunded by support", ACTORS.operator, NOW);
    expect(env.repos.cases.get(c.id)!.status).toBe("rejected");
    expect(env.repos.audit.forCase(c.id).at(-1)).toMatchObject({ action: "Rejected recommendation", actor: ACTORS.operator });
  });

  it("escalates through Slack and records it", () => {
    const env = setup();
    escalate(env.repos, env.refusalCase.id, "Needs a seat decision", ACTORS.operator, NOW);
    const c = env.repos.cases.get(env.refusalCase.id)!;
    expect(c.status).toBe("escalated");
    expect(c.followUps!.at(-1)).toMatchObject({ kind: "escalation", status: "open" });
  });

  it("prepares a refund of the second charge for duplicates, once", () => {
    const env = setup();
    const c = env.duplicateCases[0]!;
    const followUp = prepareRefund(env.repos, c.id, ACTORS.operator, NOW);
    expect(followUp).toMatchObject({ kind: "refund_draft", paymentId: c.relatedPaymentIds[0], amount: 3499, status: "awaiting_finance" });
    expect(() => prepareRefund(env.repos, c.id, ACTORS.operator, NOW)).toThrow(/already prepared/);
    expect(env.repos.payments.get(c.relatedPaymentIds[0]!)!.status).toBe("captured");
  });

  it("contacts the customer and requests alternate inventory for the refusal", () => {
    const env = setup();
    contactCustomer(env.repos, env.refusalCase.id, ACTORS.operator, NOW);
    requestAlternateInventory(env.repos, env.refusalCase.id, ACTORS.operator, NOW);
    const c = env.repos.cases.get(env.refusalCase.id)!;
    expect(c.customerContact).toBe("notified");
    expect(c.followUps!.map((f) => f.kind)).toEqual(["customer_message", "alternate_inventory_request"]);
    expect(c.status).toBe("review_required");
  });

  it("wait and re-check leaves a case alone until the outcome arrives", () => {
    const env = setup();
    const result = waitAndRecheck(env.repos, env.waitingCase.id, ACTORS.operator, NOW);
    expect(result.resolved).toBe(false);
    expect(env.repos.cases.get(env.waitingCase.id)!.status).toBe("observing");
  });

  it("never permits an action blocked by policy", () => {
    const env = setup();
    expect(() => applyDecision(env, env.refusalCase.id, "retry_provisioning", ACTORS.operator)).toThrow(/Blocked by policy/);
    expect(() => applyDecision(env, env.duplicateCases[0]!.id, "refund_duplicate", ACTORS.operator)).toThrow();
  });

  it("approving from the case runs the state machine and shows the resolved outcome", async () => {
    const env = setup();
    const c = env.safeCases[0]!;
    const result = applyDecision(env, c.id, "retry_provisioning", ACTORS.operator);
    expect(result.kind).toBe("execution");
    if (result.kind !== "execution") return;
    await runExecution(env, result.executionId, { sleep: clockSleep(env.clock) });
    const detail = caseDetail(env.repos, c.id, env.clock.now().toISOString())!;
    expect(detail.caseData.status).toBe("resolved");
    expect(detail.outcome!.event!.type).toBe("learning_access_granted");
    expect(detail.latestExecution!.status).toBe("resolved");
    expect(detail.customerView.status).toBe("resolved");
  });

  it("edits to a different action are recorded as edited", () => {
    const env = setup();
    const c = env.highValueCases[0]!;
    applyDecision(env, c.id, "retry_provisioning", ACTORS.operator);
    expect(env.repos.cases.get(c.id)!.decisions.at(-1)).toMatchObject({ kind: "approved", action: "retry_provisioning" });
    const d = env.duplicateCases[0]!;
    applyDecision(env, d.id, "retry_provisioning", ACTORS.operator);
    expect(env.repos.cases.get(d.id)!.decisions.at(-1)).toMatchObject({ edited: true });
  });
});

describe("Audit log", () => {
  it("filters by actor, action type, case, incident, outcome and date", () => {
    const env = setup();
    const rows = auditRows(env.repos, NOW);
    expect(rows.length).toBe(env.repos.audit.list().length);
    const operator = filterAudit(rows, { ...DEFAULT_AUDIT_FILTERS, actors: [ACTORS.operator] });
    expect(operator.every((r) => r.actor === ACTORS.operator)).toBe(true);
    const blocked = filterAudit(rows, { ...DEFAULT_AUDIT_FILTERS, outcomes: ["blocked"] });
    expect(blocked.length).toBeGreaterThan(0);
    const oneCase = filterAudit(rows, { ...DEFAULT_AUDIT_FILTERS, caseQuery: env.refusalCase.id });
    expect(oneCase.every((r) => r.caseId === env.refusalCase.id)).toBe(true);
    expect(filterAudit(rows, { ...DEFAULT_AUDIT_FILTERS, incidentIds: ["INC-0014"] }).every((r) => r.incidentId === "INC-0014")).toBe(true);
    expect(filterAudit(rows, { ...DEFAULT_AUDIT_FILTERS, categories: ["Configuration"] }).length).toBeGreaterThanOrEqual(7);
    expect(filterAudit(rows, { ...DEFAULT_AUDIT_FILTERS, from: "2026-06-15", to: "2026-06-15" }).every((r) => r.occurredAt >= "2026-06-14T18:30:00.000Z")).toBe(true);
  });

  it("is append-only", () => {
    const env = setup();
    const first = env.repos.audit.list()[0]!;
    expect(() => env.repos.audit.append(first)).toThrow(/already exists/);
    expect("update" in env.repos.audit).toBe(false);
    expect("remove" in env.repos.audit).toBe(false);
  });
});
