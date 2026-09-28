import { formatINR } from "@/domain/money";
import type {
  AutonomyExplanation,
  AutonomyInput,
  ContractDraft,
  ContractDraftInput,
  MessageDraft,
  MessageDraftInput,
} from "./contracts";

/**
 * Deterministic versions of the agent's drafting tasks. They serve the product
 * when no live model is configured and back up the live model when its output
 * cannot be used.
 */

export function draftMessageByRule(input: MessageDraftInput): MessageDraft {
  const amount = input.amount !== undefined ? `${formatINR(input.amount)} ` : "";
  const bodies: Record<MessageDraftInput["situation"], string> = {
    access_being_restored: `Hi {first_name}, your ${amount}payment for ${input.productName} was successful. We are restoring your access now, and you will not be charged again. We will let you know as soon as it is active.`,
    under_review: `Hi {first_name}, your ${amount}payment for ${input.productName} is safe. A specialist is reviewing your order before any further action, and we will update you shortly.`,
    seat_changed: `Hi {first_name}, your ${amount}payment for ${input.productName} is safe. The seat you booked changed when the venue layout was updated, so our team is confirming the options available to you. You will not be charged again.`,
    payment_held: `Hi {first_name}, your bank confirmed your ${amount}payment for ${input.productName} after checkout had closed. We are completing your order now.`,
    second_charge_review: `Hi {first_name}, we noticed two payments of ${amount.trim() || "the same amount"} for ${input.productName}. We are restoring your access against the first payment and reviewing the second for a refund.`,
  };
  const subjects: Record<MessageDraftInput["situation"], string> = {
    access_being_restored: `Your ${input.productName} access`,
    under_review: `Your payment for ${input.productName}`,
    seat_changed: `Your seat for ${input.productName}`,
    payment_held: `Your payment for ${input.productName}`,
    second_charge_review: `Your payments for ${input.productName}`,
  };
  return { subject: subjects[input.situation], body: bodies[input.situation] };
}

const OUTCOME_RULES: Array<{ pattern: RegExp; outcome: ContractDraft["expectedOutcome"]; service: string; kinds: string[]; name: string; deadline: number }> = [
  { pattern: /\b(seat|workshop|event|booking|ticket)s?\b/i, outcome: "booking_confirmed", service: "enrolment-service", kinds: ["event_seat"], name: "Event booking", deadline: 300 },
  { pattern: /\b(membership|member|plus)\b/i, outcome: "membership_activated", service: "membership-service", kinds: ["membership"], name: "Membership activation", deadline: 300 },
  { pattern: /\b(credit|credits|wallet)\b/i, outcome: "wallet_credited", service: "wallet-service", kinds: ["credits"], name: "Wallet credit purchase", deadline: 60 },
  { pattern: /\b(upgrade|plan|team|teams)\b/i, outcome: "plan_upgraded", service: "billing-service", kinds: ["plan_upgrade"], name: "SaaS upgrade", deadline: 300 },
  { pattern: /\b(course|courses|access|bundle|class)\b/i, outcome: "course_access_granted", service: "enrolment-service", kinds: ["course", "bundle"], name: "Course purchase", deadline: 120 },
];

export function draftContractByRule(input: ContractDraftInput): ContractDraft {
  const text = input.description;
  const assumptions: string[] = [];
  const rule = OUTCOME_RULES.find((r) => r.pattern.test(text)) ?? OUTCOME_RULES.at(-1)!;
  if (!OUTCOME_RULES.some((r) => r.pattern.test(text))) assumptions.push("The description did not name a product type, so course access is assumed.");

  const duration = text.match(/(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i);
  let deadlineSeconds = rule.deadline;
  if (duration) {
    const n = Number(duration[1]);
    const unit = duration[2]!.toLowerCase();
    deadlineSeconds = unit.startsWith("h") ? n * 3600 : unit.startsWith("m") ? n * 60 : n;
  } else {
    assumptions.push(`No deadline was given; ${rule.deadline >= 60 ? `${rule.deadline / 60} minutes` : `${rule.deadline} seconds`} is used, the norm for this outcome.`);
  }

  const amountMatch = text.match(/(?:₹|rs\.?|inr)\s?([\d,]+)|(?:under|below|up to|upto|less than)\s+₹?\s?([\d,]+)/i);
  const parsedMax = amountMatch ? Number((amountMatch[1] ?? amountMatch[2] ?? "").replace(/,/g, "")) : NaN;
  const maxAutomaticValue = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.min(parsedMax, input.globalMaxAutomaticValue) : Math.min(5000, input.globalMaxAutomaticValue);
  if (!Number.isFinite(parsedMax)) assumptions.push(`No automatic limit was given; ${formatINR(maxAutomaticValue)} is used.`);
  else if (parsedMax > input.globalMaxAutomaticValue) assumptions.push(`The limit was capped at the global maximum of ${formatINR(input.globalMaxAutomaticValue)}.`);

  const productScope = input.products.filter((p) => rule.kinds.includes(p.kind)).map((p) => p.id);
  const inventory = rule.outcome === "booking_confirmed" || /\b(limited|stock|inventory|capacity)\b/i.test(text);
  if (inventory && rule.outcome !== "booking_confirmed") assumptions.push("Limited stock was mentioned, so an inventory check is required before fulfilment.");
  assumptions.push("Duplicate payments always need review.");

  return {
    name: rule.name,
    paymentType: rule.name.replace(/ (purchase|booking|activation|upgrade)$/i, "") + " payments",
    productScope,
    expectedOutcome: rule.outcome,
    matchingKey: "merchant_order_id",
    deadlineSeconds,
    fulfilmentService: input.fulfilmentServices.includes(rule.service) ? rule.service : input.fulfilmentServices[0] ?? rule.service,
    safeRecoveryAction: "retry_provisioning",
    verificationMethod: `${rule.outcome} event matched on merchant_order_id`,
    maxAutomaticValue,
    minimumConfidence: 0.95,
    alwaysReviewCaseTypes: inventory ? ["duplicate_payment", "inventory_conflict"] : ["duplicate_payment"],
    requiresInventoryCheck: inventory,
    customerNotificationTemplate: "Your payment for {product} was successful. We are completing your purchase and you will not be charged again.",
    assumptions,
  };
}

export function explainAutonomyByRule(input: AutonomyInput): AutonomyExplanation {
  const rate = input.considered === 0 ? 0 : input.approvedWithoutEdits / input.considered;
  const risks: string[] = [];
  if (input.wrongActionsLast30Days > 0) {
    risks.push(`${input.wrongActionsLast30Days} of ${input.executedLast30Days} executed actions in the last 30 days were later reversed.`);
  }
  for (const reason of input.editReasons.slice(0, 2)) risks.push(`You edited a recommendation because: ${reason}`);
  for (const reason of input.rejectionReasons.slice(0, 2)) risks.push(`You rejected a recommendation because: ${reason}`);
  if (risks.length === 0) risks.push("No edits, rejections or reversals in the period; the sample may not include unusual cases.");
  const suggestedMaxValue = Math.min(input.maxAutomaticValue, Math.max(1000, Math.ceil(input.medianAmount / 1000) * 1000));
  const strong = rate >= 0.9 && input.considered >= 20;
  return {
    headline: `${input.action} was approved without edits in ${input.approvedWithoutEdits} of the last ${input.considered} eligible cases.`,
    explanation: strong
      ? `Your decisions have matched the recommendation in ${Math.round(rate * 100)}% of recent cases. Running it automatically below ${formatINR(suggestedMaxValue)} at ${Math.round(Math.max(0.95, input.minimumConfidence) * 100)}% confidence or higher would cover typical purchases while larger or less certain cases still come to you.`
      : `Your decisions matched the recommendation in ${Math.round(rate * 100)}% of recent cases, which is not yet enough to recommend automation.`,
    risks,
    suggestedMode: strong ? "automatic_below_threshold" : "suggest_only",
    suggestedMaxValue,
    suggestedMinimumConfidence: Math.max(0.95, input.minimumConfidence),
  };
}
