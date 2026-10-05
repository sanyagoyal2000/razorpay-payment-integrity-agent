import { sum } from "@/domain/money";
import { addDaysToDate, istDate, median, secondsBetween } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { exposureOf, openCases, resolvedMetrics, type Exposure } from "./selectors";

/** A figure together with the cases it was computed from. */
export type TracedFigure = { value: number; caseIds: string[] };

export type PrimaryMetrics = {
  revenueAtRisk: TracedFigure;
  customersAffected: TracedFigure;
  openIncidents: { value: number; incidentIds: string[] };
  resolvedBeforeContact: TracedFigure;
  /** Cases, payments, customers and linked duplicate charges behind revenue at risk. */
  exposure: Exposure;
  /** How resolved-before-contact splits: one avoided contact or one prevented refund per case. */
  resolvedSplit: { contactsAvoided: number; refundsPrevented: number };
};

export type ValueDelivered = {
  windowDays: 30;
  gmvResolvedBeforeRefundOrDispute: TracedFigure;
  avoidableRefundsPrevented: TracedFigure & { amount: number };
  supportContactsAvoided: TracedFigure;
  medianDetectionToVerifiedSeconds: { value: number | null; caseIds: string[] };
  /** Counted in GMV, but the learner had contacted Marrow before the outcome was verified. */
  afterCustomerContact: string[];
};

export const VALUE_DELIVERED_EXPLANATIONS = {
  gmvResolvedBeforeRefundOrDispute:
    "Amount at risk (original payments) on cases resolved with a verified outcome in the last 30 days that would otherwise have been refunded or raised by the customer, and were not refunded. Includes cases where the learner had already contacted Marrow.",
  avoidableRefundsPrevented:
    "Late authorisations captured and resolved with a verified outcome in the last 30 days, before Razorpay's automatic refund and before the customer contacted Marrow.",
  supportContactsAvoided:
    "Cases resolved with a verified outcome in the last 30 days, before the learner contacted Marrow, whose default was a support contact. One estimated contact per case.",
  medianDetectionToVerifiedSeconds:
    "Median time from case detection to verified outcome, across the cases counted in GMV resolved.",
} as const;

const DEFAULT_COUNTED = new Set(["auto_refund", "customer_contact"]);

export function primaryMetrics(repos: Repositories, asOf: string): PrimaryMetrics {
  const atRisk = openCases(repos);
  const customers = new Set(atRisk.map((c) => c.customerId));
  const resolved = resolvedMetrics(repos, asOf);
  const openIncidents = repos.incidents.list().filter((i) => i.status !== "resolved");
  return {
    revenueAtRisk: { value: sum(atRisk.map((c) => c.amountAtRisk)), caseIds: atRisk.map((c) => c.id) },
    customersAffected: { value: customers.size, caseIds: atRisk.map((c) => c.id) },
    openIncidents: { value: openIncidents.length, incidentIds: openIncidents.map((i) => i.id) },
    resolvedBeforeContact: { value: resolved.beforeContact.length, caseIds: resolved.beforeContact },
    exposure: exposureOf(repos, atRisk),
    resolvedSplit: { contactsAvoided: resolved.contactsAvoided.length, refundsPrevented: resolved.refundsPrevented.length },
  };
}

/**
 * "Value delivered (trailing 30 days)". Counts only cases whose default outcome
 * would have been an automatic refund or a customer contact. No projections.
 * Built from the same sets as every other resolved figure (see resolvedMetrics).
 */
export function valueDelivered(repos: Repositories, asOf: string): ValueDelivered {
  const resolved = resolvedMetrics(repos, asOf);
  const counted = resolved.valueCounted.map((id) => repos.cases.get(id)!);
  const amount = (ids: readonly string[]) => sum(ids.map((id) => repos.cases.get(id)!.amountAtRisk));
  const durations = counted.map((c) => secondsBetween(c.detectedAt, c.resolution!.resolvedAt));
  return {
    windowDays: 30,
    gmvResolvedBeforeRefundOrDispute: { value: amount(resolved.valueCounted), caseIds: resolved.valueCounted },
    avoidableRefundsPrevented: { value: resolved.refundsPrevented.length, amount: amount(resolved.refundsPrevented), caseIds: resolved.refundsPrevented },
    supportContactsAvoided: { value: resolved.contactsAvoided.length, caseIds: resolved.contactsAvoided },
    medianDetectionToVerifiedSeconds: { value: median(durations) ?? null, caseIds: resolved.valueCounted },
    afterCustomerContact: resolved.afterCustomerContact,
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
    const dayCases = dayStats.flatMap((s) => s.caseIds).map((id) => repos.cases.get(id)).filter((c) => c !== undefined);
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
export function wrongActionRate(repos: Repositories, asOf: string): { rate: number; wrong: string[]; executed: string[] } {
  const { executedActions, reversedActions } = resolvedMetrics(repos, asOf);
  return { rate: executedActions.length === 0 ? 0 : reversedActions.length / executedActions.length, wrong: reversedActions, executed: executedActions };
}
