import type { OutcomeEventType } from "./types";

export type FulfilmentVocabulary = {
  /** Merchant event when a fulfilment request is made. */
  requested: OutcomeEventType;
  /** Merchant event when the request fails. */
  failed: OutcomeEventType;
  endpoint: string;
};

/**
 * Each fulfilment service speaks its own language: a workshop seat is booked,
 * not granted access; a membership is activated. Keyed by the Outcome Contract's
 * fulfilment service.
 */
const VOCABULARY: Record<string, FulfilmentVocabulary> = {
  "learning-access-service": { requested: "learning_access.requested", failed: "learning_access.failed", endpoint: "/learning-access" },
  "booking-service": { requested: "booking.requested", failed: "booking.failed", endpoint: "/bookings" },
  "membership-service": { requested: "membership.activation_requested", failed: "membership.activation_failed", endpoint: "/memberships/activate" },
  "wallet-service": { requested: "wallet.credit_requested", failed: "wallet.credit_failed", endpoint: "/wallet/credits" },
  "billing-service": { requested: "plan.upgrade_requested", failed: "plan.upgrade_failed", endpoint: "/plans/upgrade" },
};

export function fulfilmentVocabulary(service: string): FulfilmentVocabulary {
  return VOCABULARY[service] ?? { requested: "learning_access.requested", failed: "learning_access.failed", endpoint: `/${service}` };
}

export const FULFILMENT_REQUEST_TYPES: ReadonlySet<string> = new Set(Object.values(VOCABULARY).map((v) => v.requested));
