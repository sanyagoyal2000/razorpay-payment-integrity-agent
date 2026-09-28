import { formatDuration } from "@/domain/time";
import { ACTORS, type IntegrityCase } from "@/domain/types";
import type { Repositories } from "@/repositories";
import { reinvestigateCase, type AgentDeps } from "@/services/agent";
import { isDataFresh, requireContract } from "@/services/policy/currentState";

/**
 * Observed cases whose contract deadline has passed without the contracted
 * outcome. A delay inside the learned range is observed, not acted on; once the
 * deadline passes it is no longer a delay but a missing outcome.
 */
export function overdueObservations(repos: Repositories, asOf: string): IntegrityCase[] {
  return repos.cases.list().filter((c) => {
    if (c.status !== "observing" || !c.deadline || c.deadline > asOf) return false;
    const receipt = repos.outcomes.receiptForPayment(c.paymentId);
    return receipt?.status !== "confirmed";
  });
}

/**
 * Turns each overdue observation into an open missing-outcome case: records the
 * missed deadline, marks what would have happened without intervention, and
 * audits the change. Returns the promoted case IDs so the caller can start an
 * investigation for each. Does nothing while data is stale, because a missing
 * outcome cannot be told apart from one the feed has not delivered yet.
 */
export function promoteOverdueObservations(repos: Repositories, asOf: string): string[] {
  if (!isDataFresh(repos, asOf)) return [];
  const promoted: string[] = [];
  for (const c of overdueObservations(repos, asOf)) {
    const contract = requireContract(repos, c.outcomeContractId);
    const receipt = repos.outcomes.receiptForPayment(c.paymentId);
    const deadline = c.deadline!;
    repos.outcomes.appendIntegrityEvent({
      id: repos.nextId("ie"),
      source: "payment_integrity",
      type: "outcome.deadline_missed",
      caseId: c.id,
      occurredAt: deadline,
      ...(receipt ? { metadata: { receiptId: receipt.id } } : {}),
    });
    repos.outcomes.appendIntegrityEvent({ id: repos.nextId("ie"), source: "payment_integrity", type: "case.opened", caseId: c.id, occurredAt: asOf });
    repos.cases.save({
      ...c,
      type: "missing_outcome",
      status: "open",
      // A membership that never activates leads the customer to contact support.
      defaultOutcome: "customer_contact",
      updatedAt: asOf,
    });
    repos.audit.append({
      id: repos.nextId("aud"),
      occurredAt: asOf,
      actor: ACTORS.agent,
      action: "Opened case",
      targetType: "case",
      targetId: c.id,
      caseId: c.id,
      ...(c.incidentId ? { incidentId: c.incidentId } : {}),
      result: `No ${contract.expectedOutcome} within the ${formatDuration(contract.deadlineSeconds)} deadline; observation ended`,
      evidenceIds: receipt ? [receipt.id] : [],
      approvalSource: "not_required",
    });
    promoted.push(c.id);
  }
  return promoted;
}

/**
 * Promotes overdue observations, then investigates each open case that has no
 * investigation yet (including one promoted before the page was last closed),
 * so it gets a recommendation. Policy evaluates it like any other.
 */
export async function checkObservations(deps: AgentDeps): Promise<string[]> {
  const promoted = promoteOverdueObservations(deps.repos, deps.clock.now().toISOString());
  const uninvestigated = deps.repos.cases.list().filter((c) => c.status === "open" && !c.investigation && !c.investigationRun);
  for (const c of uninvestigated) await reinvestigateCase(deps, c.id);
  return promoted;
}
