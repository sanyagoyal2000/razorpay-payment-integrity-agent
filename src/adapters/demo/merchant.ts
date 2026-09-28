import type { MerchantOutcomeEvent, OutcomeContract, PaymentEvent, WebhookDelivery } from "@/domain/types";
import { fulfilmentVocabulary } from "@/domain/fulfilment";
import { addSeconds, type Clock } from "@/domain/time";
import { WEBHOOK_ENDPOINT } from "@/fixtures/catalogue";
import type { Repositories } from "@/repositories";
import { serviceHealth } from "@/services/policy/currentState";
import type { ActionCallResult, MerchantAdapter, PaymentGateway } from "@/adapters/merchant/types";

/** Seconds between a fulfilment request and the merchant's confirmation. */
export const SIMULATED_FULFILMENT_LATENCY_SECONDS = 2;

/**
 * Simulated LearnLoop Enrolment API. Succeeds when the fulfilment service is
 * healthy, fails with HTTP 500 when it is down, and never fulfils the same
 * idempotency key twice.
 */
export function createDemoMerchant(repos: Repositories, clock: Clock): MerchantAdapter {
  return {
    fulfil({ merchantOrderId, contract, idempotencyKey }) {
      const previous = repos.outcomes
        .events(merchantOrderId)
        .filter((e) => e.metadata?.["idempotencyKey"] === idempotencyKey);
      if (previous.length > 0) {
        return { accepted: true, responseCode: 200, eventIds: previous.map((e) => e.id) };
      }
      return requestFulfilment(repos, clock.now().toISOString(), merchantOrderId, contract, idempotencyKey);
    },
  };
}

function requestFulfilment(
  repos: Repositories,
  now: string,
  merchantOrderId: string,
  contract: OutcomeContract,
  idempotencyKey: string,
): ActionCallResult {
  const fulfil = fulfilmentVocabulary(contract.fulfilmentService);
  const request: MerchantOutcomeEvent = {
    id: repos.nextId("ll_evt"),
    merchantOrderId,
    source: "learnloop",
    type: fulfil.requested,
    status: "pending",
    occurredAt: now,
    metadata: { endpoint: fulfil.endpoint, initiatedBy: "payment_integrity", idempotencyKey },
  };
  repos.outcomes.appendEvent(request);
  if (serviceHealth(repos, contract.fulfilmentService, now) !== "healthy") {
    const failed: MerchantOutcomeEvent = {
      id: repos.nextId("ll_evt"),
      merchantOrderId,
      source: "learnloop",
      type: fulfil.failed,
      status: "failed",
      responseCode: 500,
      occurredAt: now,
      metadata: { endpoint: fulfil.endpoint, idempotencyKey },
    };
    repos.outcomes.appendEvent(failed);
    return { accepted: false, responseCode: 500, eventIds: [request.id, failed.id] };
  }
  const completed: MerchantOutcomeEvent = {
    id: repos.nextId("ll_evt"),
    merchantOrderId,
    source: "learnloop",
    type: contract.expectedOutcome,
    status: "completed",
    responseCode: 200,
    occurredAt: addSeconds(now, SIMULATED_FULFILMENT_LATENCY_SECONDS),
    metadata: { idempotencyKey },
  };
  repos.outcomes.appendEvent(completed);
  return { accepted: true, responseCode: 202, eventIds: [request.id] };
}

/** Simulated Razorpay actions. Capture and webhook replay both lead LearnLoop to fulfil the order. */
export function createDemoGateway(repos: Repositories, clock: Clock, merchant: MerchantAdapter): PaymentGateway {
  const contractFor = (merchantOrderId: string) => {
    const order = repos.payments.order(merchantOrderId);
    const product = order ? repos.payments.product(order.productId) : undefined;
    const contract = product ? repos.config.contract(product.contractId) : undefined;
    if (!contract) throw new Error(`No Outcome Contract for order ${merchantOrderId}`);
    return contract;
  };
  const deliverOrderPaid = (paymentId: string, orderPaidId: string, now: string, attempt: number) => {
    const delivery: WebhookDelivery = {
      id: repos.nextId("whd"),
      eventId: orderPaidId,
      endpoint: WEBHOOK_ENDPOINT,
      attempt,
      responseCode: 200,
      latencyMs: 320,
      status: "delivered",
      occurredAt: now,
    };
    repos.payments.appendDelivery(delivery);
    return delivery;
  };

  return {
    capture({ paymentId, idempotencyKey }) {
      const payment = repos.payments.get(paymentId);
      if (!payment) return { accepted: false, responseCode: 404, eventIds: [] };
      const now = clock.now().toISOString();
      if (payment.status !== "authorized" || (payment.captureDeadline && payment.captureDeadline <= now)) {
        return { accepted: false, responseCode: 400, eventIds: [] };
      }
      const captured: PaymentEvent = { id: repos.nextId("evt"), paymentId, source: "razorpay", type: "payment.captured", occurredAt: now, metadata: { amount: payment.amount, initiatedBy: "payment_integrity", idempotencyKey } };
      const orderPaid: PaymentEvent = { id: repos.nextId("evt"), paymentId, source: "razorpay", type: "order.paid", occurredAt: now };
      repos.payments.appendEvent(captured);
      repos.payments.appendEvent(orderPaid);
      repos.payments.save({ ...payment, status: "captured", capturedAt: now });
      const delivery = deliverOrderPaid(paymentId, orderPaid.id, now, 1);
      const fulfilment = merchant.fulfil({ merchantOrderId: payment.merchantOrderId, contract: contractFor(payment.merchantOrderId), idempotencyKey });
      return { accepted: fulfilment.accepted, responseCode: 200, eventIds: [captured.id, orderPaid.id, delivery.id, ...fulfilment.eventIds] };
    },
    replayWebhook({ paymentId, idempotencyKey }) {
      const payment = repos.payments.get(paymentId);
      const orderPaid = repos.payments.events(paymentId).find((e) => e.type === "order.paid");
      if (!payment || !orderPaid) return { accepted: false, responseCode: 404, eventIds: [] };
      const now = clock.now().toISOString();
      const delivery = deliverOrderPaid(paymentId, orderPaid.id, now, repos.payments.deliveriesForEvent(orderPaid.id).length + 1);
      const fulfilment = merchant.fulfil({ merchantOrderId: payment.merchantOrderId, contract: contractFor(payment.merchantOrderId), idempotencyKey });
      return { accepted: fulfilment.accepted, responseCode: 200, eventIds: [delivery.id, ...fulfilment.eventIds] };
    },
  };
}
