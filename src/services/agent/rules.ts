import { formatINR } from "@/domain/money";
import type {
  AskAnswer,
  AskIncidentInput,
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
  { pattern: /\b(seat|workshop|event|booking|ticket)s?\b/i, outcome: "booking_confirmed", service: "booking-service", kinds: ["event_seat"], name: "Event booking", deadline: 300 },
  { pattern: /\b(membership|member|plus)\b/i, outcome: "membership_activated", service: "membership-service", kinds: ["membership"], name: "Membership activation", deadline: 300 },
  { pattern: /\b(credit|credits|wallet)\b/i, outcome: "wallet_credited", service: "wallet-service", kinds: ["credits"], name: "Wallet credit purchase", deadline: 60 },
  { pattern: /\b(upgrade|plan|team|teams)\b/i, outcome: "plan_upgraded", service: "billing-service", kinds: ["plan_upgrade"], name: "SaaS upgrade", deadline: 300 },
  { pattern: /\b(course|courses|package|packages|module|modules|learning|access|bundle|class)\b/i, outcome: "learning_access_granted", service: "learning-access-service", kinds: ["course", "bundle"], name: "Medical learning package purchase", deadline: 120 },
];

export function draftContractByRule(input: ContractDraftInput): ContractDraft {
  const text = input.description;
  const assumptions: string[] = [];
  const rule = OUTCOME_RULES.find((r) => r.pattern.test(text)) ?? OUTCOME_RULES.at(-1)!;
  if (!OUTCOME_RULES.some((r) => r.pattern.test(text))) assumptions.push("The description did not name a product type, so learning package access is assumed.");

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
  const risks: string[] = [];
  if (input.wrongActions > 0) risks.push(`${input.wrongActions} of ${input.executed} executed actions were later reversed or marked wrong.`);
  if (input.failedExecutions > 0) risks.push(`${input.failedExecutions} executed actions did not produce the promised outcome.`);
  for (const reason of input.editReasons.slice(0, 2)) risks.push(`You edited a recommendation because: ${reason}`);
  for (const reason of input.rejectionReasons.slice(0, 2)) risks.push(`You rejected a recommendation because: ${reason}`);
  if (risks.length === 0) risks.push("No edits, rejections, failures or reversals in the sample; it may not include unusual cases.");
  const suggestedMinimumConfidence = Math.max(0.95, input.minimumConfidence);
  return {
    headline: `${input.verifiedSuccessful} of the last ${input.executed} executed ${input.action.toLowerCase()} actions produced a verified outcome.`,
    explanation: input.eligible
      ? `Every automation criterion is met. You also approved ${input.approvedWithoutEdits} of the last ${input.considered} recommendations without edits, but approval is not what qualifies it: verified outcomes are.`
      : `Automation is not recommended yet: ${input.unmetCriteria.join("; ")}. You approved ${input.approvedWithoutEdits} of the last ${input.considered} recommendations without edits, but approval alone does not show the action worked.`,
    risks,
    suggestedMode: input.eligible ? "automatic_below_threshold" : "suggest_only",
    suggestedMaxValue: input.maxAutomaticValue,
    suggestedMinimumConfidence,
  };
}

// ---------------------------------------------------------------------------
// Ask RAY (offline): deterministic answers from the supplied facts and evidence
// ---------------------------------------------------------------------------

/**
 * Answers the three supported question kinds from the product's own facts and
 * evidence. Anything else is reported as out of scope rather than guessed.
 */
export function askByRule(input: AskIncidentInput): AskAnswer {
  const q = input.question.toLowerCase();
  const facts = (prefix: string) => input.facts.filter((f) => f.id.startsWith(prefix));
  if (/\bheld\b|\bhold|individual review|excluded|why .*(not|aren't|are not).*(bulk|recover)/.test(q)) {
    const held = facts("fact:held");
    if (held.length === 0) return { inScope: true, answer: "No cases are held for individual review right now.", citedIds: facts("fact:safe").map((f) => f.id), nextStep: "review_recovery" };
    return { inScope: true, answer: held.map((f) => f.statement).join(" "), citedIds: held.map((f) => f.id), nextStep: "review_recovery" };
  }
  if (/deploy|release|\bv\d+(\.\d+)+|what changed/.test(q)) {
    const signals = input.evidence.filter((e) => e.source === "platform_monitoring");
    if (signals.length === 0) {
      return { inScope: true, answer: "No deployment or service events are available for this incident from the connected sources.", citedIds: [], nextStep: "view_evidence" };
    }
    const lines = signals.map((e) => {
      const version = typeof e.detail?.["version"] === "string" ? ` ${e.detail["version"]}` : "";
      const signal = typeof e.detail?.["signal"] === "string" ? ` (${e.detail["signal"]})` : "";
      return `${e.type}${version}${signal}`;
    });
    return {
      inScope: true,
      answer: `Recorded service signals, in order: ${lines.join("; then ")}. ${facts("fact:service").map((f) => f.statement).join(" ")}`.trim(),
      citedIds: [...signals.map((e) => e.id), ...facts("fact:service").map((f) => f.id)],
      nextStep: "view_investigation",
    };
  }
  if (/approv|batch|bulk|what (would|will) happen/.test(q)) {
    const plan = [...facts("fact:safe"), ...facts("fact:plan")];
    return { inScope: true, answer: plan.map((f) => f.statement).join(" "), citedIds: plan.map((f) => f.id), nextStep: "review_recovery" };
  }
  return {
    inScope: false,
    answer: "I can only answer questions about this incident from its evidence, for example why cases are held, what changed around a deployment, or what approving the safe batch would do.",
    citedIds: [],
    nextStep: "none",
  };
}
