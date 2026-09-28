import type { IntegrityCase, PolicyVerdict } from "@/domain/types";
import { sum } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { isAtRisk } from "@/services/metrics/cases";
import { evaluateCase } from "@/services/policy/currentState";
import { actionLabel } from "@/services/policy/actions";

export type RecoveryGroupId = "safe" | "duplicate_review" | "high_value" | "individual_review" | "blocked";

export type RecoveryGroup = {
  id: RecoveryGroupId;
  label: string;
  caseIds: string[];
  value: number;
  recommendation: string;
  policy: string;
  bulkEligible: boolean;
};

const GROUP_META: Record<RecoveryGroupId, { label: string; policy: string }> = {
  safe: { label: "Safe to recover", policy: "Eligible after approval" },
  duplicate_review: { label: "Duplicate review", policy: "Manual review" },
  high_value: { label: "High value", policy: "Approval required" },
  individual_review: { label: "Needs individual review", policy: "Approval required" },
  blocked: { label: "Blocked by policy", policy: "Blocked" },
};

export type CaseAssessment = { caseData: IntegrityCase; verdict: PolicyVerdict | undefined; group: RecoveryGroupId | undefined };

/** Assigns a case to a recovery group from its current policy verdict. */
export function assessCase(repos: Repositories, caseData: IntegrityCase, asOf: string): CaseAssessment {
  if (!isAtRisk(caseData) || !caseData.recommendation) return { caseData, verdict: undefined, group: undefined };
  const verdict = evaluateCase(repos, caseData, caseData.recommendation, asOf);
  const failed = (id: string) => verdict.checks.some((c) => c.id === id && c.status !== "passed");
  let group: RecoveryGroupId;
  if (caseData.type === "duplicate_payment") group = "duplicate_review";
  else if (verdict.result === "blocked") group = "blocked";
  else if (failed("amount_within_limit")) group = "high_value";
  else if (caseData.recommendation.action === "retry_provisioning" && (verdict.result === "allowed" || verdict.approvalScope === "bulk")) group = "safe";
  else group = "individual_review";
  return { caseData, verdict, group };
}

/** Groups an incident's open cases by recommended treatment. Empty groups are omitted. */
export function groupIncidentCases(repos: Repositories, incidentId: string, asOf: string): RecoveryGroup[] {
  const assessments = repos.cases.forIncident(incidentId).map((c) => assessCase(repos, c, asOf));
  const order: RecoveryGroupId[] = ["safe", "duplicate_review", "high_value", "individual_review", "blocked"];
  return order
    .map((id): RecoveryGroup => {
      const members = assessments.filter((a) => a.group === id).map((a) => a.caseData);
      const actions = [...new Set(members.map((c) => actionLabel(c.recommendation!.action, repos.config.contract(c.outcomeContractId))))];
      return {
        id,
        ...GROUP_META[id],
        caseIds: members.map((c) => c.id),
        value: sum(members.map((c) => c.amountAtRisk)),
        recommendation: actions.join(", "),
        bulkEligible: id === "safe",
      };
    })
    .filter((g) => g.caseIds.length > 0);
}

export type BulkPlan = {
  action: "retry_provisioning";
  eligible: IntegrityCase[];
  excluded: Array<{ caseId: string; reason: string }>;
  value: number;
};

/**
 * Filters a selection down to cases that may be approved together: open cases
 * whose recommendation is retry provisioning and whose verdict allows bulk
 * approval. Duplicates and policy-blocked cases are always excluded.
 */
export function planBulkRecovery(repos: Repositories, caseIds: readonly string[], asOf: string): BulkPlan {
  const eligible: IntegrityCase[] = [];
  const excluded: BulkPlan["excluded"] = [];
  for (const caseId of caseIds) {
    const c = repos.cases.get(caseId);
    if (!c) {
      excluded.push({ caseId, reason: "Case not found" });
      continue;
    }
    const { verdict, group } = assessCase(repos, c, asOf);
    if (!verdict || !group) excluded.push({ caseId, reason: "Case is not awaiting a recovery decision" });
    else if (c.type === "duplicate_payment") excluded.push({ caseId, reason: "Duplicate payments need individual review" });
    else if (verdict.result === "blocked") excluded.push({ caseId, reason: "Blocked by policy" });
    else if (c.recommendation?.action !== "retry_provisioning") excluded.push({ caseId, reason: "Different recommended action" });
    else if (group !== "safe") excluded.push({ caseId, reason: group === "high_value" ? "Above the automatic value limit; approve individually" : "Needs individual approval" });
    else eligible.push(c);
  }
  return { action: "retry_provisioning", eligible, excluded, value: sum(eligible.map((c) => c.amountAtRisk)) };
}
