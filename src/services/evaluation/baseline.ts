import type { CauseId, EvalAction, EvidenceItem, Scenario } from "./types";

export type BaselineRuleId =
  | "outcome_already_verified"
  | "exact_duplicate"
  | "late_authorization_active"
  | "late_authorization_expired"
  | "inventory_changed"
  | "service_unhealthy"
  | "webhook_not_delivered"
  | "outcome_missing_after_deadline"
  | "no_rule";

export type BaselineResult = {
  rule: BaselineRuleId;
  ruleLabel: string;
  /** The cause the rule encodes; "no rule" asserts no cause. */
  cause: CauseId | "missing_outcome_symptom" | "none";
  action: EvalAction;
  citedIds: string[];
};

const RULE_LABELS: Record<BaselineRuleId, string> = {
  outcome_already_verified: "Promised outcome already recorded",
  exact_duplicate: "Two captures for the same merchant order",
  late_authorization_active: "Late authorisation, order still active",
  late_authorization_expired: "Late authorisation, order expired",
  inventory_changed: "Inventory changed after payment",
  service_unhealthy: "Fulfilment service currently unhealthy",
  webhook_not_delivered: "order.paid never delivered (non-2xx only)",
  outcome_missing_after_deadline: "Outcome missing after the contract deadline",
  no_rule: "No rule matched",
};

const detail = (item: EvidenceItem, key: string) => item.detail?.[key];

/**
 * A fair fixed-rule baseline. It sees exactly the investigator's input and
 * applies explicitly encoded patterns in a fixed order; when none matches it
 * escalates rather than guessing. Pure and deterministic, and separate from
 * the production policy engine.
 */
export function evaluateBaseline(scenario: Scenario): BaselineResult {
  const { evidence, contract } = scenario.input;
  const result = (rule: BaselineRuleId, cause: BaselineResult["cause"], action: EvalAction, cited: Array<string | undefined>): BaselineResult => ({
    rule,
    ruleLabel: RULE_LABELS[rule],
    cause,
    action,
    citedIds: cited.filter((id): id is string => id !== undefined),
  });
  const of = (source: EvidenceItem["source"], type: string) => evidence.filter((e) => e.source === source && e.type === type);

  // 1. The contracted outcome is already recorded as completed.
  const forThisOrder = (e: EvidenceItem) => detail(e, "merchantOrderId") === undefined || detail(e, "merchantOrderId") === scenario.input.merchantOrderId;
  const completed = evidence.find((e) => e.source === "merchant" && e.type === contract.expectedOutcome && detail(e, "status") === "completed" && forThisOrder(e));
  if (completed) return result("outcome_already_verified", "already_fulfilled", "wait", [completed.id]);

  // 2. Two different payments captured for the same merchant order.
  const captures = of("razorpay", "payment.captured").filter((e) => detail(e, "merchantOrderId") === scenario.input.merchantOrderId);
  if (new Set(captures.map((e) => detail(e, "paymentId"))).size > 1) return result("exact_duplicate", "duplicate_payment", "escalate", captures.map((e) => e.id));

  // 3. Authorised but never captured: active order → capture, expired → escalate.
  const authorized = of("razorpay", "payment.authorized").at(-1);
  if (authorized && captures.length === 0 && of("razorpay", "payment.captured").length === 0) {
    const expired = of("merchant", "order.expired").at(-1);
    if (expired) return result("late_authorization_expired", "late_authorization", "escalate", [authorized.id, expired.id]);
    const active = evidence.find((e) => e.source === "merchant" && detail(e, "orderStatus") === "active");
    if (active) return result("late_authorization_active", "late_authorization", "capture", [authorized.id, active.id]);
  }

  // 4. Inventory changed after payment.
  const inventory = of("merchant", "inventory_changed").at(-1);
  if (inventory) return result("inventory_changed", "inventory_conflict", "escalate", [inventory.id]);

  // 5. The latest service signal says the fulfilment service is failing.
  const health = evidence.filter((e) => e.source === "platform_monitoring" && e.type !== "deploy.completed").at(-1);
  if (health?.type === "service.errors_detected") return result("service_unhealthy", "fulfilment_failure", "wait", [health.id]);

  // 6. order.paid failed and never succeeded.
  const failed = of("razorpay", "webhook.failed");
  if (failed.length > 0 && of("razorpay", "webhook.delivered").length === 0) return result("webhook_not_delivered", "webhook_delivery_failure", "replay_webhook", failed.map((e) => e.id));

  // 7. Outcome missing after the deadline: the production recovery action.
  const missing = of("payment_integrity", "outcome_receipt.missing").at(-1);
  if (missing) return result("outcome_missing_after_deadline", "missing_outcome_symptom", "retry_provisioning", [missing.id]);

  return result("no_rule", "none", "escalate", []);
}
