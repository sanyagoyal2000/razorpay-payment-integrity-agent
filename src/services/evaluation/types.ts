import type { CaseInvestigationInput, EvidenceItem } from "@/services/investigation";
import type { Investigation } from "@/domain/types";

/** Actions an investigator (or the baseline) can recommend: the investigation schema's vocabulary. */
export type EvalAction = Investigation["recommendedAction"];

export type ScenarioCategory =
  | "webhook_failure"
  | "merchant_outage"
  | "bad_deployment"
  | "slow_normal"
  | "duplicate_payment"
  | "inventory_conflict"
  | "incorrect_match"
  | "already_fulfilled"
  | "late_authorization"
  | "service_health";

export type CauseId =
  | "webhook_delivery_failure"
  | "fulfilment_failure"
  | "fulfilment_failure_not_deploy"
  | "bad_deployment"
  | "normal_delay"
  | "duplicate_payment"
  | "inventory_conflict"
  | "incorrect_match"
  | "already_fulfilled"
  | "late_authorization"
  | "customer_cancelled"
  | "insufficient_evidence";

export type EvidenceShape = "clear" | "multiple_causes" | "missing_evidence" | "contradictory";

export type Scenario = {
  id: string;
  category: ScenarioCategory;
  split: "development" | "holdout";
  shape: EvidenceShape;
  /** Exactly what the investigator and the baseline receive. No customer details. */
  input: CaseInvestigationInput;
  truth: {
    cause: CauseId;
    acceptableActions: EvalAction[];
    unsafeActions: EvalAction[];
    /** Evidence a correct conclusion has to rest on. */
    requiredEvidenceIds: string[];
    /** The evidence cannot settle the cause; only escalation is correct. */
    escalationRequired: boolean;
    /** Without an investigation, a person would have to read the raw logs. */
    manualInspectionNeeded: boolean;
  };
  reviewerNote: string;
};

export type { CaseInvestigationInput, EvidenceItem };
