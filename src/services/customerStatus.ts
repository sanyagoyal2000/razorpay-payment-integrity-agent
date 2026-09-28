import type { IntegrityCase, OutcomeContract } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { requireContract } from "@/services/policy/currentState";

export type CustomerStatus = "resolved" | "recovery_in_progress" | "under_review";

const OUTCOME_PHRASE: Record<string, string> = {
  course_access_granted: "your course access is now active",
  booking_confirmed: "your seat is confirmed",
  membership_activated: "your membership is now active",
  wallet_credited: "your credits have been added",
  plan_upgraded: "your plan upgrade is active",
};

function resolvedMessage(amount: number, contract: OutcomeContract) {
  return `Your ${formatINR(amount)} payment was successful and ${OUTCOME_PHRASE[contract.expectedOutcome] ?? "your purchase is complete"}.`;
}

/**
 * What a customer sees when they check this payment. Never exposes confidence,
 * internal errors, webhook status, policy thresholds or architecture.
 */
export function customerStatus(repos: Repositories, caseData: IntegrityCase): { status: CustomerStatus; message: string; reason: string } {
  const contract = requireContract(repos, caseData.outcomeContractId);
  const incident = caseData.incidentId ? repos.incidents.get(caseData.incidentId) : undefined;
  const accessPending = (incident?.containment ?? []).some((d) => d.action === "access_pending");
  if (caseData.status === "resolved") {
    return { status: "resolved", message: resolvedMessage(caseData.amountAtRisk, contract), reason: "Outcome confirmed" };
  }
  if (caseData.status === "approved" || caseData.status === "executing") {
    return {
      status: "recovery_in_progress",
      message: "We found your payment. Your access is being restored, and you will not be charged again.",
      reason: "Recovery approved and running",
    };
  }
  if (accessPending && caseData.status !== "rejected") {
    return {
      status: "recovery_in_progress",
      message: "We found your payment. Your access is being restored, and you will not be charged again.",
      reason: "Access pending is switched on for this incident",
    };
  }
  if (caseData.status === "observing") {
    return {
      status: "recovery_in_progress",
      message: "We found your payment. Your access is being set up, and you will not be charged again.",
      reason: "Outcome still within the normal processing time",
    };
  }
  return {
    status: "under_review",
    message: "Your payment is safe. A specialist is reviewing the order before any further action.",
    reason: "Case awaiting a decision",
  };
}
