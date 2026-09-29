import { describe, expect, it } from "vitest";
import { buildDataset, FIXTURE_ANCHOR_DATE } from "@/fixtures/build";
import { rebaseDataset, rebaseOffsetMinutes } from "@/fixtures/rebase";
import { istDate, istTime, istToIso } from "@/domain/time";
import { sum } from "@/domain/money";
import { fixtures } from "./helpers";

const COURSE_PRICES = new Set([999, 2499, 3499, 4999, 9999]);

describe("fixtures", () => {
  it("are deterministic: the builder reproduces the committed JSON exactly", () => {
    expect(JSON.parse(JSON.stringify(buildDataset()))).toEqual(fixtures);
  });

  it("build the active incident from real course prices with exact group totals", () => {
    const cases = fixtures.cases.filter((c) => c.incidentId === "INC-0017");
    const safe = cases.filter((c) => c.type === "missing_outcome" && c.amountAtRisk <= 5000);
    const duplicates = cases.filter((c) => c.type === "duplicate_payment");
    const highValue = cases.filter((c) => c.amountAtRisk > 5000);
    expect(cases).toHaveLength(43);
    expect(new Set(cases.map((c) => c.customerId)).size).toBe(43);
    expect([safe.length, duplicates.length, highValue.length]).toEqual([38, 3, 2]);
    expect(sum(safe.map((c) => c.amountAtRisk))).toBe(151_962);
    expect(sum(duplicates.map((c) => c.amountAtRisk))).toBe(10_497);
    expect(sum(highValue.map((c) => c.amountAtRisk))).toBe(19_998);
    expect(sum(cases.map((c) => c.amountAtRisk))).toBe(182_457);
    for (const c of cases) expect(COURSE_PRICES.has(c.amountAtRisk)).toBe(true);
  });

  it("count only the original payment as at risk for duplicates and track the second charge as refund exposure", () => {
    const duplicates = fixtures.cases.filter((c) => c.incidentId === "INC-0017" && c.type === "duplicate_payment");
    for (const c of duplicates) {
      const original = fixtures.payments.find((p) => p.id === c.paymentId)!;
      const second = fixtures.payments.find((p) => p.id === c.relatedPaymentIds[0])!;
      expect(c.amountAtRisk).toBe(original.amount);
      expect(c.refundExposure).toBe(second.amount);
      expect(second.status).toBe("captured");
      expect(second.customerId).toBe(original.customerId);
    }
  });

  it("include the v2.3 deploy.completed event at 14:04 IST from Platform Monitoring", () => {
    const deploy = fixtures.observabilityEvents.find((e) => e.type === "deploy.completed" && e.metadata?.["version"] === "v2.3")!;
    expect(deploy.source).toBe("platform_monitoring");
    expect(istDate(deploy.occurredAt)).toBe(FIXTURE_ANCHOR_DATE);
    expect(istTime(deploy.occurredAt)).toBe("14:04:00");
    expect(fixtures.integrations.find((i) => i.id === "platform_monitoring")).toMatchObject({ status: "connected", access: "read_only" });
    const incidentEvidence = (fixtures.investigationResponses["INC-0017"] as { evidenceIds: string[] }).evidenceIds;
    expect(incidentEvidence).toContain(deploy.id);
  });

  it("contain the reference case timeline", () => {
    const order = fixtures.paymentEvents.find((e) => e.type === "order.created" && e.occurredAt === istToIso(FIXTURE_ANCHOR_DATE, "14:07:02"))!;
    const events = fixtures.paymentEvents.filter((e) => e.paymentId === order.paymentId).map((e) => [e.type, istTime(e.occurredAt)]);
    expect(events).toEqual([
      ["order.created", "14:07:02"],
      ["payment.authorized", "14:07:08"],
      ["payment.captured", "14:07:09"],
      ["order.paid", "14:07:10"],
    ]);
    const payment = fixtures.payments.find((p) => p.id === order.paymentId)!;
    const outcomes = fixtures.outcomeEvents.filter((e) => e.merchantOrderId === payment.merchantOrderId);
    expect(outcomes.find((e) => e.type === "learning_access.failed")).toMatchObject({ responseCode: 500 });
    expect(payment.amount).toBe(2499);
  });

  it("cite only evidence IDs that exist", () => {
    const ids = new Set([
      ...fixtures.paymentEvents,
      ...fixtures.webhookDeliveries,
      ...fixtures.outcomeEvents,
      ...fixtures.observabilityEvents,
      ...fixtures.outcomeReceipts,
      ...fixtures.cases,
    ].map((e) => e.id));
    for (const response of Object.values(fixtures.investigationResponses)) {
      for (const id of (response as { evidenceIds: string[] }).evidenceIds) expect(ids.has(id)).toBe(true);
    }
    for (const event of fixtures.auditEvents) {
      for (const id of event.evidenceIds ?? []) expect(ids.has(id) || fixtures.cases.some((c) => c.id === id), `${event.id} cites ${id}`).toBe(true);
    }
  });

  it("never embed wall-clock times in generated text, so anchoring cannot contradict them", () => {
    const text = JSON.stringify({ cases: fixtures.cases, incidents: fixtures.incidents, updates: fixtures.incidentUpdates, investigations: fixtures.investigationResponses, audit: fixtures.auditEvents.map((e) => e.result) });
    const withoutTimestamps = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z/g, "");
    expect(withoutTimestamps).not.toMatch(/\b\d{1,2}:\d{2}(:\d{2})?\s*IST/);
  });

  it("keep references consistent", () => {
    const paymentIds = new Set(fixtures.payments.map((p) => p.id));
    const orderIds = new Set(fixtures.orders.map((o) => o.id));
    const customerIds = new Set(fixtures.customers.map((c) => c.id));
    for (const c of fixtures.cases) {
      expect(paymentIds.has(c.paymentId)).toBe(true);
      expect(customerIds.has(c.customerId)).toBe(true);
    }
    for (const p of fixtures.payments) expect(orderIds.has(p.merchantOrderId)).toBe(true);
    for (const incident of fixtures.incidents) {
      for (const id of incident.caseIds) expect(fixtures.cases.find((c) => c.id === id)?.incidentId).toBe(incident.id);
    }
    expect(new Set(fixtures.cases.map((c) => c.id)).size).toBe(fixtures.cases.length);
  });

  it("include the waiting, refusal and late-authorisation cases", () => {
    const waiting = fixtures.cases.filter((c) => c.status === "observing");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.observation).toEqual({ observedDelaySeconds: 70, normalRangeSeconds: { p50: 18, p95: 96 } });
    expect(waiting[0]!.recommendation).toBeUndefined();
    expect(fixtures.cases.filter((c) => c.type === "inventory_conflict" && c.status === "review_required")).toHaveLength(1);
    expect(fixtures.cases.filter((c) => c.type === "late_authorization" && c.status === "open")).toHaveLength(1);
  });
});

describe("anchoring to the real clock", () => {
  it("places the latest event about a minute before now and keeps relative timing", () => {
    const now = new Date("2026-09-28T07:03:27Z");
    const minutes = rebaseOffsetMinutes(fixtures, now);
    const rebased = rebaseDataset(fixtures, minutes);
    const lead = now.getTime() - Date.parse(rebased.meta.horizon);
    expect(lead).toBeGreaterThanOrEqual(60_000);
    expect(lead).toBeLessThan(120_000);
    const deploy = (d: typeof fixtures) => Date.parse(d.observabilityEvents.find((e) => e.metadata?.["version"] === "v2.3")!.occurredAt);
    expect(Date.parse(rebased.meta.horizon) - deploy(rebased)).toBe(Date.parse(fixtures.meta.horizon) - deploy(fixtures));
    expect(rebased.dailyStats.at(-1)!.date).toBe(istDate(rebased.meta.horizon));
  });

  it("applies no shift one minute after the horizon", () => {
    expect(rebaseOffsetMinutes(fixtures, new Date(Date.parse(fixtures.meta.horizon) + 60_000))).toBe(0);
  });
});
