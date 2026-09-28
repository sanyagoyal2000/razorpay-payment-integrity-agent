import { z } from "zod/v4";
import type { ActionMode, GlobalControls, IntegrationId, OutcomeContract, PolicyAction } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { formatIstShort } from "@/domain/time";
import { evaluateAutonomyEligibility, type AutonomyEligibility } from "@/services/autonomyEligibility";
import { earnedAutonomy, type AutonomyEvidence } from "@/services/metrics/autonomy";
import { POLICY_ACTION_LABELS } from "@/services/policy/actions";
import { modeLabel } from "@/services/policy/evaluatePolicy";

export class ConfigurationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

function audit(repos: Repositories, entry: { occurredAt: string; actor: string; action: string; targetType: "policy" | "contract" | "integration"; targetId: string; result: string }) {
  repos.audit.append({ id: repos.nextId("aud"), approvalSource: "merchant", ...entry });
}

// ---------------------------------------------------------------------------
// Action policies and global controls
// ---------------------------------------------------------------------------

/** Changes one action's mode. Only a person can call this; the agent never changes autonomy. */
export function setActionMode(repos: Repositories, action: PolicyAction, mode: ActionMode, actor: string, asOf: string) {
  const current = repos.config.actionPolicies().find((p) => p.action === action);
  if (!current) throw new ConfigurationError(`Unknown action ${action}`);
  if (current.mode === mode) return current;
  const next = { ...current, mode, updatedAt: asOf, updatedBy: actor };
  repos.config.saveActionPolicy(next);
  audit(repos, {
    occurredAt: asOf,
    actor,
    action: "Changed action policy",
    targetType: "policy",
    targetId: action,
    result: `${POLICY_ACTION_LABELS[action]}: ${modeLabel(current.mode)} → ${modeLabel(mode)}`,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Earned autonomy
// ---------------------------------------------------------------------------

/** Actions shown on the earned-autonomy panel; both are Automations entries and action types. */
export type AutonomyAction = "retry_provisioning" | "replay_webhook";

export type AutonomyAssessment = { evidence: AutonomyEvidence; eligibility: AutonomyEligibility };

/** Verified-outcome evidence plus the deterministic eligibility decision. */
export function assessAutonomy(repos: Repositories, action: AutonomyAction = "retry_provisioning"): AutonomyAssessment {
  const evidence = earnedAutonomy(repos, action);
  const grantedScopes = repos.config
    .integrations()
    .filter((i) => i.status === "connected")
    .flatMap((i) => [...i.scopes.read, ...i.scopes.write]);
  return {
    evidence,
    eligibility: evaluateAutonomyEligibility(evidence, repos.config.globalControls(), { contracts: repos.config.contracts(), grantedScopes }),
  };
}

/**
 * Switches on limited automation after explicit merchant confirmation.
 * Eligibility is re-checked at confirmation time; nothing changes unless
 * every criterion is still met.
 */
export function switchOnEarnedAutomation(repos: Repositories, action: AutonomyAction, actor: string, asOf: string) {
  const { evidence, eligibility } = assessAutonomy(repos, action);
  if (!eligibility.eligible || !eligibility.suggestion) {
    const unmet = eligibility.criteria.filter((c) => !c.met).map((c) => c.label.toLowerCase());
    throw new ConfigurationError(`Automation cannot be switched on: ${unmet.join("; ")}.`);
  }
  const policy = setActionMode(repos, action, "automatic_below_threshold", actor, asOf);
  const { suggestion } = eligibility;
  const window = evidence.evaluationWindow ? ` (${formatIstShort(evidence.evaluationWindow.from, asOf)} to ${formatIstShort(evidence.evaluationWindow.to, asOf)})` : "";
  audit(repos, {
    occurredAt: asOf,
    actor,
    action: "Switched on earned automation",
    targetType: "policy",
    targetId: action,
    result: `${POLICY_ACTION_LABELS[action]} automatic below ${formatINR(suggestion.maxValue)} at ${Math.round(suggestion.minimumConfidence * 100)}% confidence or higher for ${suggestion.contracts.map((c) => c.name).join(", ")}. Evidence: ${evidence.verifiedSuccessful} of ${evidence.executed} executed actions verified, ${evidence.wrongActions} wrong${window}.`,
  });
  return policy;
}

/** Records that the merchant chose to keep reviewing each recommendation. */
export function keepReviewFirst(repos: Repositories, action: AutonomyAction, actor: string, asOf: string) {
  const { evidence } = assessAutonomy(repos, action);
  audit(repos, {
    occurredAt: asOf,
    actor,
    action: "Kept review-first",
    targetType: "policy",
    targetId: action,
    result: `${POLICY_ACTION_LABELS[action]} stays review-first. Evidence at the time: ${evidence.verifiedSuccessful} of ${evidence.executed} executed actions verified, ${evidence.wrongActions} wrong.`,
  });
}

export const globalControlsSchema = z.object({
  maxAutomaticValue: z.number().int("Use whole rupees").min(0, "Cannot be negative").max(100_000, "At most ₹1,00,000"),
  dailyRefundLimit: z.number().int("Use whole rupees").min(0, "Cannot be negative").max(10_00_000, "At most ₹10,00,000"),
  minimumConfidence: z.number().min(0.5, "At least 50%").max(1, "At most 100%"),
  neverActAfterInventoryChange: z.boolean(),
  neverActOnLowConfidenceMatch: z.boolean(),
  requireApprovalForCustomerCommunication: z.boolean(),
});

const CONTROL_LABELS: Record<keyof z.infer<typeof globalControlsSchema>, (v: never) => string> = {
  maxAutomaticValue: (v: number) => `Maximum automatic value ${formatINR(v)}`,
  dailyRefundLimit: (v: number) => `Daily refund limit ${formatINR(v)}`,
  minimumConfidence: (v: number) => `Minimum confidence ${Math.round(v * 100)}%`,
  neverActAfterInventoryChange: (v: boolean) => `Never act after inventory changes: ${v ? "on" : "off"}`,
  neverActOnLowConfidenceMatch: (v: boolean) => `Never act on low-confidence record matches: ${v ? "on" : "off"}`,
  requireApprovalForCustomerCommunication: (v: boolean) => `Require approval for customer communication: ${v ? "on" : "off"}`,
};

export function saveGlobalControls(repos: Repositories, values: z.infer<typeof globalControlsSchema>, actor: string, asOf: string): GlobalControls {
  const parsed = globalControlsSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    throw new ConfigurationError("Some values are not valid.", fieldErrors);
  }
  const current = repos.config.globalControls();
  const changed = (Object.keys(CONTROL_LABELS) as Array<keyof typeof CONTROL_LABELS>).filter((k) => current[k] !== parsed.data[k]);
  if (changed.length === 0) return current;
  const next: GlobalControls = { ...current, ...parsed.data, updatedAt: asOf };
  repos.config.saveGlobalControls(next);
  audit(repos, {
    occurredAt: asOf,
    actor,
    action: "Changed global controls",
    targetType: "policy",
    targetId: "global_controls",
    result: changed.map((k) => CONTROL_LABELS[k](parsed.data[k] as never)).join("; "),
  });
  return next;
}

/**
 * The kill switch. Stops new executions immediately (policy blocks them and
 * in-flight approvals stop at their re-check); monitoring and investigation
 * continue, and queued actions stay visible.
 */
export function setAutomationPaused(repos: Repositories, paused: boolean, actor: string, asOf: string): GlobalControls {
  const current = repos.config.globalControls();
  if (current.automationPaused === paused) return current;
  const next = { ...current, automationPaused: paused, updatedAt: asOf };
  repos.config.saveGlobalControls(next);
  const queued = repos.executions.list().filter((e) => !["resolved", "stopped", "failed"].includes(e.status)).length;
  audit(repos, {
    occurredAt: asOf,
    actor,
    action: paused ? "Paused all automated actions" : "Resumed automated actions",
    targetType: "policy",
    targetId: "kill_switch",
    result: paused
      ? `New executions blocked; monitoring and investigation continue.${queued > 0 ? ` ${queued} queued actions stay visible and will stop at their policy re-check.` : ""}`
      : "New executions allowed again, subject to policy.",
  });
  return next;
}

// ---------------------------------------------------------------------------
// Outcome Contracts
// ---------------------------------------------------------------------------

export const contractFormSchema = z.object({
  name: z.string().trim().min(3, "Give the contract a name of at least 3 characters").max(60, "At most 60 characters"),
  paymentType: z.string().trim().min(3, "Describe which payments this covers"),
  productScope: z.array(z.string()).min(1, "Choose at least one product"),
  expectedOutcome: z.enum(["course_access_granted", "booking_confirmed", "membership_activated", "wallet_credited", "plan_upgraded"]),
  matchingKey: z.enum(["merchant_order_id", "razorpay_order_id", "customer_id"]),
  deadlineSeconds: z.number().int().min(30, "At least 30 seconds").max(86_400, "At most 24 hours"),
  fulfilmentService: z.string().min(1, "Choose the service that fulfils the outcome"),
  safeRecoveryAction: z.enum(["retry_provisioning", "replay_webhook", "escalate"]),
  verificationMethod: z.string().trim().min(5, "Say how the outcome is confirmed"),
  maxAutomaticValue: z.number().int("Use whole rupees").min(0, "Cannot be negative"),
  minimumConfidence: z.number().min(0.5, "At least 50%").max(1, "At most 100%"),
  alwaysReviewCaseTypes: z.array(z.enum(["missing_outcome", "duplicate_payment", "late_authorization", "inventory_conflict", "delayed_processing"])),
  requiresInventoryCheck: z.boolean(),
  customerNotificationTemplate: z.string().trim().min(10, "Write the message customers receive"),
  status: z.enum(["active", "paused", "draft"]),
});
export type ContractForm = z.infer<typeof contractFormSchema>;

export function contractToForm(c: OutcomeContract): ContractForm {
  return {
    name: c.name,
    paymentType: c.paymentType,
    productScope: c.productScope,
    expectedOutcome: c.expectedOutcome as ContractForm["expectedOutcome"],
    matchingKey: c.matchingKey as ContractForm["matchingKey"],
    deadlineSeconds: c.deadlineSeconds,
    fulfilmentService: c.fulfilmentService,
    safeRecoveryAction: c.safeRecoveryAction as ContractForm["safeRecoveryAction"],
    verificationMethod: c.verificationMethod,
    maxAutomaticValue: c.maxAutomaticValue,
    minimumConfidence: c.minimumConfidence,
    alwaysReviewCaseTypes: c.alwaysReviewCaseTypes,
    requiresInventoryCheck: c.requiresInventoryCheck,
    customerNotificationTemplate: c.customerNotificationTemplate,
    status: c.status,
  };
}

export const EMPTY_CONTRACT_FORM: ContractForm = {
  name: "",
  paymentType: "",
  productScope: [],
  expectedOutcome: "course_access_granted",
  matchingKey: "merchant_order_id",
  deadlineSeconds: 120,
  fulfilmentService: "enrolment-service",
  safeRecoveryAction: "retry_provisioning",
  verificationMethod: "",
  maxAutomaticValue: 5000,
  minimumConfidence: 0.95,
  alwaysReviewCaseTypes: ["duplicate_payment"],
  requiresInventoryCheck: false,
  customerNotificationTemplate: "",
  status: "draft",
};

/** Field-level validation, including rules that span fields and the global limits. */
export function validateContract(repos: Repositories, values: ContractForm, contractId?: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const parsed = contractFormSchema.safeParse(values);
  if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  const globalMax = repos.config.globalControls().maxAutomaticValue;
  if (values.maxAutomaticValue > globalMax) errors["maxAutomaticValue"] ??= `Cannot exceed the global maximum of ${formatINR(globalMax)}`;
  const clash = repos.config.contracts().find((c) => c.id !== contractId && c.name.trim().toLowerCase() === values.name.trim().toLowerCase());
  if (clash) errors["name"] ??= "Another contract already has this name";
  const taken = repos.config
    .contracts()
    .filter((c) => c.id !== contractId && c.status !== "draft")
    .flatMap((c) => c.productScope.map((p) => ({ product: p, contract: c.name })));
  const overlap = values.status !== "draft" ? taken.find((t) => values.productScope.includes(t.product)) : undefined;
  if (overlap) errors["productScope"] ??= `A product is already covered by “${overlap.contract}”`;
  if (values.expectedOutcome === "booking_confirmed" && !values.requiresInventoryCheck) errors["requiresInventoryCheck"] ??= "Bookings need an inventory check";
  return errors;
}

export function saveContract(repos: Repositories, values: ContractForm, actor: string, asOf: string, contractId?: string): OutcomeContract {
  const errors = validateContract(repos, values, contractId);
  if (Object.keys(errors).length > 0) throw new ConfigurationError("Fix the highlighted fields.", errors);
  const existing = contractId ? repos.config.contract(contractId) : undefined;
  const id = existing?.id ?? uniqueContractId(repos, values.name);
  const next: OutcomeContract = { id, ...values, updatedAt: asOf };
  repos.config.saveContract(next);
  const changed = existing
    ? (Object.keys(values) as Array<keyof ContractForm>).filter((k) => JSON.stringify(existing[k]) !== JSON.stringify(values[k]))
    : [];
  audit(repos, {
    occurredAt: asOf,
    actor,
    action: existing ? "Updated contract" : "Created contract",
    targetType: "contract",
    targetId: id,
    result: existing ? `${values.name}: changed ${changed.join(", ") || "nothing"}` : `${values.name} saved as ${values.status}`,
  });
  return next;
}

export function setContractStatus(repos: Repositories, contractId: string, status: OutcomeContract["status"], actor: string, asOf: string) {
  const c = repos.config.contract(contractId);
  if (!c) throw new ConfigurationError("Contract not found");
  if (c.status === status) return c;
  const next = { ...c, status, updatedAt: asOf };
  repos.config.saveContract(next);
  audit(repos, {
    occurredAt: asOf,
    actor,
    action: status === "paused" ? "Paused contract" : status === "active" ? "Resumed contract" : "Moved contract to draft",
    targetType: "contract",
    targetId: contractId,
    result: `${c.name}: ${c.status} → ${status}`,
  });
  return next;
}

function uniqueContractId(repos: Repositories, name: string): string {
  const base = `ctr_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "contract"}`;
  let id = base;
  for (let n = 2; repos.config.contract(id); n += 1) id = `${base}_${n}`;
  return id;
}

/** Plain-language statement of what the contract will do. */
export function contractLogic(values: ContractForm, productNames: (id: string) => string, globalMax: number): string[] {
  const deadline = values.deadlineSeconds >= 3600 ? `${values.deadlineSeconds / 3600} h` : values.deadlineSeconds >= 60 ? `${values.deadlineSeconds / 60} min` : `${values.deadlineSeconds} s`;
  const products = values.productScope.length === 0 ? "the selected products" : values.productScope.map(productNames).join(", ");
  const recovery = { retry_provisioning: "retry provisioning", replay_webhook: "replay the order.paid webhook", escalate: "escalate to you" }[values.safeRecoveryAction];
  const limit = Math.min(values.maxAutomaticValue, globalMax);
  const lines = [
    `When a payment for ${products} is captured, expect ${values.expectedOutcome} from ${values.fulfilmentService}, matched on ${values.matchingKey}, within ${deadline}.`,
    `If it does not arrive, open a case and propose to ${recovery}.`,
    `The action may run without approval only if its Automations mode allows it, the amount is at most ${formatINR(limit)}, and confidence is at least ${Math.round(values.minimumConfidence * 100)}%.`,
  ];
  if (values.alwaysReviewCaseTypes.length > 0) lines.push(`Always ask you first for: ${values.alwaysReviewCaseTypes.map((t) => t.replace(/_/g, " ")).join(", ")}.`);
  if (values.requiresInventoryCheck) lines.push("Never fulfil if the purchased inventory changed after payment.");
  lines.push(`Resolve a case only after confirming: ${values.verificationMethod || "the expected outcome event"}.`);
  lines.push(values.status === "active" ? "Monitoring starts as soon as you save." : values.status === "paused" ? "Paused: payments are not checked against this contract." : "Draft: nothing is monitored until you activate it.");
  return lines;
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export function setIntegrationConnected(repos: Repositories, id: IntegrationId, connected: boolean, actor: string, asOf: string) {
  const integration = repos.config.integration(id);
  if (!integration) throw new ConfigurationError("Integration not found");
  const status = connected ? "connected" : "revoked";
  if (integration.status === status) return integration;
  const next = { ...integration, status, ...(connected ? { connectedAt: asOf } : {}) } as typeof integration;
  repos.config.saveIntegration(next);
  audit(repos, {
    occurredAt: asOf,
    actor,
    action: connected ? "Reconnected integration" : "Revoked integration",
    targetType: "integration",
    targetId: id,
    result: connected
      ? `${integration.name} reconnected with scopes ${[...integration.scopes.read, ...integration.scopes.write].join(", ")}`
      : `${integration.name} revoked; actions needing ${integration.scopes.write.join(", ") || "its data"} are now blocked`,
  });
  return next;
}
