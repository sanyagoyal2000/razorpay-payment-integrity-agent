import { z } from "zod/v4";
import type { CaseInvestigationInput, IncidentInvestigationInput } from "@/services/investigation";

/**
 * The agent boundary. Every task sends only the data it needs (no customer
 * names, emails or phone numbers) and returns raw output that the caller
 * validates against these schemas before anything reaches the product.
 */

export const AGENT_TASKS = ["investigate-case", "investigate-incident", "draft-message", "draft-contract", "explain-autonomy", "ask-incident"] as const;
export type AgentTask = (typeof AGENT_TASKS)[number];

// ---------------------------------------------------------------------------
// Customer message drafts
// ---------------------------------------------------------------------------

export const messageDraftInputSchema = z.object({
  audience: z.enum(["one_customer", "all_affected_customers"]),
  situation: z.enum(["access_being_restored", "under_review", "seat_changed", "payment_held", "second_charge_review"]),
  productName: z.string(),
  amount: z.number().optional(),
  facts: z.array(z.string()).describe("Customer-safe facts the message may state"),
});
export type MessageDraftInput = z.infer<typeof messageDraftInputSchema>;

export const messageDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1).describe("Plain text, at most 80 words, addressed to {first_name}"),
});
export type MessageDraft = z.infer<typeof messageDraftSchema>;

// ---------------------------------------------------------------------------
// Outcome Contract drafts
// ---------------------------------------------------------------------------

export const OUTCOME_TYPES = ["learning_access_granted", "booking_confirmed", "membership_activated", "wallet_credited", "plan_upgraded"] as const;
export const RECOVERY_ACTIONS = ["retry_provisioning", "replay_webhook", "escalate"] as const;
export const REVIEW_CASE_TYPES = ["missing_outcome", "duplicate_payment", "late_authorization", "inventory_conflict", "delayed_processing"] as const;

export const contractDraftInputSchema = z.object({
  description: z.string().min(10).max(1500),
  products: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string(), price: z.number() })),
  fulfilmentServices: z.array(z.string()),
  globalMaxAutomaticValue: z.number(),
});
export type ContractDraftInput = z.infer<typeof contractDraftInputSchema>;

export const contractDraftSchema = z.object({
  name: z.string().min(1),
  paymentType: z.string().min(1),
  productScope: z.array(z.string()).describe("Product IDs from the supplied catalogue"),
  expectedOutcome: z.enum(OUTCOME_TYPES),
  matchingKey: z.enum(["merchant_order_id", "razorpay_order_id", "customer_id"]),
  deadlineSeconds: z.number().int().min(30).max(86_400),
  fulfilmentService: z.string(),
  safeRecoveryAction: z.enum(RECOVERY_ACTIONS),
  verificationMethod: z.string().min(1),
  maxAutomaticValue: z.number().int().min(0),
  minimumConfidence: z.number().min(0.5).max(1),
  alwaysReviewCaseTypes: z.array(z.enum(REVIEW_CASE_TYPES)),
  requiresInventoryCheck: z.boolean(),
  customerNotificationTemplate: z.string().min(1).describe("May use {product}"),
  assumptions: z.array(z.string()).describe("Choices made that the description did not state"),
});
export type ContractDraft = z.infer<typeof contractDraftSchema>;

// ---------------------------------------------------------------------------
// Earned-autonomy explanation
// ---------------------------------------------------------------------------

export const autonomyInputSchema = z.object({
  action: z.string(),
  currentMode: z.string(),
  considered: z.number(),
  approvedWithoutEdits: z.number(),
  edited: z.number(),
  rejected: z.number(),
  executed: z.number(),
  verifiedSuccessful: z.number(),
  failedExecutions: z.number(),
  wrongActions: z.number(),
  eligible: z.boolean().describe("Decided by deterministic rules; the explanation must not contradict it"),
  unmetCriteria: z.array(z.string()),
  medianAmount: z.number(),
  maxAmount: z.number(),
  maxAutomaticValue: z.number(),
  minimumConfidence: z.number(),
  editReasons: z.array(z.string()),
  rejectionReasons: z.array(z.string()),
});
export type AutonomyInput = z.infer<typeof autonomyInputSchema>;

export const autonomyExplanationSchema = z.object({
  headline: z.string().min(1).describe("One sentence stating the evidence"),
  explanation: z.string().min(1),
  risks: z.array(z.string()).min(1),
  suggestedMode: z.enum(["suggest_only", "automatic_below_threshold", "always_require_approval"]),
  suggestedMaxValue: z.number().int().min(0),
  suggestedMinimumConfidence: z.number().min(0.5).max(1),
});
export type AutonomyExplanation = z.infer<typeof autonomyExplanationSchema>;

// ---------------------------------------------------------------------------
// Ask RAY: questions about one incident
// ---------------------------------------------------------------------------

const askEvidenceSchema = z.object({
  id: z.string(),
  source: z.string(),
  type: z.string(),
  occurredAt: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const askIncidentInputSchema = z.object({
  incidentId: z.string(),
  question: z.string().min(1).max(500),
  /** Deterministic facts computed by the product (recovery groups, policy preview, service health). */
  facts: z.array(z.object({ id: z.string(), statement: z.string() })),
  caseIds: z.array(z.string()),
  /** Only evidence from sources the agent is permitted to read. */
  evidence: z.array(askEvidenceSchema).max(1500),
});
export type AskIncidentInput = z.infer<typeof askIncidentInputSchema>;

export const ASK_NEXT_STEPS = ["review_recovery", "view_investigation", "view_evidence", "none"] as const;

export const askAnswerSchema = z.object({
  inScope: z.boolean().describe("False when the question is not about this incident or cannot be answered from the supplied evidence and facts"),
  answer: z.string().min(1).describe("At most 120 words, plain operational English, grounded only in the supplied evidence and facts"),
  citedIds: z.array(z.string()).describe("Evidence ids, case ids or fact ids that support the answer"),
  nextStep: z.enum(ASK_NEXT_STEPS).describe("Where the merchant can act on the answer; this never performs an action"),
});
export type AskAnswer = z.infer<typeof askAnswerSchema>;

/** One gateway for every agent task. Implementations return unvalidated output. */
export type AgentGateway = {
  investigateCase(input: CaseInvestigationInput): Promise<unknown>;
  investigateIncident(input: IncidentInvestigationInput): Promise<unknown>;
  draftMessage(input: MessageDraftInput): Promise<unknown>;
  draftContract(input: ContractDraftInput): Promise<unknown>;
  explainAutonomy(input: AutonomyInput): Promise<unknown>;
  askIncident(input: AskIncidentInput): Promise<unknown>;
  /** What serves these calls, for the audit log, e.g. "claude-opus-5 via Claude CLI". */
  describe?(): Promise<string>;
};
