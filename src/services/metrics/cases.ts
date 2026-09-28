import type { CaseStatus, Incident, IncidentRecord, IntegrityCase } from "@/domain/types";
import { sum } from "@/domain/money";

/** Statuses in which a payment's outcome is still owed and the money counts as at risk. */
export const AT_RISK_STATUSES: ReadonlySet<CaseStatus> = new Set<CaseStatus>([
  "open",
  "review_required",
  "approved",
  "executing",
  "escalated",
]);

export const isAtRisk = (c: IntegrityCase): boolean => AT_RISK_STATUSES.has(c.status);

export type IncidentTotals = {
  /** All cases in the incident, whatever their status. */
  caseCount: number;
  initialAmountAtRisk: number;
  resolvedAmount: number;
  remainingAtRisk: number;
  refundExposure: number;
  affectedCustomers: number;
  customersAtRisk: number;
  openCaseIds: string[];
  resolvedCaseIds: string[];
};

export function incidentTotals(record: IncidentRecord, cases: readonly IntegrityCase[]): IncidentTotals {
  const own = cases.filter((c) => c.incidentId === record.id);
  const open = own.filter(isAtRisk);
  const resolved = own.filter((c) => c.status === "resolved");
  return {
    caseCount: own.length,
    initialAmountAtRisk: sum(own.map((c) => c.amountAtRisk)),
    resolvedAmount: sum(resolved.map((c) => c.amountAtRisk)),
    remainingAtRisk: sum(open.map((c) => c.amountAtRisk)),
    refundExposure: sum(open.map((c) => c.refundExposure)),
    affectedCustomers: new Set(own.map((c) => c.customerId)).size,
    customersAtRisk: new Set(open.map((c) => c.customerId)).size,
    openCaseIds: open.map((c) => c.id),
    resolvedCaseIds: resolved.map((c) => c.id),
  };
}

/** The spec's Incident shape: `amountAtRisk` is what remains at risk now. */
export function toIncident(record: IncidentRecord, cases: readonly IntegrityCase[]): Incident {
  const totals = incidentTotals(record, cases);
  return { ...record, amountAtRisk: totals.remainingAtRisk, affectedCustomers: totals.affectedCustomers };
}
