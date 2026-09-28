import type {
  ActionType,
  CurrentMerchantState,
  IntegrityCase,
  MerchantOutcomeEvent,
  OutcomeContract,
  PolicyVerdict,
  Recommendation,
} from "@/domain/types";
import { istDate } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { evaluatePolicy, policyUnavailableVerdict } from "./evaluatePolicy";

export function requireContract(repos: Repositories, id: string): OutcomeContract {
  const contract = repos.config.contract(id);
  if (!contract) throw new Error(`Unknown Outcome Contract ${id}`);
  return contract;
}

/** Current health of a merchant service, from the latest observability signal at or before `asOf`. */
export function serviceHealth(repos: Repositories, service: string, asOf: string): "healthy" | "down" {
  const latest = repos.outcomes
    .observability(service)
    .filter((e) => e.type !== "deploy.completed" && e.occurredAt <= asOf)
    .at(-1);
  return latest?.type === "service.errors_detected" ? "down" : "healthy";
}

export function outcomeState(
  events: MerchantOutcomeEvent[],
  contract: OutcomeContract,
  asOf: string,
): CurrentMerchantState["outcome"] {
  const known = events.filter((e) => e.occurredAt <= asOf);
  const completed = known.filter((e) => e.type === contract.expectedOutcome && e.status === "completed").at(-1);
  if (completed) return { state: "completed", lastEventId: completed.id };
  const last = known.filter((e) => e.type !== "inventory_changed").at(-1);
  if (!last) return { state: "missing" };
  if (last.status === "failed") return { state: "failed", lastEventId: last.id };
  if (last.type === contract.expectedOutcome && last.status === "pending") return { state: "pending", lastEventId: last.id };
  return { state: "missing", lastEventId: last.id };
}

export function idempotencyKey(paymentId: string, action: ActionType): string {
  const normalised = action === "review_duplicate" ? "retry_provisioning" : action;
  return `${paymentId}:${normalised}`;
}

/** Re-fetches everything policy depends on for `caseData` as of `asOf`. */
export function buildCurrentState(
  repos: Repositories,
  caseData: IntegrityCase,
  action: ActionType,
  asOf: string,
): CurrentMerchantState {
  const payment = repos.payments.get(caseData.paymentId);
  if (!payment) throw new Error(`Payment ${caseData.paymentId} not found`);
  const contract = requireContract(repos, caseData.outcomeContractId);
  const events = repos.outcomes.events(payment.merchantOrderId);
  const flags = repos.config.flags();

  const inventoryChange = events.filter((e) => e.type === "inventory_changed" && e.occurredAt <= asOf).at(-1);
  const replacement = inventoryChange?.metadata?.["replacementAvailable"];

  const connected = repos.config.integrations().filter((i) => i.status === "connected");
  const grantedScopes = connected.flatMap((i) => [...i.scopes.read, ...i.scopes.write]);
  const outcomeIntegration = repos.config.integration("learnloop_enrolment");

  const key = idempotencyKey(payment.id, action);
  const keyUsed = repos.executions
    .withKey(key)
    .some((e) => e.steps.some((step) => step.state === "idempotency_reserved"));

  const today = istDate(asOf);
  const refundsIssuedToday = repos.payments
    .list()
    .flatMap((p) => repos.payments.events(p.id))
    .filter((e) => e.type === "payment.refunded" && e.occurredAt <= asOf && istDate(e.occurredAt) === today)
    .reduce((total, e) => total + Number(e.metadata?.["amount"] ?? 0), 0);

  return {
    asOf,
    payment: {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      ...(payment.captureDeadline ? { captureDeadline: payment.captureDeadline } : {}),
    },
    outcome: outcomeState(events, contract, asOf),
    successfulDuplicatePaymentIds: caseData.relatedPaymentIds.filter((id) => repos.payments.get(id)?.status === "captured"),
    inventory: contract.requiresInventoryCheck
      ? {
          applicable: true,
          unchanged: inventoryChange === undefined,
          replacementAvailable: typeof replacement === "boolean" ? replacement : null,
        }
      : { applicable: false },
    recordMatch: { method: "exact_key", confidence: 1 },
    grantedScopes,
    actionModes: repos.config.actionModes(),
    contract: {
      id: contract.id,
      status: contract.status,
      maxAutomaticValue: contract.maxAutomaticValue,
      minimumConfidence: contract.minimumConfidence,
      alwaysReviewCaseTypes: contract.alwaysReviewCaseTypes,
      fulfilmentService: contract.fulfilmentService,
    },
    controls: repos.config.globalControls(),
    fulfilmentServiceHealth: serviceHealth(repos, contract.fulfilmentService, asOf),
    outcomeVerificationAvailable: flags.outcomeVerificationAvailable && outcomeIntegration?.status === "connected",
    idempotency: { keyAvailable: !keyUsed },
    refundsIssuedToday,
  };
}

/**
 * Evaluates policy for a case against freshly fetched state. Honors the
 * policy-service availability flag: when it is down, every action is blocked.
 */
export function evaluateCase(
  repos: Repositories,
  caseData: IntegrityCase,
  recommendation: Recommendation,
  asOf: string,
): PolicyVerdict {
  if (!repos.config.flags().policyServiceAvailable) return policyUnavailableVerdict(recommendation, asOf);
  return evaluatePolicy(caseData, recommendation, buildCurrentState(repos, caseData, recommendation.action, asOf));
}
