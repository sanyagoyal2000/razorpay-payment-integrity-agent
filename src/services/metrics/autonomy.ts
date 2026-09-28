import type { ActionType, CaseType, Execution } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import { median } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { isAtRisk } from "./cases";

export type Distribution = { min: number; median: number; max: number };

export type AutonomyEvidence = {
  action: ActionType;
  /** Size of both samples: the latest reviewed recommendations and the latest executed actions. */
  windowSize: number;

  // Merchant agreement. Informative only: approval is never counted as success.
  recommendationsReviewed: number;
  approvedWithoutEdits: number;
  /** Cases behind the reviewed recommendations. */
  caseIds: string[];
  approvedCaseIds: string[];

  // Verified outcomes: the evidence eligibility is decided on.
  executed: number;
  executedCaseIds: string[];
  /** Resolved with a confirmed Outcome Receipt and never marked wrong. */
  verifiedSuccessful: number;
  verifiedCaseIds: string[];
  /** Executed but not yet verified; neither success nor failure. */
  awaitingVerificationCaseIds: string[];
  failedExecutions: number;
  failedCaseIds: string[];
  /** Failed executions whose case is still at risk. */
  unresolvedFailureCaseIds: string[];
  wrongActions: number;
  wrongActionCaseIds: string[];
  verificationRate: number;
  wrongActionRate: number;
  /** When the executed sample starts and ends. */
  evaluationWindow?: { from: string; to: string };

  amounts?: Distribution;
  confidence?: Distribution;
  caseTypes: Array<{ type: CaseType; count: number }>;
  contracts: Array<{ id: string; name: string; executed: number; verified: number }>;
};

function distribution(values: number[]): Distribution | undefined {
  if (values.length === 0) return undefined;
  return { min: Math.min(...values), median: median(values)!, max: Math.max(...values) };
}

/** The action reached the merchant or gateway: stopped executions never acted. */
function acted(execution: Execution): boolean {
  return execution.steps.some((s) => s.state === "action_started");
}

/**
 * Evidence for running `action` with less review. Merchant agreement comes
 * from the latest `windowSize` reviewed recommendations; success comes only
 * from the latest `windowSize` executed actions, checked against Outcome
 * Receipts and later wrong-action records.
 */
export function earnedAutonomy(repos: Repositories, action: ActionType, windowSize = 50): AutonomyEvidence {
  const decisions = repos.cases
    .list()
    .filter((c) => c.recommendation?.action === action)
    .flatMap((c) => {
      const decision = c.decisions.find((d) => d.actor === ACTORS.operator && d.kind !== "wait");
      return decision ? [{ caseId: c.id, decision }] : [];
    })
    .sort((a, b) => b.decision.decidedAt.localeCompare(a.decision.decidedAt))
    .slice(0, windowSize);
  const approved = decisions.filter((d) => d.decision.kind === "approved" && !d.decision.edited && d.decision.action === action);

  const executions = repos.executions
    .list()
    .filter((e) => e.action === action && acted(e))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, windowSize);
  const caseOf = (e: Execution) => repos.cases.get(e.caseId);
  const verified = executions.filter((e) => {
    const c = caseOf(e);
    const receipt = e.receiptId ? repos.outcomes.receipt(e.receiptId) : undefined;
    return e.status === "resolved" && receipt?.status === "confirmed" && c !== undefined && c.wrongAction === undefined;
  });
  const failed = executions.filter((e) => e.status === "failed");
  const wrong = executions.filter((e) => caseOf(e)?.wrongAction !== undefined);
  const awaiting = executions.filter((e) => e.status !== "resolved" && e.status !== "failed" && e.status !== "stopped");

  const executedCases = executions.map(caseOf).filter((c) => c !== undefined);
  const typeCounts = new Map<CaseType, number>();
  for (const c of executedCases) typeCounts.set(c.type, (typeCounts.get(c.type) ?? 0) + 1);
  const verifiedIds = new Set(verified.map((e) => e.caseId));
  const contractIds = [...new Set(executedCases.map((c) => c.outcomeContractId))];
  const starts = executions.map((e) => e.startedAt).sort();

  return {
    action,
    windowSize,
    recommendationsReviewed: decisions.length,
    approvedWithoutEdits: approved.length,
    caseIds: decisions.map((d) => d.caseId),
    approvedCaseIds: approved.map((d) => d.caseId),
    executed: executions.length,
    executedCaseIds: executions.map((e) => e.caseId),
    verifiedSuccessful: verified.length,
    verifiedCaseIds: verified.map((e) => e.caseId),
    awaitingVerificationCaseIds: awaiting.map((e) => e.caseId),
    failedExecutions: failed.length,
    failedCaseIds: failed.map((e) => e.caseId),
    unresolvedFailureCaseIds: failed.filter((e) => {
      const c = caseOf(e);
      return c !== undefined && isAtRisk(c);
    }).map((e) => e.caseId),
    wrongActions: wrong.length,
    wrongActionCaseIds: wrong.map((e) => e.caseId),
    verificationRate: executions.length === 0 ? 0 : verified.length / executions.length,
    wrongActionRate: executions.length === 0 ? 0 : wrong.length / executions.length,
    ...(starts.length > 0 ? { evaluationWindow: { from: starts[0]!, to: starts.at(-1)! } } : {}),
    ...(executedCases.length > 0 ? { amounts: distribution(executedCases.map((c) => c.amountAtRisk)) } : {}),
    ...(executedCases.some((c) => c.recommendation)
      ? { confidence: distribution(executedCases.flatMap((c) => (c.recommendation ? [c.recommendation.confidence] : []))) }
      : {}),
    caseTypes: [...typeCounts.entries()].map(([type, count]) => ({ type, count })),
    contracts: contractIds.map((id) => ({
      id,
      name: repos.config.contract(id)?.name ?? id,
      executed: executedCases.filter((c) => c.outcomeContractId === id).length,
      verified: executedCases.filter((c) => c.outcomeContractId === id && verifiedIds.has(c.id)).length,
    })),
  };
}
