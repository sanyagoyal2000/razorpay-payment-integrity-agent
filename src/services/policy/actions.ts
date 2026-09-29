import type { ActionType, OutcomeContract, PolicyAction } from "@/domain/types";

export const POLICY_ACTION_LABELS: Record<PolicyAction, string> = {
  retry_provisioning: "Retry provisioning",
  replay_webhook: "Replay webhook",
  capture_payment: "Capture payment",
  prepare_refund: "Prepare refund",
  issue_refund: "Issue refund",
  notify_customer: "Notify customer",
  escalate: "Escalate",
};

export type ActionDefinition = {
  label: string;
  /** Automations entry that governs the action; absent for actions with no external effect. */
  policyAction?: PolicyAction;
  kind: "fulfilment" | "capture" | "webhook" | "refund_draft" | "refund" | "communication" | "escalation" | "none";
  /** Whether the global kill switch stops this action. Escalation stays available. */
  pausable: boolean;
};

export const ACTIONS: Record<ActionType, ActionDefinition> = {
  retry_provisioning: { label: "Retry provisioning", policyAction: "retry_provisioning", kind: "fulfilment", pausable: true },
  review_duplicate: { label: "Grant once, review refund", policyAction: "retry_provisioning", kind: "fulfilment", pausable: true },
  replay_webhook: { label: "Replay webhook", policyAction: "replay_webhook", kind: "webhook", pausable: true },
  capture: { label: "Capture payment", policyAction: "capture_payment", kind: "capture", pausable: true },
  prepare_refund: { label: "Prepare refund", policyAction: "prepare_refund", kind: "refund_draft", pausable: false },
  refund_duplicate: { label: "Refund duplicate", policyAction: "issue_refund", kind: "refund", pausable: true },
  notify_customer: { label: "Notify customer", policyAction: "notify_customer", kind: "communication", pausable: true },
  escalate: { label: "Escalate for review", policyAction: "escalate", kind: "escalation", pausable: false },
  wait: { label: "Wait and re-check", kind: "none", pausable: false },
  review_alternate_inventory: { label: "Review alternate inventory", kind: "none", pausable: false },
};

const FULFILMENT_SCOPES: Record<string, string> = {
  "learning-access-service": "grant_learning_access",
  "booking-service": "confirm_booking",
  "membership-service": "activate_membership",
  "wallet-service": "credit_wallet",
  "billing-service": "upgrade_plan",
};

/** The write scope an action needs, or undefined when it writes nothing externally. */
export function requiredScope(action: ActionType, contract: Pick<OutcomeContract, "fulfilmentService">): string | undefined {
  switch (ACTIONS[action].kind) {
    case "fulfilment":
      return FULFILMENT_SCOPES[contract.fulfilmentService] ?? `fulfil_${contract.fulfilmentService}`;
    case "capture":
      return "capture_payment";
    case "webhook":
      return "replay_webhook";
    case "refund":
      return "issue_refund";
    case "communication":
      return "send_customer_message";
    case "escalation":
      return "create_incident";
    case "refund_draft":
    case "none":
      return undefined;
  }
}

/** Services with a proper name. Others read generically, e.g. "Booking service". */
const SERVICE_NAMES: Record<string, string> = {
  "learning-access-service": "Learning Access Service",
  "merchant-webhooks": "Merchant webhook endpoint",
};

export function serviceLabel(service: string): string {
  const named = SERVICE_NAMES[service];
  if (named) return named;
  const name = service.replace(/-service$/, "").replace(/-/g, " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} service`;
}

/** The service mid-sentence: "the Learning Access Service", "the booking service". */
export function theService(service: string): string {
  return `the ${SERVICE_NAMES[service] ? serviceLabel(service) : serviceLabel(service).toLowerCase()}`;
}

/** What re-running fulfilment means for each Outcome Contract's promised outcome. */
const FULFILMENT_LABELS: Record<string, string> = {
  learning_access_granted: "Restore learning access",
  booking_confirmed: "Reconfirm booking",
  membership_activated: "Activate membership",
  wallet_credited: "Credit wallet",
  plan_upgraded: "Apply plan upgrade",
};

/** Duplicate payments: fulfil once against the original charge, then review the second. */
const DUPLICATE_LABELS: Record<string, string> = {
  learning_access_granted: "Restore access once, review refund",
  booking_confirmed: "Confirm booking once, review refund",
  membership_activated: "Activate membership once, review refund",
  wallet_credited: "Credit wallet once, review refund",
  plan_upgraded: "Apply upgrade once, review refund",
};

/**
 * An action's label in the language of the contract it acts on, so an event
 * booking never reads as an access restoration. Without a contract, the generic label.
 */
export function actionLabel(action: ActionType, contract?: Pick<OutcomeContract, "expectedOutcome">): string {
  if (!contract) return ACTIONS[action].label;
  const fulfil = FULFILMENT_LABELS[contract.expectedOutcome];
  if (action === "retry_provisioning") return fulfil ?? "Retry fulfilment";
  if (action === "review_duplicate") return DUPLICATE_LABELS[contract.expectedOutcome] ?? ACTIONS.review_duplicate.label;
  return ACTIONS[action].label;
}
