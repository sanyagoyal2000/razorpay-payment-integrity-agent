import type { IntegrityCase } from "@/domain/types";
import { sum } from "@/domain/money";
import { addDaysToDate, istDate, median, MS_PER_DAY, secondsBetween } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { isAtRisk } from "./cases";

/** A figure together with the cases it was computed from. */
export type TracedFigure = { value: number; caseIds: string[] };

export type PrimaryMetrics = {
  revenueAtRisk: TracedFigure;
  customersAffected: TracedFigure;
  openIncidents: { value: number; incidentIds: string[] };
  resolvedBeforeContact: TracedFigure;
};

export type ValueDelivered = {
  windowDays: 30;
  gmvResolvedBeforeRefundOrDispute: TracedFigure;
  avoidableRefundsPrevented: TracedFigure & { amount: number };
  supportContactsAvoided: TracedFigure;
  medianDetectionToVerifiedSeconds: { value: number | null; caseIds: string[] };
};

export const VALUE_DELIVERED_EXPLANATIONS = {
  gmvResolvedBeforeRefundOrDispute:
    "Amount at risk on cases resolved with a verified outcome in the last 30 days that would otherwise have been refunded or raised by the customer, and were not refunded.",
  avoidableRefundsPrevented:
    "Cases resolved with a verified outcome in the last 30 days whose payment Razorpay would otherwise have refunded automatically.",
  supportContactsAvoided:
    "Cases resolved with a verified outcome in the last 30 days, before the customer contacted LearnLoop. Counts one contact per case.",
  medianDetectionToVerifiedSeconds:
    "Median time from case detection to verified outcome, across the cases counted in GMV resolved.",
} as const;

const DEFAULT_COUNTED = new Set(["auto_refund", "customer_contact"]);

function windowStart(asOf: string, days: number): string {
  return new Date(Date.parse(asOf) - days * MS_PER_DAY).toISOString();
}

/** Resolved with a verified outcome (not merely closed) inside the window. */
function verifiedInWindow(c: IntegrityCase, since: string, asOf: string): boolean {
  return (
    c.status === "resolved" &&
    c.resolution !== undefined &&
    c.resolution.method !== "manual" &&
    c.resolution.resolvedAt >= since &&
    c.resolution.resolvedAt <= asOf &&
    c.wrongAction === undefined
  );
}

export function primaryMetrics(repos: Repositories, asOf: string): PrimaryMetrics {
  const cases = repos.cases.list();
  const atRisk = cases.filter(isAtRisk);
  const customers = new Map<string, string[]>();
  for (const c of atRisk) customers.set(c.customerId, [...(customers.get(c.customerId) ?? []), c.id]);
  const since = windowStart(asOf, 30);
  const beforeContact = cases.filter(
    (c) => verifiedInWindow(c, since, asOf) && DEFAULT_COUNTED.has(c.defaultOutcome) && c.customerContact !== "customer_initiated",
  );
  const openIncidents = repos.incidents.list().filter((i) => i.status !== "resolved");
  return {
    revenueAtRisk: { value: sum(atRisk.map((c) => c.amountAtRisk)), caseIds: atRisk.map((c) => c.id) },
    customersAffected: { value: customers.size, caseIds: atRisk.map((c) => c.id) },
    openIncidents: { value: openIncidents.length, incidentIds: openIncidents.map((i) => i.id) },
    resolvedBeforeContact: { value: beforeContact.length, caseIds: beforeContact.map((c) => c.id) },
  };
}

/**
 * "Value delivered (trailing 30 days)". Counts only cases whose default outcome
 * would have been an automatic refund or a customer contact. No projections.
 */
export function valueDelivered(repos: Repositories, asOf: string): ValueDelivered {
  const since = windowStart(asOf, 30);
  const counted = repos.cases
    .list()
    .filter((c) => verifiedInWindow(c, since, asOf) && DEFAULT_COUNTED.has(c.defaultOutcome))
    .filter((c) => repos.payments.get(c.paymentId)?.status !== "refunded");
  const refunds = counted.filter((c) => c.defaultOutcome === "auto_refund");
  const contacts = counted.filter((c) => c.defaultOutcome === "customer_contact" && c.customerContact !== "customer_initiated");
  const durations = counted.map((c) => secondsBetween(c.detectedAt, c.resolution!.resolvedAt));
  return {
    windowDays: 30,
    gmvResolvedBeforeRefundOrDispute: { value: sum(counted.map((c) => c.amountAtRisk)), caseIds: counted.map((c) => c.id) },
    avoidableRefundsPrevented: { value: refunds.length, amount: sum(refunds.map((c) => c.amountAtRisk)), caseIds: refunds.map((c) => c.id) },
    supportContactsAvoided: { value: contacts.length, caseIds: contacts.map((c) => c.id) },
    medianDetectionToVerifiedSeconds: { value: median(durations) ?? null, caseIds: counted.map((c) => c.id) },
  };
}

export type DailyPerformance = {
  date: string;
  paymentsCaptured: number;
  outcomesCompleted: number;
  completionRate: number;
  medianCompletionSeconds: number | null;
  casesResolved: number;
  casesResolvedBeforeContact: number;
};

/**
 * Daily payment-to-outcome performance across active contracts. Case payments
 * count as completed once their outcome is verified.
 */
export function dailyPerformance(repos: Repositories, asOf: string, days = 28): DailyPerformance[] {
  const today = istDate(asOf);
  const cases = repos.cases.list();
  const stats = repos.config.dailyStats();
  const result: DailyPerformance[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDaysToDate(today, -offset);
    const dayStats = stats.filter((s) => s.date === date);
    if (dayStats.length === 0) continue;
    const captured = sum(dayStats.map((s) => s.paymentsCaptured));
    const dayCases = cases.filter((c) => {
      const capturedAt = repos.payments.get(c.paymentId)?.capturedAt;
      return capturedAt !== undefined && istDate(capturedAt) === date && dayStats.some((s) => s.contractId === c.outcomeContractId);
    });
    const completedCases = dayCases.filter((c) => c.status === "resolved" && c.resolution && c.resolution.resolvedAt <= asOf);
    const completed = sum(dayStats.map((s) => s.outcomesConfirmedOnTime)) + completedCases.length;
    const course = dayStats.find((s) => s.contractId === "ctr_course_purchase");
    const resolvedThatDay = cases.filter((c) => c.resolution && istDate(c.resolution.resolvedAt) === date && c.resolution.resolvedAt <= asOf);
    result.push({
      date,
      paymentsCaptured: captured,
      outcomesCompleted: completed,
      completionRate: captured === 0 ? 0 : completed / captured,
      medianCompletionSeconds: course?.medianCompletionSeconds ?? null,
      casesResolved: resolvedThatDay.length,
      casesResolvedBeforeContact: resolvedThatDay.filter((c) => DEFAULT_COUNTED.has(c.defaultOutcome) && c.customerContact !== "customer_initiated" && !c.wrongAction).length,
    });
  }
  return result;
}

/** Share of executed recovery actions in the window that later proved wrong. */
export function wrongActionRate(repos: Repositories, asOf: string, days = 30): { rate: number; wrong: string[]; executed: string[] } {
  const since = windowStart(asOf, days);
  const executed = repos.executions.list().filter((e) => e.status === "resolved" && e.finishedAt && e.finishedAt >= since && e.finishedAt <= asOf);
  const wrong = executed.filter((e) => repos.cases.get(e.caseId)?.wrongAction !== undefined);
  return {
    rate: executed.length === 0 ? 0 : wrong.length / executed.length,
    wrong: wrong.map((e) => e.caseId),
    executed: executed.map((e) => e.caseId),
  };
}
