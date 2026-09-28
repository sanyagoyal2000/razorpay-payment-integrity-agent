import type { Repositories } from "@/repositories";
import { CASE_TYPE_LABELS } from "./overview";

export type CaseListRow = {
  id: string;
  customer: string;
  type: string;
  amount: number;
  status: import("@/domain/types").CaseStatus;
  paymentId: string;
  detectedAt: string;
};

export function caseListRows(repos: Repositories, caseIds: readonly string[]): CaseListRow[] {
  return caseIds
    .map((id) => repos.cases.get(id))
    .filter((c) => c !== undefined)
    .map((c) => ({
      id: c.id,
      customer: repos.payments.customer(c.customerId)?.name ?? c.customerId,
      type: CASE_TYPE_LABELS[c.type],
      amount: c.amountAtRisk,
      status: c.status,
      paymentId: c.paymentId,
      detectedAt: c.detectedAt,
    }))
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}
