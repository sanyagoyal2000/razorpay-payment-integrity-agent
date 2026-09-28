import type { ActionType, CaseType, Investigation, Recommendation } from "@/domain/types";

/**
 * Turns a validated investigation into the case's recommendation. Duplicate
 * payments are never recovered blindly: "grant access" becomes a duplicate
 * review (grant once against the original charge, then review the second).
 */
export function toRecommendation(
  investigation: Investigation,
  caseType: CaseType,
  createdAt: string,
  origin: Recommendation["origin"] = "investigation",
): Recommendation {
  let action: ActionType = investigation.recommendedAction;
  if (caseType === "duplicate_payment" && action === "retry_provisioning") action = "review_duplicate";
  return {
    action,
    summary: investigation.summary,
    confidence: investigation.confidence,
    evidenceIds: investigation.evidenceIds,
    uncertainties: investigation.uncertainties,
    customerImpact: investigation.customerImpact,
    consequenceOfInaction: investigation.consequenceOfInaction,
    origin,
    createdAt,
  };
}
