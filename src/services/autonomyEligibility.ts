import type { ActionType, CaseType, GlobalControls, OutcomeContract } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { AutonomyEvidence } from "@/services/metrics/autonomy";
import { ACTIONS, requiredScope } from "@/services/policy/actions";

/** Deterministic thresholds. An explanation from the agent can never relax them. */
export const AUTONOMY_THRESHOLDS = {
  minExecuted: 30,
  minVerificationRate: 0.98,
  maxWrongActions: 0,
} as const;

/**
 * Actions that may ever be suggested for limited automation. Refunds,
 * captures, inventory decisions and customer messages stay review-only.
 */
export const AUTOMATABLE_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(["retry_provisioning", "replay_webhook"]);

/** Case types that always come to a person, whatever the evidence. */
export const ALWAYS_REVIEW_CASE_TYPES: readonly CaseType[] = ["duplicate_payment", "inventory_conflict", "late_authorization"];

export type EligibilityCriterionId =
  | "enough_examples"
  | "verified_success"
  | "no_wrong_actions"
  | "no_unresolved_failures"
  | "exact_match_required"
  | "compatible_scope"
  | "within_global_controls";

export type EligibilityCriterion = { id: EligibilityCriterionId; label: string; met: boolean; detail: string };

export type AutomationSuggestion = {
  action: ActionType;
  contracts: Array<{ id: string; name: string }>;
  maxValue: number;
  minimumConfidence: number;
  alwaysReviewCaseTypes: CaseType[];
  requiredPermissions: string[];
};

export type AutonomyEligibility = {
  eligible: boolean;
  headline: string;
  summary: string;
  criteria: EligibilityCriterion[];
  /** Present only when every criterion is met. */
  suggestion?: AutomationSuggestion;
};

export type EligibilityContext = {
  contracts: readonly OutcomeContract[];
  /** Scopes currently granted to Payment Integrity. */
  grantedScopes: readonly string[];
};

const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

/**
 * Whether Payment Integrity may suggest limited automation for an action.
 * Pure: the same evidence, controls and context always give the same answer.
 * Merchant approval rates are not an input; only verified outcomes count.
 */
export function evaluateAutonomyEligibility(evidence: AutonomyEvidence, controls: GlobalControls, context: EligibilityContext): AutonomyEligibility {
  const label = ACTIONS[evidence.action].label;
  const t = AUTONOMY_THRESHOLDS;
  const verifiedContracts = new Set(evidence.contracts.filter((c) => c.verified > 0).map((c) => c.id));
  const contracts = context.contracts.filter((c) => c.status === "active" && c.safeRecoveryAction === evidence.action && verifiedContracts.has(c.id));
  const automatable = AUTOMATABLE_ACTIONS.has(evidence.action);
  const maxValue = Math.min(controls.maxAutomaticValue, ...contracts.map((c) => c.maxAutomaticValue));
  const minimumConfidence = Math.max(controls.minimumConfidence, ...contracts.map((c) => c.minimumConfidence));
  const permissions = [...new Set(contracts.map((c) => requiredScope(evidence.action, c)).filter((s): s is string => s !== undefined))];
  const missingPermissions = permissions.filter((p) => !context.grantedScopes.includes(p));

  const criteria: EligibilityCriterion[] = [
    {
      id: "enough_examples",
      label: `At least ${t.minExecuted} executed examples`,
      met: evidence.executed >= t.minExecuted,
      detail: `${evidence.executed} executed in the evaluation window.`,
    },
    {
      id: "verified_success",
      label: `At least ${pct(t.minVerificationRate)} verified outcomes`,
      met: evidence.executed > 0 && evidence.verificationRate >= t.minVerificationRate,
      detail: `${evidence.verifiedSuccessful} of ${evidence.executed} produced a verified outcome (${pct(evidence.verificationRate)}).`,
    },
    {
      id: "no_wrong_actions",
      label: "No known wrong actions",
      met: evidence.wrongActions <= t.maxWrongActions,
      detail: evidence.wrongActions === 0 ? "None recorded in the evaluation window." : `${evidence.wrongActions} executed ${evidence.wrongActions === 1 ? "action was" : "actions were"} later reversed or marked wrong.`,
    },
    {
      id: "no_unresolved_failures",
      label: "No unresolved execution failures",
      met: evidence.unresolvedFailureCaseIds.length === 0,
      detail: evidence.unresolvedFailureCaseIds.length === 0 ? "No failed execution is still open." : `${evidence.unresolvedFailureCaseIds.length} failed ${evidence.unresolvedFailureCaseIds.length === 1 ? "execution is" : "executions are"} still open.`,
    },
    {
      id: "exact_match_required",
      label: "Exact payment-to-order matching stays required",
      met: controls.neverActOnLowConfidenceMatch,
      detail: controls.neverActOnLowConfidenceMatch ? "Actions never run on a low-confidence record match." : "Switched off in global controls; it must be on.",
    },
    {
      id: "compatible_scope",
      label: "Compatible action and Outcome Contracts",
      met: automatable && contracts.length > 0 && missingPermissions.length === 0,
      detail: !automatable
        ? `${label} is review-only.`
        : contracts.length === 0
          ? "No active Outcome Contract has verified examples for this action."
          : missingPermissions.length > 0
            ? `Scope ${missingPermissions.join(", ")} is not granted.`
            : `Covers ${contracts.map((c) => c.name).join(", ")}.`,
    },
    {
      id: "within_global_controls",
      label: "Limits within global controls",
      met: contracts.length > 0 && maxValue <= controls.maxAutomaticValue && minimumConfidence >= controls.minimumConfidence,
      detail:
        contracts.length > 0
          ? `Up to ${formatINR(maxValue)} at ${Math.round(minimumConfidence * 100)}% confidence or higher (global: ${formatINR(controls.maxAutomaticValue)}, ${Math.round(controls.minimumConfidence * 100)}%).`
          : "No compatible contract to set limits for.",
    },
  ];

  const failed = criteria.filter((c) => !c.met);
  if (failed.length > 0) {
    return { eligible: false, headline: `Keep ${label.toLowerCase()} review-first`, summary: ineligibleSummary(evidence, failed[0]!), criteria };
  }
  return {
    eligible: true,
    headline: `${label} can run automatically within limits`,
    summary: `This action produced a verified outcome in ${evidence.verifiedSuccessful} of the last ${evidence.executed} executed cases, with no known incorrect outcomes. Payment Integrity can recommend limited automation below ${formatINR(maxValue)} when investigation confidence is at least ${Math.round(minimumConfidence * 100)}%.`,
    criteria,
    suggestion: {
      action: evidence.action,
      contracts: contracts.map((c) => ({ id: c.id, name: c.name })),
      maxValue,
      minimumConfidence,
      alwaysReviewCaseTypes: [...new Set([...ALWAYS_REVIEW_CASE_TYPES, ...contracts.flatMap((c) => c.alwaysReviewCaseTypes)])],
      requiredPermissions: permissions,
    },
  };
}

function ineligibleSummary(evidence: AutonomyEvidence, first: EligibilityCriterion): string {
  const agreement = `${evidence.approvedWithoutEdits} of the last ${evidence.recommendationsReviewed} recommendations were approved without edits`;
  switch (first.id) {
    case "enough_examples":
      return `${agreement}, but only ${evidence.executed} executed actions can be checked against verified outcomes. At least ${AUTONOMY_THRESHOLDS.minExecuted} are required before Payment Integrity recommends automation.`;
    case "verified_success":
      return `${agreement}, but only ${evidence.verifiedSuccessful} of ${evidence.executed} executed actions produced a verified outcome. At least ${pct(AUTONOMY_THRESHOLDS.minVerificationRate)} is required before Payment Integrity recommends automation.`;
    case "no_wrong_actions":
      return `${agreement}, but ${evidence.wrongActions === 1 ? "one executed action was" : `${evidence.wrongActions} executed actions were`} later reversed. More verified outcomes without an incorrect action are required before Payment Integrity recommends automation.`;
    case "no_unresolved_failures":
      return `${agreement}, but ${first.detail.toLowerCase()} Resolve them before Payment Integrity recommends automation.`;
    case "exact_match_required":
      return "Exact payment-to-order matching is switched off in global controls. Payment Integrity only recommends automation while it stays on.";
    case "compatible_scope":
      return `${first.detail} Payment Integrity does not recommend automation for it.`;
    case "within_global_controls":
      return `${first.detail} Payment Integrity does not recommend automation without limits inside global controls.`;
  }
}
