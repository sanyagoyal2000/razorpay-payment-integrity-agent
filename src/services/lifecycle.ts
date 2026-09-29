import type { IncidentRecord, IntegrityCase } from "@/domain/types";
import type { Repositories } from "@/repositories";
import { incidentTotals, isAtRisk } from "@/services/metrics/cases";
import { serviceLabel } from "@/services/policy/actions";
import { serviceHealth } from "@/services/policy/currentState";
import { assessCase } from "@/services/recovery/groups";
import { systemicBlocker } from "@/services/views/systemStatus";

export type AgentState = "monitoring" | "investigating" | "awaiting_approval" | "executing" | "verifying_outcome" | "resolved" | "blocked";

export const AGENT_STATE_LABELS: Record<AgentState, string> = {
  monitoring: "Monitoring",
  investigating: "Investigating",
  awaiting_approval: "Awaiting approval",
  executing: "Executing",
  verifying_outcome: "Verifying outcome",
  resolved: "Resolved",
  blocked: "Blocked",
};

export type Lifecycle = { state: AgentState; label: string; reason: string; caseIds: string[] };

const ACTING = new Set(["approval_recorded", "policy_rechecking", "idempotency_reserved", "action_started"]);
const VERIFYING = new Set(["awaiting_outcome", "outcome_verified"]);

const lifecycle = (state: AgentState, reason: string, caseIds: string[] = []): Lifecycle => ({ state, label: AGENT_STATE_LABELS[state], reason, caseIds });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The agent's state for a set of cases, derived from executions,
 * investigations, policy verdicts and receipts, in this order:
 * executing → verifying outcome → blocked → investigating → awaiting approval
 * → resolved → monitoring. Nothing is stored; it is recomputed each time.
 */
function stateFor(repos: Repositories, cases: readonly IntegrityCase[], asOf: string, scope: { incident?: IncidentRecord }): Lifecycle {
  const ids = new Set(cases.map((c) => c.id));
  const executions = repos.executions.list().filter((e) => ids.has(e.caseId));
  const acting = executions.filter((e) => ACTING.has(e.status));
  if (acting.length > 0) return lifecycle("executing", `${plural(acting.length, "action is", "actions are")} running, each checked by policy first.`, acting.map((e) => e.caseId));
  const verifying = executions.filter((e) => VERIFYING.has(e.status));
  if (verifying.length > 0) return lifecycle("verifying_outcome", `Waiting for the promised outcome on ${plural(verifying.length, "case", "cases")} before resolving.`, verifying.map((e) => e.caseId));

  const open = cases.filter(isAtRisk);
  const blocker = systemicBlocker(repos, asOf);
  if (blocker && open.length > 0) return lifecycle("blocked", `No action can run: ${blocker.replace(/^None /, "").replace(/^until/, "waiting until")}.`, open.map((c) => c.id));
  const incident = scope.incident;
  if (incident && open.length > 0 && serviceHealth(repos, incident.affectedService, asOf) !== "healthy") {
    return lifecycle("blocked", `${serviceLabel(incident.affectedService)} is failing; recovery waits until it is healthy.`, open.map((c) => c.id));
  }

  const uninvestigated = open.filter((c) => !c.investigation);
  const incidentUninvestigated = incident && open.length > 0 && !incident.investigation;
  if (incidentUninvestigated || uninvestigated.length > 0) {
    return lifecycle("investigating", incidentUninvestigated ? "Looking for the shared cause before recommending recovery." : `Investigating ${plural(uninvestigated.length, "new case", "new cases")}.`, (incidentUninvestigated ? open : uninvestigated).map((c) => c.id));
  }

  const assessed = open.map((c) => assessCase(repos, c, asOf));
  const awaiting = assessed.filter((a) => a.verdict?.result === "requires_approval").map((a) => a.caseData.id);
  if (awaiting.length > 0) return lifecycle("awaiting_approval", `${plural(awaiting.length, "recommendation waits", "recommendations wait")} for your approval.`, awaiting);
  if (open.length > 0 && assessed.every((a) => a.verdict?.result === "blocked")) {
    return lifecycle("blocked", `Policy blocks every proposed action for ${plural(open.length, "open case", "open cases")}; a person must decide.`, open.map((c) => c.id));
  }

  if (incident) {
    const totals = incidentTotals(incident, repos.cases.list());
    if (totals.openCaseIds.length === 0) {
      const verified = totals.resolvedCaseIds.filter((id) => repos.cases.get(id)?.resolution?.receiptId).length;
      return lifecycle("resolved", `All ${totals.caseCount} cases closed; ${verified} with a verified outcome.`, totals.resolvedCaseIds);
    }
  }
  return lifecycle("monitoring", "Checking payments against their Outcome Contracts.");
}

/** The agent's state for one incident. */
export function incidentLifecycle(repos: Repositories, incident: IncidentRecord, asOf: string): Lifecycle {
  return stateFor(repos, repos.cases.forIncident(incident.id), asOf, { incident });
}

/** The agent's overall state across every case still in play. */
export function agentLifecycle(repos: Repositories, asOf: string): Lifecycle {
  const inPlay = repos.cases.list().filter((c) => isAtRisk(c) || repos.executions.list().some((e) => e.caseId === c.id && (ACTING.has(e.status) || VERIFYING.has(e.status))));
  const active = repos.incidents.list().filter((i) => i.status !== "resolved");
  // An active incident's investigation state takes part too.
  const pending = active.find((i) => !i.investigation);
  return stateFor(repos, inPlay, asOf, pending ? { incident: pending } : {});
}
