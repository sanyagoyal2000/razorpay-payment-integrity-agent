import type { OutcomeContract } from "@/domain/types";

export type ActionCallResult = {
  accepted: boolean;
  responseCode: number;
  /** IDs of events the call produced, used as execution evidence. */
  eventIds: string[];
};

/** Merchant-side fulfilment API (the Learning Access Service in this deployment). */
export type MerchantAdapter = {
  fulfil(input: { merchantOrderId: string; contract: OutcomeContract; idempotencyKey: string }): ActionCallResult;
};

/** Payment gateway actions (Razorpay in this deployment). */
export type PaymentGateway = {
  capture(input: { paymentId: string; idempotencyKey: string }): ActionCallResult;
  replayWebhook(input: { paymentId: string; idempotencyKey: string }): ActionCallResult;
};
