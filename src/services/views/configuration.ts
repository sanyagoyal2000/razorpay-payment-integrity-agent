import type { ActionMode, Integration, IntegrationId, OutcomeContract, PolicyAction } from "@/domain/types";
import { sum } from "@/domain/money";
import { addDaysToDate, istDate, median, MS_PER_DAY } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { isAtRisk } from "@/services/metrics/cases";
import { POLICY_ACTION_LABELS } from "@/services/policy/actions";

// ---------------------------------------------------------------------------
// Outcome Contracts
// ---------------------------------------------------------------------------

const RECOVERY_LABELS: Record<string, string> = {
  retry_provisioning: "Retry provisioning",
  replay_webhook: "Replay webhook",
  escalate: "Escalate",
};

export type ContractRow = {
  id: string;
  name: string;
  status: OutcomeContract["status"];
  paymentType: string;
  expectedOutcome: string;
  deadlineSeconds: number;
  safeRecovery: string;
  maxAutomaticValue: number;
  completionRate: number | null;
  paymentsLast7Days: number;
  openCases: number;
  openCaseIds: string[];
};

/** Completion over the last 7 IST days: on-time outcomes plus verified case recoveries, over captured payments. */
export function contractCompletion(repos: Repositories, contractId: string, asOf: string, days = 7) {
  const since = addDaysToDate(istDate(asOf), -(days - 1));
  const stats = repos.config.dailyStats().filter((s) => s.contractId === contractId && s.date >= since);
  const captured = sum(stats.map((s) => s.paymentsCaptured));
  const recovered = stats.flatMap((s) => s.caseIds).filter((id) => {
    const c = repos.cases.get(id);
    return c?.status === "resolved" && c.resolution !== undefined && c.resolution.resolvedAt <= asOf;
  }).length;
  const completed = sum(stats.map((s) => s.outcomesConfirmedOnTime)) + recovered;
  return { captured, completed, rate: captured === 0 ? null : completed / captured };
}

export function contractRows(repos: Repositories, asOf: string): ContractRow[] {
  const cases = repos.cases.list();
  const order: Record<OutcomeContract["status"], number> = { active: 0, paused: 1, draft: 2 };
  return repos.config
    .contracts()
    .map((c) => {
      const completion = contractCompletion(repos, c.id, asOf);
      const open = cases.filter((x) => x.outcomeContractId === c.id && isAtRisk(x));
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        paymentType: c.paymentType,
        expectedOutcome: c.expectedOutcome,
        deadlineSeconds: c.deadlineSeconds,
        safeRecovery: RECOVERY_LABELS[c.safeRecoveryAction] ?? c.safeRecoveryAction,
        maxAutomaticValue: c.maxAutomaticValue,
        completionRate: completion.rate,
        paymentsLast7Days: completion.captured,
        openCases: open.length,
        openCaseIds: open.map((x) => x.id),
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export const ACTION_DESCRIPTIONS: Record<PolicyAction, string> = {
  retry_provisioning: "Ask the merchant's fulfilment service to grant the outcome again.",
  replay_webhook: "Resend Razorpay's order.paid webhook to the merchant.",
  capture_payment: "Capture an authorised payment before it is refunded automatically.",
  prepare_refund: "Draft a refund for the merchant's finance team to issue.",
  issue_refund: "Refund a payment through Razorpay.",
  notify_customer: "Send a message to the affected customer.",
  escalate: "Post the case to the merchant's incident channel for a person to review.",
};

export const MODE_OPTIONS: Array<{ value: ActionMode; label: string; description: string }> = [
  { value: "suggest_only", label: "Suggest only", description: "The agent proposes; you approve every run." },
  { value: "automatic_below_threshold", label: "Automatic below thresholds", description: "Runs without approval when amount and confidence are within limits." },
  { value: "always_require_approval", label: "Always require approval", description: "Every run needs your individual approval." },
  { value: "disabled", label: "Disabled", description: "Never proposed or run." },
];

export function actionPolicyRows(repos: Repositories) {
  const scopes = new Set(repos.config.integrations().filter((i) => i.status === "connected").flatMap((i) => i.scopes.write));
  const needs: Partial<Record<PolicyAction, string>> = {
    retry_provisioning: "grant_course_access",
    replay_webhook: "replay_webhook",
    capture_payment: "capture_payment",
    issue_refund: "issue_refund",
    notify_customer: "send_customer_message",
    escalate: "create_incident",
  };
  return repos.config.actionPolicies().map((p) => {
    const scope = needs[p.action];
    return {
      action: p.action,
      label: POLICY_ACTION_LABELS[p.action],
      description: ACTION_DESCRIPTIONS[p.action],
      mode: p.mode,
      updatedAt: p.updatedAt,
      updatedBy: p.updatedBy,
      permissionMissing: scope !== undefined && !scopes.has(scope) ? scope : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

const WRITE_SCOPE_ACTIONS: Record<string, string> = {
  grant_course_access: "Retry provisioning",
  capture_payment: "Capture payment",
  replay_webhook: "Replay webhook",
  send_customer_message: "Notify customer",
  create_incident: "Escalate",
  post_message: "Post updates",
};

export type IntegrationRow = Integration & {
  lastSuccessfulEventAt?: string;
  errorSummary: string;
  actionsAllowed: string[];
};

function latest(values: Array<string | undefined>, asOf: string): string | undefined {
  return values.filter((v): v is string => v !== undefined && v <= asOf).sort().at(-1);
}

export function integrationRows(repos: Repositories, asOf: string): IntegrationRow[] {
  const weekAgo = new Date(Date.parse(asOf) - 7 * MS_PER_DAY).toISOString();
  const since = addDaysToDate(istDate(asOf), -6);
  const stats = repos.config.dailyStats().filter((s) => s.date >= since);
  const payments = repos.payments.list();
  const outcomeEvents = payments.flatMap((p) => repos.outcomes.events(p.merchantOrderId));
  const logs = repos.config.connectorLogs().filter((l) => l.occurredAt >= weekAgo && l.occurredAt <= asOf);
  const audit = repos.audit.list();

  const lastSuccess: Record<IntegrationId, string | undefined> = {
    razorpay_payments: latest(payments.flatMap((p) => repos.payments.deliveriesForPayment(p.id)).filter((d) => d.status === "delivered").map((d) => d.occurredAt), asOf),
    learnloop_orders: latest(repos.payments.list().map((p) => p.createdAt), asOf),
    learnloop_enrolment: latest(outcomeEvents.filter((e) => e.status === "completed").map((e) => e.occurredAt), asOf),
    customer_comms: latest(audit.filter((e) => e.action === "Contacted customer" || e.action === "Notify affected customers").map((e) => e.occurredAt), asOf),
    incident_management: latest(audit.filter((e) => e.actor === "LearnLoop connector" && /Posted/.test(e.result)).map((e) => e.occurredAt), asOf),
    learnloop_observability: latest(repos.outcomes.observability().map((e) => e.occurredAt), asOf),
  };

  const attempts = sum(stats.map((s) => s.webhookAttempts));
  const failures = sum(stats.map((s) => s.webhookFailures));
  const coursePayments = sum(stats.filter((s) => s.contractId === "ctr_course_purchase").map((s) => s.paymentsCaptured));
  const enrolFailures = outcomeEvents.filter((e) => (e.type === "enrolment.failed" || e.type === "booking.failed") && e.occurredAt >= weekAgo && e.occurredAt <= asOf).length;
  const pct = (n: number, d: number) => (d === 0 ? "No traffic" : `${((n / d) * 100).toFixed(2)}% errors (${n} of ${d.toLocaleString("en-IN")}), 7 days`);
  const logSummary = (id: IntegrationId) => {
    const own = logs.filter((l) => l.integrationId === id);
    return own.length === 0 ? "No errors in 7 days" : `${own.length} ${own.length === 1 ? "error" : "errors"} in 7 days`;
  };

  return repos.config.integrations().map((i) => {
    const row: IntegrationRow = {
      ...i,
      errorSummary:
        i.id === "razorpay_payments" ? pct(failures, attempts) : i.id === "learnloop_enrolment" ? pct(enrolFailures, coursePayments) : logSummary(i.id),
      actionsAllowed: i.status === "connected" ? i.scopes.write.map((s) => WRITE_SCOPE_ACTIONS[s] ?? s) : [],
    };
    const last = lastSuccess[i.id];
    if (last) row.lastSuccessfulEventAt = last;
    return row;
  });
}

export function integrationHealth(repos: Repositories, asOf: string) {
  const since = addDaysToDate(istDate(asOf), -6);
  const stats = repos.config.dailyStats().filter((s) => s.date >= since);
  const attempts = sum(stats.map((s) => s.webhookAttempts));
  const failures = sum(stats.map((s) => s.webhookFailures));
  const captured = sum(stats.map((s) => s.paymentsCaptured));
  const recovered = stats.flatMap((s) => s.caseIds).filter((id) => repos.cases.get(id)?.status === "resolved").length;
  const confirmed = sum(stats.map((s) => s.outcomesConfirmedOnTime)) + recovered;
  const monthAgo = new Date(Date.parse(asOf) - 30 * MS_PER_DAY).toISOString();
  const logs = repos.config.connectorLogs().filter((l) => l.occurredAt >= monthAgo && l.occurredAt <= asOf);
  const count = (kind: string) => logs.filter((l) => l.kind === kind);
  return {
    webhookSuccess: { value: attempts === 0 ? null : (attempts - failures) / attempts, detail: `${(attempts - failures).toLocaleString("en-IN")} of ${attempts.toLocaleString("en-IN")} deliveries, 7 days` },
    receiptCompletion: { value: captured === 0 ? null : confirmed / captured, detail: `${confirmed.toLocaleString("en-IN")} of ${captured.toLocaleString("en-IN")} payments, 7 days` },
    medianLatencyMs: { value: median(stats.map((s) => s.medianEventLatencyMs)) ?? null, detail: "Capture to webhook delivery, median of daily medians" },
    authErrors: { value: count("auth_error").length, detail: count("auth_error").map((l) => l.detail).join(" ") || "None in 30 days" },
    schemaErrors: { value: count("schema_error").length, detail: count("schema_error").map((l) => l.detail).join(" ") || "None in 30 days" },
    permissionFailures: { value: count("permission_denied").length, detail: count("permission_denied").map((l) => l.detail).join(" ") || "None in 30 days. Out-of-scope actions are blocked by policy before any call." },
  };
}

/** Scopes Payment Integrity can use right now, across connected integrations. */
export function permissionModel(repos: Repositories) {
  const connected = repos.config.integrations().filter((i) => i.status === "connected");
  const revoked = repos.config.integrations().filter((i) => i.status !== "connected");
  const unique = (xs: string[]) => [...new Set(xs)];
  return {
    read: unique(connected.flatMap((i) => i.scopes.read)),
    write: unique(connected.flatMap((i) => i.scopes.write)),
    notGranted: unique([...connected.flatMap((i) => i.scopes.notGranted), ...revoked.flatMap((i) => [...i.scopes.write])]),
  };
}
