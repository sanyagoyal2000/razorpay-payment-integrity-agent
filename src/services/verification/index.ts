import type { IntegrityCase, MerchantOutcomeEvent, OutcomeReceipt } from "@/domain/types";
import type { Repositories } from "@/repositories";
import { requireContract } from "@/services/policy/currentState";

export type VerificationResult =
  | { status: "verified"; event: MerchantOutcomeEvent; receipt: OutcomeReceipt }
  | { status: "pending" }
  | { status: "unavailable" };

/**
 * Confirms the contracted outcome for a case: a completed outcome event for the
 * order, received after `since` and no later than `asOf`. On success the
 * payment's Outcome Receipt is marked confirmed (created if the payment had
 * none, e.g. a late authorisation that was just captured).
 */
export function verifyOutcome(repos: Repositories, caseData: IntegrityCase, since: string, asOf: string): VerificationResult {
  if (!repos.config.flags().outcomeVerificationAvailable) return { status: "unavailable" };
  const payment = repos.payments.get(caseData.paymentId);
  if (!payment) throw new Error(`Payment ${caseData.paymentId} not found`);
  const contract = requireContract(repos, caseData.outcomeContractId);
  const event = repos.outcomes
    .events(payment.merchantOrderId)
    .find((e) => e.type === contract.expectedOutcome && e.status === "completed" && e.occurredAt >= since && e.occurredAt <= asOf);
  if (!event) return { status: "pending" };

  const existing = repos.outcomes.receiptForPayment(payment.id);
  const receipt: OutcomeReceipt = {
    id: existing?.id ?? repos.nextId("rcpt"),
    paymentId: payment.id,
    merchantOrderId: payment.merchantOrderId,
    contractId: contract.id,
    expectedBy: existing?.expectedBy ?? event.occurredAt,
    status: "confirmed",
    outcomeEventId: event.id,
    confirmedAt: asOf,
  };
  repos.outcomes.saveReceipt(receipt);
  return { status: "verified", event, receipt };
}
