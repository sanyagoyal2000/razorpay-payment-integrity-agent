import type { ActionType, OutcomeContract, PolicyAction } from "@/domain/types";

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
  "enrolment-service": "grant_course_access",
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

export function serviceLabel(service: string): string {
  const name = service.replace(/-service$/, "").replace(/-/g, " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} service`;
}
