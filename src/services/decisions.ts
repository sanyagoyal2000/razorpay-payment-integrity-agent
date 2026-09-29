import type { ActionType, CaseFollowUp, IntegrityCase, PolicyVerdict, Recommendation } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { refreshIncident } from "@/services/incidents";
import { isAtRisk } from "@/services/metrics/cases";
import { ACTIONS, actionLabel } from "@/services/policy/actions";
import { evaluateCase, requireContract } from "@/services/policy/currentState";
import { verifyOutcome } from "@/services/verification";
import { checkCustomerMessage } from "@/services/agent";
import { approveAndStart, EXECUTABLE_ACTIONS, type ExecutionDeps } from "@/services/execution";

export class DecisionError extends Error {}

const DECIDABLE = new Set(["open", "review_required", "escalated", "observing"]);
export const MIN_REJECTION_REASON = 10;

/** The recommendation to evaluate for `action`, keeping the agent's confidence and evidence. */
export function recommendationWithAction(c: IntegrityCase, action: ActionType, asOf: string): Recommendation {
  if (c.recommendation?.action === action) return c.recommendation;
  return {
    action,
    summary: c.recommendation?.summary ?? "",
    confidence: c.recommendation?.confidence ?? 0,
    evidenceIds: c.recommendation?.evidenceIds ?? [],
    uncertainties: c.recommendation?.uncertainties ?? [],
    customerImpact: c.recommendation?.customerImpact ?? "",
    consequenceOfInaction: c.recommendation?.consequenceOfInaction ?? "",
    origin: "merchant_edit",
    createdAt: asOf,
  };
}

export type DecisionOption = {
  action: ActionType;
  label: string;
  verdict: PolicyVerdict;
  executes: boolean;
  disabledReason?: string;
};

/** Whether a merchant action applies to this case at all, independent of policy. */
function applicability(c: IntegrityCase, action: ActionType, repos: Repositories): string | undefined {
  if (action === "review_duplicate" && c.relatedPaymentIds.length === 0) return "Only for duplicate payments.";
  if (action === "review_alternate_inventory" && !requireContract(repos, c.outcomeContractId).requiresInventoryCheck) return "Only for bookings with inventory.";
  if (action === "capture" && repos.payments.get(c.paymentId)?.status !== "authorized") return "Only for authorised, uncaptured payments.";
  return undefined;
}

export function decisionOption(repos: Repositories, c: IntegrityCase, action: ActionType, asOf: string): DecisionOption {
  const verdict = evaluateCase(repos, c, recommendationWithAction(c, action, asOf), asOf);
  const option: DecisionOption = { action, label: actionLabel(action, requireContract(repos, c.outcomeContractId)), verdict, executes: EXECUTABLE_ACTIONS.has(action) };
  const notApplicable = applicability(c, action, repos);
  if (!DECIDABLE.has(c.status)) option.disabledReason = `The case is ${c.status.replace("_", " ")}.`;
  else if (action === "notify_customer" && repos.payments.customer(c.customerId)?.emailOptOut) option.disabledReason = "The customer opted out of email. Contact them through Marrow support instead.";
  else if (notApplicable) option.disabledReason = notApplicable;
  else if (verdict.result === "blocked") {
    const failed = verdict.checks.filter((check) => check.status !== "passed" && check.enforcement === "hard");
    option.disabledReason = `Blocked by policy: ${failed.map((f) => f.explanation).join(" ")}`;
  }
  return option;
}

/** The actions the Edit control offers (spec), plus capture where it applies. */
export const EDIT_ACTIONS: ActionType[] = ["retry_provisioning", "wait", "prepare_refund", "review_duplicate", "escalate"];
/** Actions offered when automatic fulfilment was refused. */
export const REFUSAL_ACTIONS: ActionType[] = ["review_alternate_inventory", "notify_customer", "prepare_refund", "escalate"];

function addFollowUp(repos: Repositories, c: IntegrityCase, followUp: Omit<CaseFollowUp, "id">, patch: Partial<IntegrityCase> = {}) {
  return repos.cases.save({
    ...c,
    ...patch,
    followUps: [...(c.followUps ?? []), { id: repos.nextId("fu"), ...followUp }],
    updatedAt: followUp.createdAt,
  });
}

function requireCase(repos: Repositories, caseId: string): IntegrityCase {
  const c = repos.cases.get(caseId);
  if (!c) throw new DecisionError(`Case ${caseId} not found`);
  return c;
}

function audit(repos: Repositories, c: IntegrityCase, entry: { occurredAt: string; actor: string; action: string; result: string; policyResult?: PolicyVerdict["result"]; evidenceIds?: string[] }) {
  repos.audit.append({
    id: repos.nextId("aud"),
    targetType: "case",
    targetId: c.id,
    caseId: c.id,
    ...(c.incidentId ? { incidentId: c.incidentId } : {}),
    approvalSource: entry.actor === ACTORS.operator ? "merchant" : "not_required",
    ...entry,
  });
}

export function rejectRecommendation(repos: Repositories, caseId: string, reason: string, actor: string, asOf: string): IntegrityCase {
  const c = requireCase(repos, caseId);
  const trimmed = reason.trim();
  if (trimmed.length < MIN_REJECTION_REASON) throw new DecisionError(`Give a reason of at least ${MIN_REJECTION_REASON} characters.`);
  if (!DECIDABLE.has(c.status)) throw new DecisionError(`The case is ${c.status} and cannot be rejected.`);
  const saved = repos.cases.save({
    ...c,
    status: "rejected",
    decisions: [...c.decisions, { decidedAt: asOf, actor, kind: "rejected", ...(c.recommendation ? { action: c.recommendation.action } : {}), reason: trimmed }],
    updatedAt: asOf,
  });
  audit(repos, c, { occurredAt: asOf, actor, action: "Rejected recommendation", result: trimmed, evidenceIds: c.recommendation?.evidenceIds ?? [] });
  if (c.incidentId) refreshIncident(repos, c.incidentId, asOf);
  return saved;
}

export function escalate(repos: Repositories, caseId: string, reason: string, actor: string, asOf: string): IntegrityCase {
  const c = requireCase(repos, caseId);
  const option = decisionOption(repos, c, "escalate", asOf);
  if (option.disabledReason) throw new DecisionError(option.disabledReason);
  const detail = reason.trim() || "Escalated for review";
  const saved = addFollowUp(
    repos,
    c,
    { kind: "escalation", createdAt: asOf, actor, detail: `Posted to #payments-ops: ${detail}`, status: "open" },
    { status: "escalated", decisions: [...c.decisions, { decidedAt: asOf, actor, kind: "escalated", reason: detail }] },
  );
  audit(repos, c, { occurredAt: asOf, actor, action: "Escalated case", result: detail, policyResult: option.verdict.result });
  audit(repos, c, { occurredAt: asOf, actor: ACTORS.connector, action: "Posted escalation", result: "Posted to #payments-ops" });
  return saved;
}

/**
 * Re-fetches the outcome. Resolves the case if the promised outcome has since
 * arrived; otherwise records the check and leaves the case as it was.
 */
export function waitAndRecheck(repos: Repositories, caseId: string, actor: string, asOf: string): { resolved: boolean; message: string } {
  const c = requireCase(repos, caseId);
  if (!DECIDABLE.has(c.status)) throw new DecisionError(`The case is ${c.status}.`);
  const contract = requireContract(repos, c.outcomeContractId);
  const verification = verifyOutcome(repos, c, c.detectedAt, asOf);
  if (verification.status === "verified") {
    repos.cases.save({
      ...c,
      status: "resolved",
      decisions: [...c.decisions, { decidedAt: asOf, actor, kind: "wait" }],
      resolution: { resolvedAt: asOf, method: "outcome_arrived", actor: ACTORS.agent, receiptId: verification.receipt.id },
      updatedAt: asOf,
    });
    audit(repos, c, { occurredAt: asOf, actor: ACTORS.agent, action: "Closed case", result: `${contract.expectedOutcome} arrived without intervention`, evidenceIds: [verification.event.id] });
    if (c.incidentId) refreshIncident(repos, c.incidentId, asOf);
    return { resolved: true, message: `${contract.expectedOutcome} has arrived. Case resolved.` };
  }
  const message =
    verification.status === "unavailable"
      ? "Merchant outcome verification is unavailable. Nothing was changed."
      : `No ${contract.expectedOutcome} yet. The case stays ${c.status === "observing" ? "under observation" : "open"}.`;
  repos.cases.save({ ...c, decisions: [...c.decisions, { decidedAt: asOf, actor, kind: "wait" }], updatedAt: asOf });
  audit(repos, c, { occurredAt: asOf, actor, action: "Re-checked outcome", result: message });
  return { resolved: false, message };
}

/** Prepares a refund for the merchant's finance team. Payment Integrity cannot issue refunds itself. */
export function prepareRefund(repos: Repositories, caseId: string, actor: string, asOf: string): CaseFollowUp {
  const c = requireCase(repos, caseId);
  const option = decisionOption(repos, c, "prepare_refund", asOf);
  if (option.disabledReason) throw new DecisionError(option.disabledReason);
  const duplicate = c.relatedPaymentIds.map((id) => repos.payments.get(id)).find((p) => p?.status === "captured");
  const target = duplicate ?? repos.payments.get(c.paymentId)!;
  if ((c.followUps ?? []).some((f) => f.kind === "refund_draft" && f.paymentId === target.id)) throw new DecisionError("A refund is already prepared for this payment.");
  const detail = `${formatINR(target.amount)} refund of ${target.id} prepared for merchant finance${duplicate ? " (second charge)" : ""}`;
  const saved = addFollowUp(repos, c, { kind: "refund_draft", createdAt: asOf, actor, detail, paymentId: target.id, amount: target.amount, status: "awaiting_finance" });
  audit(repos, c, { occurredAt: asOf, actor, action: "Prepared refund", result: detail, policyResult: option.verdict.result, evidenceIds: [target.id] });
  return saved.followUps!.at(-1)!;
}

export function contactCustomer(repos: Repositories, caseId: string, actor: string, asOf: string, message?: string): CaseFollowUp {
  const c = requireCase(repos, caseId);
  const option = decisionOption(repos, c, "notify_customer", asOf);
  if (option.disabledReason) throw new DecisionError(option.disabledReason);
  const text = message?.trim();
  if (text !== undefined && text.length === 0) throw new DecisionError("The message is empty.");
  if (text) {
    const flagged = checkCustomerMessage(text);
    if (flagged.length > 0) throw new DecisionError(`Remove ${flagged.join(", ")} from the message before sending.`);
  }
  const detail = text ? `Email sent: “${text}”` : "Email sent: your payment is safe and a specialist is reviewing your order.";
  const saved = addFollowUp(repos, c, { kind: "customer_message", createdAt: asOf, actor, detail, status: "sent" }, { customerContact: c.customerContact === "customer_initiated" ? "customer_initiated" : "notified" });
  audit(repos, c, { occurredAt: asOf, actor, action: "Contacted customer", result: detail, policyResult: option.verdict.result });
  return saved.followUps!.at(-1)!;
}

export function requestAlternateInventory(repos: Repositories, caseId: string, actor: string, asOf: string): CaseFollowUp {
  const c = requireCase(repos, caseId);
  const option = decisionOption(repos, c, "review_alternate_inventory", asOf);
  if (option.disabledReason) throw new DecisionError(option.disabledReason);
  const detail = "Asked Marrow to confirm a valid replacement seat. Fulfilment stays blocked until one is confirmed.";
  const saved = addFollowUp(repos, c, { kind: "alternate_inventory_request", createdAt: asOf, actor, detail, status: "awaiting_merchant" });
  audit(repos, c, { occurredAt: asOf, actor, action: "Requested alternate inventory", result: detail });
  return saved.followUps!.at(-1)!;
}

export type DecisionResult = { kind: "execution"; executionId: string } | { kind: "recorded"; message: string };

/** Applies an approved or edited action, routing executable actions to the state machine. */
export function applyDecision(deps: ExecutionDeps, caseId: string, action: ActionType, actor: string, reason = "", message?: string): DecisionResult {
  const asOf = deps.clock.now().toISOString();
  const c = requireCase(deps.repos, caseId);
  if (EXECUTABLE_ACTIONS.has(action)) {
    const option = decisionOption(deps.repos, c, action, asOf);
    if (option.disabledReason) throw new DecisionError(option.disabledReason);
    const execution = approveAndStart(deps, { caseId, action, actor, approvalSource: "merchant" });
    return { kind: "execution", executionId: execution.id };
  }
  switch (action) {
    case "wait":
      return { kind: "recorded", message: waitAndRecheck(deps.repos, caseId, actor, asOf).message };
    case "escalate":
      escalate(deps.repos, caseId, reason, actor, asOf);
      return { kind: "recorded", message: "Escalated to #payments-ops." };
    case "prepare_refund":
      return { kind: "recorded", message: `${prepareRefund(deps.repos, caseId, actor, asOf).detail}.` };
    case "notify_customer":
      contactCustomer(deps.repos, caseId, actor, asOf, message);
      return { kind: "recorded", message: "Customer contacted." };
    case "review_alternate_inventory":
      requestAlternateInventory(deps.repos, caseId, actor, asOf);
      return { kind: "recorded", message: "Replacement seat requested from Marrow." };
    default:
      throw new DecisionError(`${ACTIONS[action].label} cannot be applied from a case.`);
  }
}

export function isOpenForDecision(c: IntegrityCase): boolean {
  return DECIDABLE.has(c.status) && (isAtRisk(c) || c.status === "observing");
}
