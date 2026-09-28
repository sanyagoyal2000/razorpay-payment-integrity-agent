import type {
  ActionMode,
  CurrentMerchantState,
  IntegrityCase,
  PolicyCheck,
  PolicyVerdict,
  Recommendation,
} from "@/domain/types";
import { formatINR } from "@/domain/money";
import { formatIstDateTime } from "@/domain/time";
import { ACTIONS, requiredScope, serviceLabel } from "./actions";

type Check = PolicyCheck;

const pass = (id: Check["id"], label: string, explanation: string, enforcement: Check["enforcement"] = "hard"): Check => ({
  id,
  label,
  status: "passed",
  explanation,
  enforcement,
});
const fail = (id: Check["id"], label: string, explanation: string, enforcement: Check["enforcement"] = "hard"): Check => ({
  id,
  label,
  status: "failed",
  explanation,
  enforcement,
});
const unknown = (id: Check["id"], label: string, explanation: string, enforcement: Check["enforcement"] = "hard"): Check => ({
  id,
  label,
  status: "unknown",
  explanation,
  enforcement,
});
const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * Deterministic policy engine. Pure: the same case, action and state always
 * produce the same verdict. A failed or unknown "hard" check blocks the action;
 * a failed "review" check requires individual approval.
 */
export function evaluatePolicy(
  caseData: IntegrityCase,
  action: Recommendation,
  currentState: CurrentMerchantState,
): PolicyVerdict {
  const definition = ACTIONS[action.action];
  const s = currentState;

  if (definition.kind === "none") {
    return {
      result: "allowed",
      action: action.action,
      checks: [pass("action_enabled", "No external action", `${definition.label} does not call any external system.`)],
      evaluatedAt: s.asOf,
    };
  }

  const checks: Check[] = [];
  const kind = definition.kind;
  const touchesPayment = kind === "fulfilment" || kind === "capture" || kind === "webhook";

  // Payment state
  if (kind === "capture") {
    checks.push(
      s.payment.status === "authorized"
        ? pass("payment_authorized", "Payment authorised", `${s.payment.id} is authorised and not yet captured.`)
        : fail("payment_authorized", "Payment authorised", `${s.payment.id} is ${s.payment.status}; only authorised payments can be captured.`),
    );
    const deadline = s.payment.captureDeadline;
    checks.push(
      !deadline
        ? unknown("capture_deadline", "Capture deadline not passed", "No capture deadline is recorded for this payment.")
        : Date.parse(deadline) > Date.parse(s.asOf)
          ? pass("capture_deadline", "Capture deadline not passed", `Capture is possible until ${formatIstDateTime(deadline)}.`)
          : fail("capture_deadline", "Capture deadline not passed", "The capture deadline has passed; the authorisation is being refunded."),
    );
  } else if (kind !== "communication" && kind !== "escalation") {
    checks.push(
      s.payment.status === "captured" || s.payment.status === "refunded"
        ? pass("payment_captured", "Payment captured", `${s.payment.id} was captured by Razorpay.`)
        : fail("payment_captured", "Payment captured", `${s.payment.id} is ${s.payment.status}, not captured.`),
    );
  }
  if (kind !== "communication" && kind !== "escalation") {
    checks.push(
      s.payment.status === "refunded"
        ? fail("payment_not_refunded", "Payment not refunded", `${s.payment.id} has been refunded; recovering the outcome would be wrong.`)
        : pass("payment_not_refunded", "Payment not refunded", "No refund recorded for this payment."),
    );
  }

  // Outcome state
  if (touchesPayment) {
    const outcomeCheck =
      s.outcome.state === "completed"
        ? fail("outcome_still_missing", "Outcome still missing", "The promised outcome has already been confirmed; no recovery is needed.")
        : s.outcome.state === "pending"
          ? fail("outcome_still_missing", "Outcome still missing", "The merchant reports the outcome as in progress; acting now could duplicate it.", "review")
          : pass("outcome_still_missing", "Outcome still missing", "No confirmed outcome has been received for this order.");
    checks.push(outcomeCheck);

    checks.push(
      s.successfulDuplicatePaymentIds.length === 0
        ? pass("no_successful_duplicate", "No successful duplicate", "No other captured payment exists for this purchase.", "review")
        : fail(
            "no_successful_duplicate",
            "No successful duplicate",
            `Another captured payment exists for this purchase (${s.successfulDuplicatePaymentIds.join(", ")}). Grant access once and review the extra charge.`,
            "review",
          ),
    );
  }

  // Inventory
  if (s.inventory.applicable && touchesPayment) {
    const inventoryEnforcement: Check["enforcement"] = s.controls.neverActAfterInventoryChange ? "hard" : "review";
    if (s.inventory.unchanged) {
      checks.push(pass("inventory_unchanged", "Inventory unchanged", "The originally purchased inventory is still valid.", inventoryEnforcement));
    } else {
      checks.push(fail("inventory_unchanged", "Inventory unchanged", "The original inventory changed after payment. Completing it could overbook.", inventoryEnforcement));
      checks.push(
        s.inventory.replacementAvailable === null
          ? unknown("replacement_inventory", "Valid replacement inventory", "No replacement has been confirmed by the merchant.")
          : s.inventory.replacementAvailable
            ? pass("replacement_inventory", "Valid replacement inventory", "The merchant reports valid replacement inventory.", "review")
            : fail("replacement_inventory", "Valid replacement inventory", "The merchant reports no replacement inventory."),
      );
    }
  }

  // Dependencies
  if (touchesPayment) {
    const label = `${serviceLabel(s.contract.fulfilmentService)} healthy`;
    checks.push(
      s.fulfilmentServiceHealth === "healthy"
        ? pass("fulfilment_service_healthy", label, `${s.contract.fulfilmentService} is responding normally.`)
        : fail("fulfilment_service_healthy", label, `${s.contract.fulfilmentService} is ${s.fulfilmentServiceHealth}; a retry now would fail again.`),
    );
    checks.push(
      s.outcomeVerificationAvailable
        ? pass("outcome_verification_available", "Outcome verification available", "Outcome Receipts can be confirmed after the action.")
        : fail("outcome_verification_available", "Outcome verification available", "Merchant outcome verification is unavailable, so the result could not be confirmed."),
    );
  }

  // Idempotency
  if (kind !== "escalation" && kind !== "refund_draft") {
    checks.push(
      s.idempotency.keyAvailable
        ? pass("idempotency_key_available", "Idempotency key available", `No previous execution of ${definition.label.toLowerCase()} for ${s.payment.id}.`)
        : fail("idempotency_key_available", "Idempotency key available", `${definition.label} was already executed for ${s.payment.id}; it will not run twice.`),
    );
  }

  // Thresholds
  if (touchesPayment || kind === "refund") {
    const limit = Math.min(s.contract.maxAutomaticValue, s.controls.maxAutomaticValue);
    checks.push(
      s.payment.amount <= limit
        ? pass("amount_within_limit", "Amount within limit", `${formatINR(s.payment.amount)} is within the ${formatINR(limit)} automatic limit.`, "review")
        : fail("amount_within_limit", "Amount within limit", `${formatINR(s.payment.amount)} is above the ${formatINR(limit)} automatic limit.`, "review"),
    );
  }
  if (touchesPayment) {
    const minimum = Math.max(s.contract.minimumConfidence, s.controls.minimumConfidence);
    checks.push(
      action.confidence >= minimum
        ? pass("confidence_threshold", "Confidence threshold met", `Confidence ${percent(action.confidence)} meets the ${percent(minimum)} minimum.`, "review")
        : fail("confidence_threshold", "Confidence threshold met", `Confidence ${percent(action.confidence)} is below the ${percent(minimum)} minimum.`, "review"),
    );
    const matchEnforcement: Check["enforcement"] = s.controls.neverActOnLowConfidenceMatch ? "hard" : "review";
    checks.push(
      s.recordMatch.method === "exact_key" || s.recordMatch.confidence >= minimum
        ? pass("record_match", "Payment matched to order", "Payment and merchant order matched on merchant_order_id.", matchEnforcement)
        : fail("record_match", "Payment matched to order", `Payment matched to the order with ${percent(s.recordMatch.confidence)} confidence.`, matchEnforcement),
    );
  }
  if (kind === "refund") {
    const remaining = s.controls.dailyRefundLimit - s.refundsIssuedToday;
    checks.push(
      s.payment.amount <= remaining
        ? pass("daily_refund_limit", "Daily refund limit", `${formatINR(remaining)} of today's ${formatINR(s.controls.dailyRefundLimit)} refund limit remains.`)
        : fail("daily_refund_limit", "Daily refund limit", `Refund would exceed today's ${formatINR(s.controls.dailyRefundLimit)} limit.`),
    );
  }

  // Contract
  if (touchesPayment) {
    checks.push(
      s.contract.status === "active"
        ? pass("contract_active", "Outcome Contract active", "The Outcome Contract is active.", "review")
        : fail("contract_active", "Outcome Contract active", `The Outcome Contract is ${s.contract.status}.`, "review"),
    );
    if (s.contract.alwaysReviewCaseTypes.includes(caseData.type)) {
      checks.push(fail("case_type_review", "Case type allows automation", "This Outcome Contract always requires review for this case type.", "review"));
    }
  }

  // Permission, action mode, kill switch
  const scope = requiredScope(action.action, s.contract);
  if (scope) {
    checks.push(
      s.grantedScopes.includes(scope)
        ? pass("permission_available", "Permission available", `Scope ${scope} is granted.`)
        : fail("permission_available", "Permission available", `Scope ${scope} is not granted to Payment Integrity.`),
    );
  }
  const mode: ActionMode | undefined = definition.policyAction ? s.actionModes[definition.policyAction] : undefined;
  checks.push(
    mode === "disabled"
      ? fail("action_enabled", "Action enabled", `${definition.label} is disabled in Automations.`)
      : pass("action_enabled", "Action enabled", `${definition.label} mode: ${modeLabel(mode)}.`),
  );
  if (kind === "communication" && s.controls.requireApprovalForCustomerCommunication) {
    checks.push(pass("customer_communication_approval", "Customer communication approval", "Global control requires approval before messaging customers."));
  }
  if (definition.pausable) {
    checks.push(
      s.controls.automationPaused
        ? fail("kill_switch", "Automated actions running", "All automated actions are paused. Monitoring and investigation continue.")
        : pass("kill_switch", "Automated actions running", "Automated actions are not paused."),
    );
  }

  return { ...decide(checks, mode, kind === "communication" && s.controls.requireApprovalForCustomerCommunication), action: action.action, checks, evaluatedAt: s.asOf };
}

function decide(
  checks: Check[],
  mode: ActionMode | undefined,
  forceApproval: boolean,
): Pick<PolicyVerdict, "result" | "approvalScope"> {
  if (checks.some((c) => c.enforcement === "hard" && c.status !== "passed")) return { result: "blocked" };
  if (checks.some((c) => c.enforcement === "review" && c.status !== "passed")) {
    return { result: "requires_approval", approvalScope: "individual" };
  }
  if (forceApproval || mode === "always_require_approval") return { result: "requires_approval", approvalScope: "individual" };
  if (mode === "automatic_below_threshold") return { result: "allowed" };
  return { result: "requires_approval", approvalScope: "bulk" };
}

export function modeLabel(mode: ActionMode | undefined): string {
  switch (mode) {
    case "suggest_only":
      return "Suggest only";
    case "automatic_below_threshold":
      return "Automatic below value and confidence thresholds";
    case "always_require_approval":
      return "Always require approval";
    case "disabled":
      return "Disabled";
    case undefined:
      return "Not configurable";
  }
}

/** Verdict used when the policy service itself cannot be reached. */
export function policyUnavailableVerdict(action: Recommendation, asOf: string): PolicyVerdict {
  return {
    result: "blocked",
    action: action.action,
    checks: [
      unknown("policy_service_available", "Policy service available", "The policy service is unavailable. Every execution is blocked until it recovers."),
    ],
    evaluatedAt: asOf,
  };
}
