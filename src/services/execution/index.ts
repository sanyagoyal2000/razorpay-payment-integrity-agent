import type {
  ActionType,
  CaseDecision,
  Execution,
  ExecutionFailure,
  ExecutionState,
  IntegrityCase,
  Recommendation,
} from "@/domain/types";
import { ACTORS, type AuditDetail } from "@/domain/types";
import { POLICY_VERSION } from "@/services/versions";
import { secondsBetween, type Clock } from "@/domain/time";
import type { MerchantAdapter, PaymentGateway } from "@/adapters/merchant/types";
import type { Repositories } from "@/repositories";
import { refreshIncident } from "@/services/incidents";
import { actionLabel } from "@/services/policy/actions";
import { evaluateCase, idempotencyKey, requireContract } from "@/services/policy/currentState";
import { planBulkRecovery } from "@/services/recovery/groups";
import { verifyOutcome } from "@/services/verification";

export type ExecutionDeps = {
  repos: Repositories;
  clock: Clock;
  merchant: MerchantAdapter;
  gateway: PaymentGateway;
};

/** Actions carried out through the execution state machine. */
export const EXECUTABLE_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "retry_provisioning",
  "review_duplicate",
  "replay_webhook",
  "capture",
]);

export const EXECUTION_STATES: readonly ExecutionState[] = [
  "approval_recorded",
  "policy_rechecking",
  "idempotency_reserved",
  "action_started",
  "awaiting_outcome",
  "outcome_verified",
  "resolved",
];

const DECIDABLE_STATUSES = new Set(["open", "review_required", "escalated"]);

export class ExecutionError extends Error {}

export function isTerminal(execution: Execution): boolean {
  return execution.status === "resolved" || execution.status === "stopped" || execution.status === "failed";
}

type Approval = {
  caseId: string;
  action: ActionType;
  actor: string;
  approvalSource: Execution["approvalSource"];
  bulk?: boolean;
};

/**
 * Records an approval and creates an execution in `approval_recorded`.
 * Refuses actions that policy currently blocks, and automatic starts that
 * policy does not allow outright.
 */
export function approveAndStart(deps: ExecutionDeps, approval: Approval): Execution {
  const { repos, clock } = deps;
  const now = clock.now().toISOString();
  const c = repos.cases.get(approval.caseId);
  if (!c) throw new ExecutionError(`Case ${approval.caseId} not found`);
  if (!DECIDABLE_STATUSES.has(c.status)) throw new ExecutionError(`Case ${c.id} is ${c.status} and cannot be approved`);
  const contract = requireContract(repos, c.outcomeContractId);
  const label = (action: ActionType) => actionLabel(action, contract);
  if (!EXECUTABLE_ACTIONS.has(approval.action)) throw new ExecutionError(`${label(approval.action)} is not executed by the state machine`);

  const recommendation = recommendationFor(c, approval.action, now);
  const verdict = evaluateCase(repos, c, recommendation, now);
  if (verdict.result === "blocked") throw new ExecutionError(`${label(approval.action)} is blocked by policy for ${c.id}`);
  if (approval.approvalSource === "policy_automatic" && verdict.result !== "allowed") {
    throw new ExecutionError(`Policy does not allow automatic ${label(approval.action).toLowerCase()} for ${c.id}`);
  }

  const edited = c.recommendation !== undefined && c.recommendation.action !== approval.action;
  const decision: CaseDecision = { decidedAt: now, actor: approval.actor, kind: "approved", action: approval.action };
  if (edited) decision.edited = true;
  if (approval.bulk) decision.bulk = true;
  const saved = repos.cases.save({ ...c, status: "approved", decisions: [...c.decisions, decision], updatedAt: now });

  const execution: Execution = {
    id: repos.nextId("exe"),
    caseId: c.id,
    action: approval.action,
    idempotencyKey: idempotencyKey(c.paymentId, approval.action),
    status: "approval_recorded",
    approvalSource: approval.approvalSource,
    approvedBy: approval.actor,
    approvedCaseVersion: saved.version,
    priorCaseStatus: c.status,
    steps: [{ state: "approval_recorded", at: now, detail: `Approved by ${approval.actor}${approval.bulk ? " (bulk)" : ""}` }],
    actionEventIds: [],
    startedAt: now,
  };
  repos.executions.save(execution);
  repos.audit.append({
    id: repos.nextId("aud"),
    occurredAt: now,
    actor: approval.actor,
    action: approval.approvalSource === "merchant" ? (approval.bulk ? "Approved recovery (bulk)" : "Approved recovery") : "Approved automatically",
    targetType: "case",
    targetId: c.id,
    caseId: c.id,
    ...(c.incidentId ? { incidentId: c.incidentId } : {}),
    detail: executionDetail(execution),
    result: edited ? `${label(approval.action)} (edited from ${label(c.recommendation!.action)})` : label(approval.action),
    evidenceIds: c.recommendation?.evidenceIds ?? [],
    policyResult: verdict.result,
    approvalSource: approval.approvalSource,
  });
  return execution;
}

/** Approves every bulk-eligible case in the selection and starts their executions. */
export function approveBulk(deps: ExecutionDeps, caseIds: readonly string[], actor: string) {
  const plan = planBulkRecovery(deps.repos, caseIds, deps.clock.now().toISOString());
  const executions = plan.eligible.map((c) =>
    approveAndStart(deps, { caseId: c.id, action: plan.action, actor, approvalSource: "merchant", bulk: true }),
  );
  return { plan, executions };
}

/** Advances an execution by one state. Returns it unchanged while awaiting the outcome. */
export function advanceExecution(deps: ExecutionDeps, executionId: string): Execution {
  const { repos, clock } = deps;
  const execution = repos.executions.get(executionId);
  if (!execution) throw new ExecutionError(`Execution ${executionId} not found`);
  if (isTerminal(execution)) return execution;
  const now = clock.now().toISOString();
  const c = repos.cases.get(execution.caseId);
  if (!c) throw new ExecutionError(`Case ${execution.caseId} not found`);
  const label = actionLabel(execution.action, requireContract(repos, c.outcomeContractId));

  switch (execution.status) {
    case "approval_recorded": {
      // Re-fetch payment and outcome state and re-evaluate policy before acting.
      if (c.version !== execution.approvedCaseVersion) {
        return stop(deps, execution, c, "case_changed", "Case changed after approval; execution stopped");
      }
      const verdict = evaluateCase(repos, c, recommendationFor(c, execution.action, now), now);
      const failing = verdict.checks.filter((check) => check.status !== "passed" && check.enforcement === "hard");
      const auditBase = auditFor(c, execution);
      repos.audit.append({
        ...auditBase,
        id: repos.nextId("aud"),
        occurredAt: now,
        actor: ACTORS.policy,
        action: "Re-checked policy before execution",
        result: verdict.result === "blocked" ? `Blocked: ${failing.map((f) => f.label).join(", ")}` : "Verdict unchanged",
        policyResult: verdict.result,
      });
      const next: Execution = { ...execution, verdict };
      if (verdict.result === "blocked") {
        return stop(deps, next, c, "policy_blocked", `Blocked by policy: ${failing.map((f) => f.label).join(", ")}`);
      }
      if (execution.approvalSource === "policy_automatic" && verdict.result !== "allowed") {
        return stop(deps, next, c, "policy_blocked", "Policy no longer allows automatic execution");
      }
      return step(repos, next, "policy_rechecking", now, "Payment, outcome and policy re-fetched; execution permitted");
    }
    case "policy_rechecking": {
      const reserved = repos.executions
        .withKey(execution.idempotencyKey)
        .some((other) => other.id !== execution.id && other.steps.some((s) => s.state === "idempotency_reserved"));
      if (reserved) return stop(deps, execution, c, "duplicate_execution", `${label} already executed for ${c.paymentId}; not repeated`);
      repos.cases.save({ ...c, status: "executing", updatedAt: now });
      return step(repos, execution, "idempotency_reserved", now, `Key ${execution.idempotencyKey} reserved`);
    }
    case "idempotency_reserved": {
      const result = callAction(deps, c, execution);
      const next: Execution = { ...execution, actionEventIds: result.eventIds };
      repos.audit.append({
        ...auditFor(c, execution),
        id: repos.nextId("aud"),
        occurredAt: now,
        actor: ACTORS.connector,
        action: `${label}: request sent`,
        result: result.accepted ? `Accepted (HTTP ${result.responseCode})` : `Rejected (HTTP ${result.responseCode})`,
        evidenceIds: result.eventIds,
      });
      if (!result.accepted) return fail(deps, next, c, "action_failed", `${label} rejected with HTTP ${result.responseCode}`);
      return step(repos, next, "action_started", now, `${label} accepted`);
    }
    case "action_started": {
      const contract = requireContract(repos, c.outcomeContractId);
      return step(repos, execution, "awaiting_outcome", now, `Waiting for ${contract.expectedOutcome}`);
    }
    case "awaiting_outcome": {
      const contract = requireContract(repos, c.outcomeContractId);
      const actionAt = execution.steps.find((s) => s.state === "action_started")!.at;
      const result = verifyOutcome(repos, c, actionAt, now);
      if (result.status === "verified") {
        repos.outcomes.appendIntegrityEvent({
          id: repos.nextId("pie"),
          source: "payment_integrity",
          type: "outcome.verified",
          caseId: c.id,
          ...(c.incidentId ? { incidentId: c.incidentId } : {}),
          occurredAt: now,
          metadata: { outcomeEventId: result.event.id, receiptId: result.receipt.id },
        });
        repos.audit.append({
          ...auditFor(c, execution),
          id: repos.nextId("aud"),
          occurredAt: now,
          actor: ACTORS.agent,
          action: "Verified outcome",
          result: `${contract.expectedOutcome} confirmed`,
          evidenceIds: [result.event.id, result.receipt.id],
        });
        return step(repos, { ...execution, receiptId: result.receipt.id }, "outcome_verified", now, `${contract.expectedOutcome} received`);
      }
      if (secondsBetween(actionAt, now) > contract.deadlineSeconds) {
        const reason = result.status === "unavailable" ? "Outcome verification unavailable" : `No ${contract.expectedOutcome} within ${contract.deadlineSeconds} s`;
        return fail(deps, execution, c, "outcome_not_verified", reason);
      }
      return execution;
    }
    case "outcome_verified": {
      const payment = repos.payments.get(c.paymentId)!;
      const order = repos.payments.order(payment.merchantOrderId);
      if (order) repos.payments.saveOrder({ ...order, status: "fulfilled" });
      repos.cases.save({
        ...c,
        status: "resolved",
        resolution: {
          resolvedAt: now,
          method: execution.approvalSource === "merchant" ? "approved_recovery" : "automatic_recovery",
          action: execution.action,
          actor: ACTORS.agent,
          ...(execution.receiptId ? { receiptId: execution.receiptId } : {}),
        },
        updatedAt: now,
      });
      repos.audit.append({
        ...auditFor(c, execution),
        id: repos.nextId("aud"),
        occurredAt: now,
        actor: ACTORS.agent,
        action: "Resolved case",
        result: "Outcome confirmed; payment and merchant outcome are consistent",
        evidenceIds: execution.receiptId ? [execution.receiptId] : [],
      });
      const resolved = step(repos, execution, "resolved", now, "Payment and merchant outcome are consistent", true);
      if (c.incidentId) refreshIncident(repos, c.incidentId, now);
      return resolved;
    }
    default:
      return execution;
  }
}

export type RunOptions = { sleep?: (ms: number) => Promise<void>; pollMs?: number };

/** Runs an execution to a terminal state, polling while the outcome is pending. */
export async function runExecution(deps: ExecutionDeps, executionId: string, options: RunOptions = {}): Promise<Execution> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = options.pollMs ?? 1000;
  let execution = deps.repos.executions.get(executionId)!;
  while (!isTerminal(execution)) {
    const before = execution.steps.length;
    execution = advanceExecution(deps, executionId);
    if (execution.steps.length === before && !isTerminal(execution)) await sleep(pollMs);
  }
  return execution;
}

/** Runs several executions concurrently to completion. */
export function runExecutions(deps: ExecutionDeps, executionIds: readonly string[], options: RunOptions = {}): Promise<Execution[]> {
  return Promise.all(executionIds.map((id) => runExecution(deps, id, options)));
}

/** Executions left mid-flight by a page reload; resumed when the app loads. */
export function pendingExecutionIds(deps: ExecutionDeps): string[] {
  return deps.repos.executions.list().filter((e) => !isTerminal(e)).map((e) => e.id);
}

function recommendationFor(c: IntegrityCase, action: ActionType, now: string): Recommendation {
  if (c.recommendation?.action === action) return c.recommendation;
  return {
    action,
    summary: c.recommendation?.summary ?? "",
    confidence: c.recommendation?.confidence ?? 0,
    evidenceIds: c.recommendation?.evidenceIds ?? [],
    uncertainties: c.recommendation?.uncertainties ?? [],
    customerImpact: c.recommendation?.customerImpact ?? "",
    consequenceOfInaction: c.recommendation?.consequenceOfInaction ?? "",
    origin: "merchant_edit",
    createdAt: now,
  };
}

function callAction(deps: ExecutionDeps, c: IntegrityCase, execution: Execution) {
  const payment = deps.repos.payments.get(c.paymentId)!;
  const key = execution.idempotencyKey;
  switch (execution.action) {
    case "capture":
      return deps.gateway.capture({ paymentId: payment.id, idempotencyKey: key });
    case "replay_webhook":
      return deps.gateway.replayWebhook({ paymentId: payment.id, idempotencyKey: key });
    default:
      return deps.merchant.fulfil({
        merchantOrderId: payment.merchantOrderId,
        contract: requireContract(deps.repos, c.outcomeContractId),
        idempotencyKey: key,
      });
  }
}

function auditFor(c: IntegrityCase, execution: Execution, extra: Partial<AuditDetail> = {}) {
  return {
    targetType: "case" as const,
    targetId: c.id,
    caseId: c.id,
    ...(c.incidentId ? { incidentId: c.incidentId } : {}),
    approvalSource: execution.approvalSource,
    detail: executionDetail(execution, extra),
  };
}

function executionDetail(execution: Execution, extra: Partial<AuditDetail> = {}): AuditDetail {
  return {
    invocationId: execution.id,
    trigger: execution.approvalSource === "merchant" ? "merchant" : "automatic_policy",
    policyVersion: POLICY_VERSION,
    idempotencyKey: execution.idempotencyKey,
    state: execution.status,
    ...extra,
  };
}

function step(
  repos: Repositories,
  execution: Execution,
  state: ExecutionState,
  at: string,
  detail: string,
  finished = false,
): Execution {
  const next: Execution = { ...execution, status: state, steps: [...execution.steps, { state, at, detail }] };
  if (finished) next.finishedAt = at;
  repos.executions.save(next);
  return next;
}

/** Stops before any external action. The case returns to its prior status unless it changed elsewhere. */
function stop(deps: ExecutionDeps, execution: Execution, c: IntegrityCase, failure: ExecutionFailure, detail: string): Execution {
  const now = deps.clock.now().toISOString();
  const next: Execution = { ...execution, status: "stopped", failure, finishedAt: now, steps: [...execution.steps, { state: "stopped", at: now, detail }] };
  deps.repos.executions.save(next);
  if (failure !== "case_changed" && (c.status === "approved" || c.status === "executing")) {
    deps.repos.cases.save({ ...c, status: execution.priorCaseStatus, updatedAt: now });
  }
  deps.repos.audit.append({
    ...auditFor(c, next, { failure }),
    id: deps.repos.nextId("aud"),
    occurredAt: now,
    actor: ACTORS.policy,
    action: "Stopped execution",
    result: detail,
    ...(execution.verdict ? { policyResult: execution.verdict.result } : {}),
  });
  return next;
}

/** Fails after an external action was attempted. The case is escalated for a person to review. */
function fail(deps: ExecutionDeps, execution: Execution, c: IntegrityCase, failure: ExecutionFailure, detail: string): Execution {
  const now = deps.clock.now().toISOString();
  const next: Execution = { ...execution, status: "failed", failure, finishedAt: now, steps: [...execution.steps, { state: "failed", at: now, detail }] };
  deps.repos.executions.save(next);
  const current = deps.repos.cases.get(c.id) ?? c;
  deps.repos.cases.save({
    ...current,
    status: "escalated",
    decisions: [...current.decisions, { decidedAt: now, actor: ACTORS.agent, kind: "escalated", reason: detail }],
    updatedAt: now,
  });
  deps.repos.audit.append({
    ...auditFor(c, next, { failure }),
    id: deps.repos.nextId("aud"),
    occurredAt: now,
    actor: ACTORS.agent,
    action: "Escalated case",
    result: detail,
  });
  return next;
}
