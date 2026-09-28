import type { ActionType } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import type { Repositories } from "@/repositories";

export type AutonomyEvidence = {
  action: ActionType;
  window: number;
  considered: number;
  approvedWithoutEdits: number;
  caseIds: string[];
};

/**
 * Merchant decisions on the most recent `window` cases where `action` was
 * recommended. Used to suggest, never to apply, more automation.
 */
export function earnedAutonomy(repos: Repositories, action: ActionType, window = 50): AutonomyEvidence {
  const decisions = repos.cases
    .list()
    .filter((c) => c.recommendation?.action === action)
    .flatMap((c) => {
      const decision = c.decisions.find((d) => d.actor === ACTORS.operator && d.kind !== "wait");
      return decision ? [{ caseId: c.id, decision }] : [];
    })
    .sort((a, b) => b.decision.decidedAt.localeCompare(a.decision.decidedAt))
    .slice(0, window);
  const approved = decisions.filter((d) => d.decision.kind === "approved" && !d.decision.edited && d.decision.action === action);
  return {
    action,
    window,
    considered: decisions.length,
    approvedWithoutEdits: approved.length,
    caseIds: decisions.map((d) => d.caseId),
  };
}
