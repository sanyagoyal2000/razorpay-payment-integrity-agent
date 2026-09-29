import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { customerStatus } from "./customerStatus";
import { requireContract } from "./policy/currentState";

export type LookupResult =
  | { status: "resolved" | "recovery_in_progress" | "under_review" | "refunded"; message: string; productName: string; amount: number }
  | { status: "not_found"; message: string };

export const NOT_FOUND_MESSAGE = "We couldn't find a matching payment. Check your details or contact Marrow support.";

const OUTCOME_PHRASE: Record<string, string> = {
  learning_access_granted: "your learning package access is now active",
  booking_confirmed: "your seat is confirmed",
  membership_activated: "your membership is now active",
  wallet_credited: "your credits have been added",
  plan_upgraded: "your plan upgrade is active",
};

export function normaliseOrderId(input: string): string {
  const compact = input.trim().toUpperCase().replace(/\s+/g, "");
  const digits = compact.replace(/^MR-?/, "");
  return /^\d+$/.test(digits) ? `MR-${digits}` : compact;
}

export function lastTenDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function validateLookup(phone: string, orderId: string): { phone?: string; orderId?: string } {
  const errors: { phone?: string; orderId?: string } = {};
  if (lastTenDigits(phone).length !== 10) errors.phone = "Enter the 10-digit mobile number you paid with.";
  if (!/^MR-\d{5,}$/.test(normaliseOrderId(orderId))) errors.orderId = "Enter the order ID from your confirmation, for example MR-4301232.";
  return errors;
}

/**
 * The customer-facing payment check. Requires both the order ID and the phone
 * number on the order; a mismatch looks exactly like an unknown order. Returns
 * only customer-safe wording: no confidence, internal errors, webhooks,
 * thresholds or architecture.
 */
export function lookupPayment(repos: Repositories, input: { phone: string; orderId: string }, asOf: string): LookupResult {
  const order = repos.payments.order(normaliseOrderId(input.orderId));
  if (!order || order.createdAt > asOf) return { status: "not_found", message: NOT_FOUND_MESSAGE };
  const customer = repos.payments.customer(order.customerId);
  if (!customer || lastTenDigits(customer.phone) !== lastTenDigits(input.phone)) return { status: "not_found", message: NOT_FOUND_MESSAGE };
  const payment = repos.payments.list().find((p) => p.merchantOrderId === order.id && p.createdAt <= asOf);
  const product = repos.payments.product(order.productId);
  if (!payment || !product || payment.status === "created" || payment.status === "failed") return { status: "not_found", message: NOT_FOUND_MESSAGE };
  const base = { productName: product.name, amount: payment.amount };

  const direct = repos.cases.list().find((c) => c.paymentId === payment.id);
  const asDuplicate = repos.cases.list().find((c) => c.relatedPaymentIds.includes(payment.id));
  if (payment.status === "refunded") {
    return { status: "refunded", message: `Your ${formatINR(payment.amount)} payment has been refunded to your original payment method.`, ...base };
  }
  if (asDuplicate) {
    const main = customerStatus(repos, asDuplicate);
    return {
      status: main.status === "resolved" ? "under_review" : main.status,
      message:
        main.status === "resolved"
          ? `This is a second payment for ${product.name}. Your access is active from your first payment, and this payment is being reviewed for a refund.`
          : main.message,
      ...base,
    };
  }
  if (direct) {
    const view = customerStatus(repos, direct);
    return { status: view.status, message: view.message, ...base };
  }
  const receipt = repos.outcomes.receiptForPayment(payment.id);
  const contract = requireContract(repos, product.contractId);
  if (receipt?.status === "confirmed" && (receipt.confirmedAt ?? "") <= asOf) {
    return { status: "resolved", message: `Your ${formatINR(payment.amount)} payment was successful and ${OUTCOME_PHRASE[contract.expectedOutcome] ?? "your purchase is complete"}.`, ...base };
  }
  return { status: "recovery_in_progress", message: "We found your payment. Your access is being set up, and you will not be charged again.", ...base };
}
