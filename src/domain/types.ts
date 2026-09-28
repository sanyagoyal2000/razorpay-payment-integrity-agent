/**
 * Domain model for Payment Integrity.
 *
 * Types marked "spec" follow docs/PRODUCT_SPEC.md field-for-field; additional
 * fields are documented where they are introduced. All timestamps are ISO-8601
 * strings in UTC; presentation converts them to IST.
 */

export type ISODateTime = string;
export type Currency = "INR";

// ---------------------------------------------------------------------------
// Merchant, people, catalogue
// ---------------------------------------------------------------------------

export type Merchant = {
  id: string;
  name: string;
  industry: string;
  environment: "live" | "test";
  timezone: "Asia/Kolkata";
  currency: Currency;
};

export type OperatorUser = {
  id: string;
  name: string;
  role: string;
};

/** spec */
export type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

export type ProductKind =
  | "course"
  | "bundle"
  | "event_seat"
  | "membership"
  | "credits"
  | "plan_upgrade";

export type Product = {
  id: string;
  name: string;
  kind: ProductKind;
  price: number;
  contractId: string;
};

/** A merchant-side order, as read from the LearnLoop Orders API. */
export type MerchantOrder = {
  id: string; // merchant_order_id
  customerId: string;
  productId: string;
  amount: number;
  createdAt: ISODateTime;
  status: "pending_payment" | "paid" | "fulfilled" | "fulfilment_failed" | "expired";
};

// ---------------------------------------------------------------------------
// Payment side (Razorpay)
// ---------------------------------------------------------------------------

export type PaymentMethod = "upi" | "card" | "netbanking";
export type PaymentStatus = "created" | "authorized" | "captured" | "refunded" | "failed";

/** spec */
export type Payment = {
  id: string;
  orderId: string;
  merchantOrderId: string;
  customerId: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  status: PaymentStatus;
  createdAt: ISODateTime;
  capturedAt?: ISODateTime;
  captureDeadline?: ISODateTime;
};

export type PaymentEventType =
  | "order.created"
  | "payment.authorized"
  | "payment.captured"
  | "order.paid"
  | "payment.refunded";

/** spec */
export type PaymentEvent = {
  id: string;
  paymentId: string;
  source: "razorpay";
  type: PaymentEventType;
  occurredAt: ISODateTime;
  metadata?: Record<string, unknown>;
};

/** spec */
export type WebhookDelivery = {
  id: string;
  eventId: string;
  endpoint: string;
  attempt: number;
  responseCode?: number;
  latencyMs?: number;
  status: "delivered" | "failed" | "pending";
  occurredAt: ISODateTime;
};

// ---------------------------------------------------------------------------
// Merchant outcome side (LearnLoop)
// ---------------------------------------------------------------------------

/**
 * spec, extended: the spec lists course outcomes only. The other Outcome
 * Contracts (event booking, membership, wallet credits, plan upgrade) need their
 * own completion events.
 */
export type OutcomeEventType =
  | "enrolment.requested"
  | "enrolment.failed"
  | "course_access_granted"
  | "course_access_revoked"
  | "inventory_changed"
  | "booking_confirmed"
  | "booking.failed"
  | "membership_activated"
  | "wallet_credited"
  | "plan_upgraded";

/** spec */
export type MerchantOutcomeEvent = {
  id: string;
  merchantOrderId: string;
  source: "learnloop";
  type: OutcomeEventType;
  status: "pending" | "completed" | "failed";
  responseCode?: number;
  occurredAt: ISODateTime;
  metadata?: Record<string, unknown>;
};

/** Deploy events and service error logs from LearnLoop Observability. */
export type ObservabilityEventType =
  | "deploy.completed"
  | "service.errors_detected"
  | "service.recovered";

export type ObservabilityEvent = {
  id: string;
  source: "learnloop_observability";
  type: ObservabilityEventType;
  service: string;
  occurredAt: ISODateTime;
  metadata?: Record<string, unknown>;
};

/**
 * Events emitted by Payment Integrity itself (deadline checks, case lifecycle).
 * They appear as "Agent" entries on the case timeline.
 */
export type IntegrityEventType =
  | "outcome.deadline_missed"
  | "case.opened"
  | "case.observing"
  | "case.clustered"
  | "incident.created"
  | "outcome.verified"
  | "outcome.arrived_late";

export type IntegrityEvent = {
  id: string;
  source: "payment_integrity";
  type: IntegrityEventType;
  caseId?: string;
  incidentId?: string;
  occurredAt: ISODateTime;
  metadata?: Record<string, unknown>;
};

/**
 * An Outcome Receipt is Payment Integrity's record that a captured payment did
 * (confirmed) or did not (missing) produce its contracted outcome in time.
 */
export type OutcomeReceipt = {
  id: string;
  paymentId: string;
  merchantOrderId: string;
  contractId: string;
  status: "confirmed" | "missing";
  expectedBy: ISODateTime;
  outcomeEventId?: string;
  confirmedAt?: ISODateTime;
};

// ---------------------------------------------------------------------------
// Outcome Contracts
// ---------------------------------------------------------------------------

export type CaseType =
  | "missing_outcome"
  | "duplicate_payment"
  | "late_authorization"
  | "inventory_conflict"
  | "delayed_processing";

/** spec, extended with the editor fields listed under "Contract editor". */
export type OutcomeContract = {
  id: string;
  name: string;
  paymentType: string;
  expectedOutcome: OutcomeEventType;
  matchingKey: string;
  deadlineSeconds: number;
  safeRecoveryAction: ActionType;
  maxAutomaticValue: number;
  minimumConfidence: number;
  status: "active" | "paused" | "draft";
  productScope: string[];
  fulfilmentService: string;
  verificationMethod: string;
  alwaysReviewCaseTypes: CaseType[];
  requiresInventoryCheck: boolean;
  customerNotificationTemplate: string;
  updatedAt: ISODateTime;
};

// ---------------------------------------------------------------------------
// Actions, policies, integrations
// ---------------------------------------------------------------------------

/** Every action a recommendation or merchant decision can name. */
export type ActionType =
  | "wait"
  | "replay_webhook"
  | "retry_provisioning"
  | "capture"
  | "prepare_refund"
  | "refund_duplicate"
  | "review_duplicate"
  | "review_alternate_inventory"
  | "notify_customer"
  | "escalate";

/** Actions governed by an entry on the Automations page. */
export type PolicyAction =
  | "retry_provisioning"
  | "replay_webhook"
  | "capture_payment"
  | "prepare_refund"
  | "issue_refund"
  | "notify_customer"
  | "escalate";

export type ActionMode =
  | "suggest_only"
  | "automatic_below_threshold"
  | "always_require_approval"
  | "disabled";

export type ActionPolicy = {
  action: PolicyAction;
  mode: ActionMode;
  updatedAt: ISODateTime;
  updatedBy: string;
};

export type GlobalControls = {
  maxAutomaticValue: number;
  dailyRefundLimit: number;
  minimumConfidence: number;
  neverActAfterInventoryChange: boolean;
  neverActOnLowConfidenceMatch: boolean;
  requireApprovalForCustomerCommunication: boolean;
  automationPaused: boolean;
  updatedAt: ISODateTime;
};

export type IntegrationId =
  | "razorpay_payments"
  | "learnloop_orders"
  | "learnloop_enrolment"
  | "customer_comms"
  | "incident_management"
  | "learnloop_observability";

export type Integration = {
  id: IntegrationId;
  name: string;
  purpose: string;
  status: "connected" | "revoked";
  access: "read_only" | "scoped_write";
  scopes: { read: string[]; write: string[]; notGranted: string[] };
  dataAccessed: string[];
  connectedAt: ISODateTime;
};

export type ConnectorLog = {
  id: string;
  integrationId: IntegrationId;
  kind: "auth_error" | "schema_error" | "permission_denied" | "timeout";
  occurredAt: ISODateTime;
  detail: string;
};

/** Daily payment-to-outcome aggregates for high-volume healthy traffic. */
export type DailyOutcomeStat = {
  date: string; // IST calendar date, YYYY-MM-DD
  contractId: string;
  paymentsCaptured: number;
  gmv: number;
  /** Outcomes confirmed within the contract deadline without a case. */
  outcomesConfirmedOnTime: number;
  medianCompletionSeconds: number;
  webhookAttempts: number;
  webhookFailures: number;
  medianEventLatencyMs: number;
  /** Cases whose payment was captured in this day and contract, counted in `paymentsCaptured`. */
  caseIds: string[];
};

/**
 * A healthy purchase that happens after the fixture horizon. It becomes visible
 * once the real clock passes `horizon + offsetSeconds`. Used to observe new
 * purchases (for example "monitor the next 50") without generating data at load.
 */
export type ScheduledPurchase = {
  id: string;
  contractId: string;
  productId: string;
  amount: number;
  offsetSeconds: number;
  completionSeconds: number;
};

// ---------------------------------------------------------------------------
// Investigation, recommendation, policy
// ---------------------------------------------------------------------------

export type InvestigationAction =
  | "wait"
  | "replay_webhook"
  | "retry_provisioning"
  | "capture"
  | "prepare_refund"
  | "refund_duplicate"
  | "escalate";

/** spec */
export type Investigation = {
  summary: string;
  likelyCause: string;
  evidenceIds: string[];
  uncertainties: string[];
  recommendedAction: InvestigationAction;
  confidence: number;
  customerImpact: string;
  consequenceOfInaction: string;
  customerMessageDraft?: string;
};

/** The action currently proposed for a case. */
export type Recommendation = {
  action: ActionType;
  summary: string;
  confidence: number;
  evidenceIds: string[];
  uncertainties: string[];
  customerImpact: string;
  consequenceOfInaction: string;
  origin: "investigation" | "rule_fallback" | "merchant_edit";
  createdAt: ISODateTime;
};

export type PolicyCheckId =
  | "kill_switch"
  | "action_enabled"
  | "permission_available"
  | "payment_captured"
  | "payment_authorized"
  | "capture_deadline"
  | "payment_not_refunded"
  | "outcome_still_missing"
  | "no_successful_duplicate"
  | "fulfilment_service_healthy"
  | "outcome_verification_available"
  | "idempotency_key_available"
  | "amount_within_limit"
  | "confidence_threshold"
  | "record_match"
  | "contract_active"
  | "case_type_review"
  | "inventory_unchanged"
  | "replacement_inventory"
  | "daily_refund_limit"
  | "customer_communication_approval"
  | "incident_review"
  | "policy_service_available";

/**
 * spec, extended with `enforcement`: a failed "hard" check blocks the action; a
 * failed "review" check forces individual human approval.
 */
export type PolicyCheck = {
  id: PolicyCheckId;
  label: string;
  status: "passed" | "failed" | "unknown";
  explanation: string;
  enforcement: "hard" | "review";
};

/**
 * spec, extended with `action` and `approvalScope`. `bulk` means the case may be
 * approved as part of a group; `individual` means it needs its own decision.
 */
export type PolicyVerdict = {
  result: "allowed" | "requires_approval" | "blocked";
  action: ActionType;
  checks: PolicyCheck[];
  approvalScope?: "bulk" | "individual";
  evaluatedAt: ISODateTime;
};

/** Current, re-fetched state that policy is evaluated against. */
export type CurrentMerchantState = {
  asOf: ISODateTime;
  payment: Pick<Payment, "id" | "status" | "amount" | "captureDeadline">;
  outcome: { state: "missing" | "pending" | "completed" | "failed"; lastEventId?: string };
  successfulDuplicatePaymentIds: string[];
  inventory:
    | { applicable: false }
    | { applicable: true; unchanged: boolean; replacementAvailable: boolean | null };
  recordMatch: { method: "exact_key" | "fuzzy"; confidence: number };
  grantedScopes: string[];
  actionModes: Record<PolicyAction, ActionMode>;
  contract: Pick<
    OutcomeContract,
    "id" | "status" | "maxAutomaticValue" | "minimumConfidence" | "alwaysReviewCaseTypes" | "fulfilmentService"
  >;
  controls: GlobalControls;
  fulfilmentServiceHealth: "healthy" | "degraded" | "down";
  outcomeVerificationAvailable: boolean;
  idempotency: { keyAvailable: boolean };
  refundsIssuedToday: number;
  /** Set when the merchant required individual review for the case's incident. */
  incidentReviewRequired: boolean;
};

// ---------------------------------------------------------------------------
// Cases, incidents, execution, audit
// ---------------------------------------------------------------------------

export type CaseStatus =
  | "observing"
  | "open"
  | "review_required"
  | "approved"
  | "executing"
  | "resolved"
  | "rejected"
  | "escalated";

/**
 * What would have happened without Payment Integrity. Only cases whose default
 * was an automatic refund or a customer contact count towards "Value delivered".
 */
export type DefaultOutcome = "auto_refund" | "customer_contact" | "none";

export type CustomerContactState = "none" | "notified" | "customer_initiated";

export type CaseResolution = {
  resolvedAt: ISODateTime;
  method: "automatic_recovery" | "approved_recovery" | "outcome_arrived" | "manual";
  action?: ActionType;
  receiptId?: string;
  actor: string;
};

export type CaseDecision = {
  decidedAt: ISODateTime;
  actor: string;
  kind: "approved" | "rejected" | "escalated" | "edited" | "wait";
  action?: ActionType;
  reason?: string;
  /** True when the merchant changed the recommended action before approving. */
  edited?: boolean;
  bulk?: boolean;
};

/** Work a merchant decision created outside the execution state machine. */
export type CaseFollowUp = {
  id: string;
  kind: "refund_draft" | "customer_message" | "alternate_inventory_request" | "escalation";
  createdAt: ISODateTime;
  actor: string;
  detail: string;
  paymentId?: string;
  amount?: number;
  status: "awaiting_finance" | "sent" | "awaiting_merchant" | "open";
};

/** spec, extended. */
export type IntegrityCase = {
  id: string;
  paymentId: string;
  outcomeContractId: string;
  incidentId?: string;
  type: CaseType;
  status: CaseStatus;
  /** For duplicates this is the original payment only. */
  amountAtRisk: number;
  detectedAt: ISODateTime;
  deadline?: ISODateTime;
  investigation?: Investigation;
  recommendation?: Recommendation;
  policyVerdict?: PolicyVerdict;
  customerId: string;
  /** Second (or later) charges for the same purchase. */
  relatedPaymentIds: string[];
  /** Sum of related duplicate charges that may need refunding. */
  refundExposure: number;
  defaultOutcome: DefaultOutcome;
  customerContact: CustomerContactState;
  observation?: { observedDelaySeconds: number; normalRangeSeconds: { p50: number; p95: number } };
  decisions: CaseDecision[];
  resolution?: CaseResolution;
  /** Set when an executed action later proved wrong (e.g. access revoked). */
  wrongAction?: { detectedAt: ISODateTime; reason: string };
  followUps?: CaseFollowUp[];
  /** Incremented on every change; used to stop execution if the case moved. */
  version: number;
  updatedAt: ISODateTime;
};

export type IncidentStatus = "investigating" | "action_required" | "contained" | "resolved";
export type Severity = "low" | "medium" | "high" | "critical";

export type ContainmentAction =
  | "notify_customers"
  | "access_pending"
  | "require_review"
  | "engineering_incident"
  | "monitor_next_purchases";

export type ContainmentDecision = {
  action: ContainmentAction;
  decidedAt: ISODateTime;
  actor: string;
  detail: string;
  /** Cases the decision applied to when it was recorded. */
  caseIds: string[];
  /** External reference, e.g. the engineering incident created in Slack. */
  reference?: string;
};

/** Stored incident. Money and customer totals are always computed from cases. */
export type IncidentRecord = {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  caseIds: string[];
  startedAt: ISODateTime;
  detectedAt: ISODateTime;
  resolvedAt?: ISODateTime;
  likelyCause?: string;
  outcomeContractId: string;
  owner: string;
  /** Service whose health determines whether recovery is safe. */
  affectedService: string;
  summary: string;
  investigation?: Investigation;
  containment?: ContainmentDecision[];
};

/** spec: the incident as displayed, with computed totals. */
export type Incident = IncidentRecord & {
  amountAtRisk: number;
  affectedCustomers: number;
};

export type IncidentUpdate = {
  id: string;
  incidentId: string;
  occurredAt: ISODateTime;
  caseCount: number;
  exposure: number;
  rootCauseConfidence?: number;
  systemHealth: "healthy" | "degraded" | "down";
  note: string;
};

export type ExecutionState =
  | "approval_recorded"
  | "policy_rechecking"
  | "idempotency_reserved"
  | "action_started"
  | "awaiting_outcome"
  | "outcome_verified"
  | "resolved";

export type ExecutionFailure =
  | "case_changed"
  | "policy_blocked"
  | "duplicate_execution"
  | "action_failed"
  | "outcome_not_verified";

export type ExecutionStep = {
  state: ExecutionState | "stopped" | "failed";
  at: ISODateTime;
  detail: string;
};

export type Execution = {
  id: string;
  caseId: string;
  action: ActionType;
  idempotencyKey: string;
  status: ExecutionState | "stopped" | "failed";
  approvalSource: "merchant" | "policy_automatic";
  approvedBy: string;
  approvedCaseVersion: number;
  /** Case status before approval, restored if execution stops before acting. */
  priorCaseStatus: CaseStatus;
  /** Verdict from the pre-execution policy re-check. */
  verdict?: PolicyVerdict;
  steps: ExecutionStep[];
  failure?: ExecutionFailure;
  actionEventIds: string[];
  receiptId?: string;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
};

export type AuditTargetType = "case" | "incident" | "policy" | "contract" | "integration";

/** spec, extended with the audit table's remaining columns. */
export type AuditEvent = {
  id: string;
  occurredAt: ISODateTime;
  actor: string;
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  result: string;
  evidenceIds?: string[];
  policyResult?: PolicyVerdict["result"];
  approvalSource?: "merchant" | "policy_automatic" | "not_required";
  caseId?: string;
  incidentId?: string;
};

export const ACTORS = {
  operator: "Priya Sharma",
  agent: "Payment Integrity Agent",
  policy: "Deterministic policy engine",
  connector: "LearnLoop connector",
} as const;

/** Runtime switches for degraded-dependency states (developer settings). */
export type SystemFlags = {
  investigationAvailable: boolean;
  policyServiceAvailable: boolean;
  outcomeVerificationAvailable: boolean;
};
