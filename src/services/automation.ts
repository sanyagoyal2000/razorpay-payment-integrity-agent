import { ACTORS } from "@/domain/types";
import type { Repositories } from "@/repositories";
import { escalate } from "@/services/decisions";
import { approveAndStart, EXECUTABLE_ACTIONS, type ExecutionDeps } from "@/services/execution";
import { isAtRisk } from "@/services/metrics/cases";
import { ACTIONS, POLICY_ACTION_LABELS } from "@/services/policy/actions";
import { evaluateCase, isDataFresh } from "@/services/policy/currentState";

/** Statuses from which an automatic action may start. Escalated cases already wait for a person. */
const STARTABLE = new Set(["open", "review_required"]);

export type AutomaticRun = { caseId: string; action: string; executionId?: string };

/**
 * Runs recommendations that policy allows without approval: the action's
 * Automations mode is "Automatic below thresholds" and every check passes.
 * Nothing else runs; a verdict of "requires approval" or "blocked" is left for
 * a person. Does nothing while automation is paused or data is stale.
 * Returns what started, so the caller can drive any executions.
 */
export function runAutomaticActions(deps: ExecutionDeps, asOf: string): AutomaticRun[] {
  const { repos } = deps;
  if (repos.config.globalControls().automationPaused || !isDataFresh(repos, asOf)) return [];
  const modes = repos.config.actionModes();
  const runs: AutomaticRun[] = [];
  for (const c of repos.cases.list()) {
    if (!STARTABLE.has(c.status) || !isAtRisk(c) || !c.recommendation) continue;
    const action = c.recommendation.action;
    const policyAction = ACTIONS[action].policyAction;
    if (!policyAction || modes[policyAction] !== "automatic_below_threshold") continue;
    if (evaluateCase(repos, c, c.recommendation, asOf).result !== "allowed") continue;
    if (action === "escalate") {
      const cause = c.investigation?.likelyCause.replace(/\.$/, "");
      escalate(repos, c.id, `Escalated automatically by policy${cause ? `. Likely cause: ${cause}` : ""}.`, ACTORS.policy, asOf);
      runs.push({ caseId: c.id, action });
    } else if (EXECUTABLE_ACTIONS.has(action)) {
      const execution = approveAndStart(deps, { caseId: c.id, action, actor: ACTORS.policy, approvalSource: "policy_automatic" });
      runs.push({ caseId: c.id, action, executionId: execution.id });
    }
  }
  return runs;
}

export type AutomationSummary = {
  paused: boolean;
  /** Actions set to run automatically below thresholds. */
  automaticActions: string[];
  /** The latest action that ran without merchant approval. */
  lastRunAt?: string;
  lastRunCaseId?: string;
  /** Open cases whose recommendation could run automatically right now. */
  eligibleNow: string[];
  headline: string;
  detail: string;
};

/**
 * What automation is actually doing, from the action policies and the audit
 * log, for the Automations banner and the Overview status.
 */
export function automationSummary(repos: Repositories, asOf: string): AutomationSummary {
  const paused = repos.config.globalControls().automationPaused;
  const automatic = repos.config.actionPolicies().filter((p) => p.mode === "automatic_below_threshold").map((p) => p.action);
  const names = automatic.map((a) => POLICY_ACTION_LABELS[a]);
  const last = repos.audit
    .list()
    .filter((e) => e.occurredAt <= asOf && e.actor === ACTORS.policy && (e.action === "Escalated case" || e.action === "Approved automatically"))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .at(-1);
  const eligibleNow = paused
    ? []
    : repos.cases
        .list()
        .filter((c) => STARTABLE.has(c.status) && isAtRisk(c) && c.recommendation && automatic.includes(ACTIONS[c.recommendation.action].policyAction!))
        .filter((c) => evaluateCase(repos, c, c.recommendation!, asOf).result === "allowed")
        .map((c) => c.id);
  const count = `${automatic.length} ${automatic.length === 1 ? "action" : "actions"}`;
  const headline = paused
    ? "All automated actions are paused"
    : automatic.length === 0
      ? "No action runs automatically"
      : `${count} can run automatically (${names.join(", ")})`;
  const lastRun = last ? `last automatic run ${last.caseId ?? last.targetId}` : "no automatic run yet";
  const detail = paused
    ? "No automated actions will execute. Monitoring and investigation continue."
    : automatic.length === 0
      ? "Every action waits for approval."
      : eligibleNow.length > 0
        ? `${eligibleNow.length} ${eligibleNow.length === 1 ? "case qualifies" : "cases qualify"} now and will run on the next check; ${lastRun}.`
        : last
          ? `Runs only when policy allows the recommended action with no approval needed; ${lastRun}.`
          : "Runs only when policy allows the recommended action with no approval needed. No open case has qualified yet.";
  return {
    paused,
    automaticActions: names,
    ...(last ? { lastRunAt: last.occurredAt, ...(last.caseId ? { lastRunCaseId: last.caseId } : {}) } : {}),
    eligibleNow,
    headline,
    detail,
  };
}
