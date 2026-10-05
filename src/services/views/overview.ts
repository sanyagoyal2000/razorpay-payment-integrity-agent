import type { AuditEvent, IncidentRecord, IntegrityCase } from "@/domain/types";
import { formatINR } from "@/domain/money";
import { formatDuration, formatIstDateTime, formatIstShort } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { incidentTotals, isAtRisk } from "@/services/metrics/cases";
import { dailyPerformance, primaryMetrics, valueDelivered, wrongActionRate } from "@/services/metrics/overview";
import { actionLabel, theService } from "@/services/policy/actions";
import { automationSummary } from "@/services/automation";
import { observationState } from "@/services/metrics/selectors";
import { modeLabel } from "@/services/policy/evaluatePolicy";
import { assessCase, groupIncidentCases } from "@/services/recovery/groups";
import { serviceHealth } from "@/services/policy/currentState";
import { agentLifecycle } from "@/services/lifecycle";
import { SYSTEMIC_CHECKS, systemicBlocker } from "./systemStatus";

export const CASE_TYPE_LABELS: Record<IntegrityCase["type"], string> = {
  missing_outcome: "Missing outcome",
  duplicate_payment: "Duplicate payment",
  late_authorization: "Late authorisation",
  inventory_conflict: "Inventory conflict",
  delayed_processing: "Delayed processing",
};

/** When payment and outcome data were last refreshed successfully. */
export function lastDataRefresh(repos: Repositories, asOf: string): string {
  const synced = repos.config.lastSyncedAt();
  return synced <= asOf ? synced : asOf;
}

/** The agent's derived lifecycle state, with a note when automated investigation is unavailable. */
export function agentStatus(repos: Repositories, asOf: string): { label: string; detail: string } {
  const lifecycle = agentLifecycle(repos, asOf);
  const flags = repos.config.flags();
  return {
    label: lifecycle.label,
    detail: flags.investigationAvailable ? lifecycle.reason : `${lifecycle.reason} Automated investigation unavailable; deterministic detection remains active.`,
  };
}

export function automationStatus(repos: Repositories, asOf: string): { label: string; paused: boolean; detail: string } {
  const summary = automationSummary(repos, asOf);
  const n = summary.automaticActions.length;
  return {
    label: summary.paused ? "Paused" : n === 0 ? "Suggest only" : `${n} automatic ${n === 1 ? "action" : "actions"}`,
    paused: summary.paused,
    detail: summary.paused || n === 0 ? summary.detail : `${summary.automaticActions.join(", ")}: ${modeLabel("automatic_below_threshold").toLowerCase()}. ${summary.lastRunAt ? `Last automatic run ${formatIstShort(summary.lastRunAt, asOf)} IST.` : "No automatic run yet."}`,
  };
}

export type ActiveIncidentRow = {
  id: string;
  title: string;
  startedAt: string;
  affectedCustomers: number;
  revenueAtRisk: number;
  likelyCause: string;
  status: IncidentRecord["status"];
  requiredDecision: string;
};

/** What the merchant has to decide next on an incident, derived from its recovery groups. */
export function requiredDecision(repos: Repositories, incident: IncidentRecord, asOf: string): string {
  if (incident.status === "resolved") return "None";
  const blocker = systemicBlocker(repos, asOf);
  if (blocker) return blocker;
  if (serviceHealth(repos, incident.affectedService, asOf) !== "healthy") {
    return `None until ${theService(incident.affectedService)} recovers`;
  }
  const groups = groupIncidentCases(repos, incident.id, asOf);
  const safe = groups.find((g) => g.id === "safe");
  const others = groups.filter((g) => g.id !== "safe").reduce((n, g) => n + g.caseIds.length, 0);
  if (safe) {
    const rest = others > 0 ? `; review ${others} more individually` : "";
    return `Approve recovery for ${safe.caseIds.length} cases (${formatINR(safe.value)})${rest}`;
  }
  return others > 0 ? `Review ${others} ${others === 1 ? "case" : "cases"} individually` : "None";
}

export function activeIncidentRows(repos: Repositories, asOf: string): ActiveIncidentRow[] {
  const cases = repos.cases.list();
  return repos.incidents
    .list()
    .filter((i) => i.status !== "resolved")
    .map((incident) => {
      const totals = incidentTotals(incident, cases);
      return {
        id: incident.id,
        title: incident.title,
        startedAt: incident.startedAt,
        affectedCustomers: totals.affectedCustomers,
        revenueAtRisk: totals.remainingAtRisk,
        likelyCause: incident.likelyCause ?? "Under investigation",
        status: incident.status,
        requiredDecision: requiredDecision(repos, incident, asOf),
      };
    })
    .sort((a, b) => b.revenueAtRisk - a.revenueAtRisk);
}

export type AttentionRow = {
  caseId: string;
  customer: string;
  type: string;
  amount: number;
  attentionRequired: boolean;
  reason: string;
  deadline?: string;
  /** For observed cases: when the case becomes a missing outcome. */
  observationDeadline?: string;
  incidentId?: string;
};

export type AttentionSummary = { decisions: number; observing: number; heading: string };

/** The attention table's heading, counted from the rows it shows. */
export function attentionSummary(rows: readonly AttentionRow[]): AttentionSummary {
  const decisions = rows.filter((r) => r.attentionRequired).length;
  const observing = rows.length - decisions;
  const parts = [
    `${decisions} ${decisions === 1 ? "case needs" : "cases need"} an individual decision`,
    ...(observing > 0 ? [`${observing} ${observing === 1 ? "is" : "are"} being observed`] : []),
  ];
  return { decisions, observing, heading: parts.join(" · ") };
}

/**
 * Cases that need an individual decision, plus observed cases that do not,
 * each with the reason. Cases covered by an incident's safe bulk group are
 * handled on the incident and left out here.
 */
export function attentionRows(repos: Repositories, asOf: string): AttentionRow[] {
  const controls = repos.config.globalControls();
  const rows: Array<AttentionRow & { rank: number }> = [];
  for (const c of repos.cases.list()) {
    const customer = repos.payments.customer(c.customerId)?.name ?? c.customerId;
    const base = { caseId: c.id, customer, type: CASE_TYPE_LABELS[c.type], amount: c.amountAtRisk, ...(c.incidentId ? { incidentId: c.incidentId } : {}) };
    const observed = observationState(repos, c, asOf);
    if (observed) {
      const at = observed.deadline ? formatIstShort(observed.deadline, asOf) : undefined;
      const range = `median ${formatDuration(observed.p50)}, 95th percentile ${formatDuration(observed.p95)}`;
      rows.push({
        ...base,
        rank: 5,
        attentionRequired: false,
        reason: observed.deadlinePassed
          ? `Contract deadline passed at ${at} IST without the outcome. It opens as a missing outcome as soon as payment and outcome data are refreshed.`
          : observed.withinNormalRange
            ? `No action needed yet. Outcome pending for ${formatDuration(observed.delaySeconds)}, within the normal range for this contract (${range}).${at ? ` Becomes a missing outcome at ${at} IST if it has not arrived.` : ""}`
            : `No action needed yet. Outcome pending for ${formatDuration(observed.delaySeconds)}, above this contract's normal range (${range}).${at ? ` Becomes a missing outcome at ${at} IST if it has not arrived.` : ""}`,
        ...(observed.deadline && !observed.deadlinePassed ? { observationDeadline: observed.deadline } : {}),
      });
      continue;
    }
    if (!isAtRisk(c)) continue;
    const assessment = assessCase(repos, c, asOf);
    const verdict = assessment.verdict;
    let group = assessment.group;
    // A system-wide block (stale data, kill switch, ...) is explained once by the status banner:
    // judge the case as if those checks had passed.
    const hardFailures = verdict?.checks.filter((check) => check.status !== "passed" && check.enforcement === "hard") ?? [];
    if (group === "blocked" && hardFailures.length > 0 && hardFailures.every((check) => SYSTEMIC_CHECKS.has(check.id))) {
      const reviewFailures = verdict!.checks.filter((check) => check.status !== "passed" && check.enforcement === "review");
      group =
        c.type === "duplicate_payment"
          ? "duplicate_review"
          : reviewFailures.some((check) => check.id === "amount_within_limit")
            ? "high_value"
            : reviewFailures.length === 0 && c.recommendation?.action === "retry_provisioning"
              ? "safe"
              : "individual_review";
    }
    if (group === "safe") continue;
    const contract = repos.config.contract(c.outcomeContractId);
    const limit = Math.min(contract?.maxAutomaticValue ?? controls.maxAutomaticValue, controls.maxAutomaticValue);
    if (c.status === "escalated") {
      const reason = c.decisions.at(-1)?.reason ?? "Escalated for review.";
      rows.push({ ...base, rank: 0, attentionRequired: true, reason: `Escalated: ${reason}` });
    } else if (c.type === "late_authorization") {
      const payment = repos.payments.get(c.paymentId);
      const deadline = payment?.captureDeadline;
      rows.push({
        ...base,
        rank: 1,
        attentionRequired: true,
        reason: deadline
          ? `Authorised after checkout expired. Capture before ${formatIstDateTime(deadline)} or Razorpay refunds it automatically.`
          : "Authorised after checkout expired and not yet captured.",
        ...(deadline ? { deadline } : {}),
      });
    } else if (c.type === "duplicate_payment") {
      rows.push({
        ...base,
        rank: 2,
        attentionRequired: true,
        reason: `Customer charged twice (${formatINR(c.amountAtRisk + c.refundExposure)}) with no access. Grant access once, then decide on the ${formatINR(c.refundExposure)} second charge.`,
      });
    } else if (group === "high_value") {
      rows.push({ ...base, rank: 3, attentionRequired: true, reason: `${formatINR(c.amountAtRisk)} is above the ${formatINR(limit)} automatic limit. Needs individual approval.` });
    } else if (c.type === "inventory_conflict") {
      rows.push({ ...base, rank: 4, attentionRequired: true, reason: "Inventory changed after payment. Automatic fulfilment is blocked; a person must choose the next step." });
    } else if (verdict?.result === "blocked" && group === "blocked") {
      const failed = verdict.checks.filter((check) => check.status !== "passed" && check.enforcement === "hard").map((check) => check.explanation);
      rows.push({ ...base, rank: 4, attentionRequired: true, reason: `Recovery blocked by policy. ${failed.join(" ")}` });
    } else if (verdict?.result === "allowed") {
      const label = actionLabel(c.recommendation!.action, contract);
      rows.push({ ...base, rank: 4, attentionRequired: true, reason: `${label} is allowed by policy and runs automatically; review the case if you want to act differently.` });
    } else {
      const failed = verdict?.checks.filter((check) => check.status !== "passed" && check.enforcement === "review").map((check) => check.explanation) ?? [];
      rows.push({ ...base, rank: 4, attentionRequired: true, reason: `Needs individual approval.${failed.length > 0 ? ` ${failed.join(" ")}` : ""}` });
    }
  }
  return rows
    .sort((a, b) => a.rank - b.rank || a.caseId.localeCompare(b.caseId))
    .map((row): AttentionRow => {
      const { rank, ...rest } = row;
      void rank;
      return rest;
    });
}

export type ActivityCategory = "Outcome verified" | "Case resolved" | "Policy changed" | "Action blocked" | "Incident created";

export type ActivityEntry = {
  id: string;
  occurredAt: string;
  category: ActivityCategory;
  summary: string;
  count: number;
  caseIds: string[];
  incidentId?: string;
};

function categorise(event: AuditEvent): ActivityCategory | undefined {
  if (event.action === "Verified outcome") return "Outcome verified";
  if (event.action === "Resolved case" || event.action === "Closed case") return "Case resolved";
  if (event.targetType === "policy" || event.targetType === "contract") return "Policy changed";
  if (event.action === "Created incident") return "Incident created";
  if (event.action === "Stopped execution" || (event.action === "Evaluated policy" && event.policyResult === "blocked")) return "Action blocked";
  return undefined;
}

/**
 * Recent integrity activity from the audit log. Entries of the same category
 * for the same incident within 30 minutes are combined, so a burst of 38
 * verifications reads as one line.
 */
export function recentActivity(repos: Repositories, asOf: string, limit = 8): ActivityEntry[] {
  const events = repos.audit
    .list()
    .filter((e) => e.occurredAt <= asOf)
    .map((e) => ({ event: e, category: categorise(e) }))
    .filter((x): x is { event: AuditEvent; category: ActivityCategory } => x.category !== undefined)
    .sort((a, b) => b.event.occurredAt.localeCompare(a.event.occurredAt));
  const entries: ActivityEntry[] = [];
  const BURST_MS = 30 * 60 * 1000;
  const groupable = (category: ActivityCategory) =>
    category === "Outcome verified" || category === "Case resolved" || category === "Action blocked";
  for (const { event, category } of events) {
    // Events are newest first; a burst joins the entry it started within 30 minutes of.
    const burst = groupable(category)
      ? entries.find(
          (e) => e.category === category && e.incidentId === event.incidentId && Date.parse(e.occurredAt) - Date.parse(event.occurredAt) < BURST_MS,
        )
      : undefined;
    if (burst) {
      burst.count += 1;
      if (event.caseId) burst.caseIds.push(event.caseId);
      burst.summary = burstSummary(category, burst.count, event);
      continue;
    }
    if (entries.length >= limit) break;
    entries.push({
      id: event.id,
      occurredAt: event.occurredAt,
      category,
      summary: burstSummary(category, 1, event),
      count: 1,
      caseIds: event.caseId ? [event.caseId] : [],
      ...(event.incidentId ? { incidentId: event.incidentId } : {}),
    });
  }
  return entries;
}

function burstSummary(category: ActivityCategory, count: number, event: AuditEvent): string {
  const subject = count === 1 ? `Case ${event.caseId ?? event.targetId}` : `${count} cases`;
  switch (category) {
    case "Outcome verified":
      return `${subject}: ${event.result}`;
    case "Case resolved":
      return `${subject} resolved: ${event.result}`;
    case "Action blocked":
      return `${subject}: ${event.result.replace(/^Blocked:\s*/, "")}`;
    case "Incident created":
      return `${event.targetId}: ${event.result}`;
    case "Policy changed":
      return event.result;
  }
}

export function overviewModel(repos: Repositories, asOf: string) {
  const performance = dailyPerformance(repos, asOf);
  const latest = performance.at(-1);
  const wrong = wrongActionRate(repos, asOf);
  const value = valueDelivered(repos, asOf);
  const metrics = primaryMetrics(repos, asOf);
  return {
    lastRefresh: lastDataRefresh(repos, asOf),
    agent: agentStatus(repos, asOf),
    automation: automationStatus(repos, asOf),
    metrics,
    incidents: activeIncidentRows(repos, asOf),
    attention: attentionRows(repos, asOf),
    activity: recentActivity(repos, asOf),
    value,
    performance: {
      daily: performance,
      latestCompletionRate: latest?.completionRate ?? null,
      medianCompletionSeconds: latest?.medianCompletionSeconds ?? null,
      resolvedBeforeContact: metrics.resolvedBeforeContact,
      avoidableRefunds: value.avoidableRefundsPrevented,
      wrongActionRate: wrong,
    },
  };
}

export type OverviewModel = ReturnType<typeof overviewModel>;
