import type { IncidentRecord, IncidentStatus, Severity } from "@/domain/types";
import { formatINR, sum } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { describeIncidentInvestigation } from "@/services/agent";
import { healthResult } from "@/services/agent/progress";
import { agentLifecycle, type Lifecycle } from "@/services/lifecycle";
import { statusLabel } from "@/services/incidents";
import { incidentTotals, isAtRisk } from "@/services/metrics/cases";
import { serviceLabel } from "@/services/policy/actions";
import { groupIncidentCases } from "@/services/recovery/groups";
import { lastDataRefresh, requiredDecision } from "./overview";
import { systemicBlocker, systemStatus, type StatusNotice } from "./systemStatus";

export type BriefingState = "action" | "investigating" | "service_unhealthy" | "blocked" | "investigator_unavailable" | "clear";

/** Where a briefing action leads. The UI turns it into a link; nothing executes from the briefing. */
export type BriefingTarget =
  | { kind: "incident"; incidentId: string; section?: "recovery" | "investigation" }
  | { kind: "incidents"; filter?: "resolved" };

export type BriefingAction = { label: string; target: BriefingTarget };

export type FeaturedIncident = {
  id: string;
  title: string;
  status: IncidentStatus;
  statusLabel: string;
  service: { label: string; healthy: boolean };
  requiredDecision: string;
  revenueAtRisk: number;
  customers: number;
  caseCount: number;
  likelyCause?: string;
  safe: { count: number; value: number; caseIds: string[] };
  held: number;
};

export type ProactiveBriefingModel = {
  state: BriefingState;
  eyebrow: string;
  heading: string;
  body: string;
  incidentCount: number;
  totalAtRisk: number;
  totalCustomers: number;
  featured?: FeaturedIncident;
  primaryAction?: BriefingAction;
  secondaryActions: BriefingAction[];
  lastRefresh: string;
  lastInvestigatedAt?: string;
  /** Supporting context: the agent's current lifecycle state. */
  lifecycle: Lifecycle;
};

const BLOCKER_PRECEDENCE: StatusNotice["id"][] = ["policy_service", "stale", "outcome_verification", "automation_paused"];

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export type IncidentPriority = {
  incidentId: string;
  /** Earliest capture deadline among the incident's authorised, uncaptured payments. */
  deadline?: string;
  severityRank: number;
  revenueAtRisk: number;
  customers: number;
  startedAt: string;
};

export function incidentPriority(repos: Repositories, incident: IncidentRecord): IncidentPriority {
  const totals = incidentTotals(incident, repos.cases.list());
  const deadlines = totals.openCaseIds
    .map((id) => repos.cases.get(id))
    .map((c) => (c ? repos.payments.get(c.paymentId) : undefined))
    .filter((p) => p?.status === "authorized" && p.captureDeadline)
    .map((p) => p!.captureDeadline!)
    .sort();
  return {
    incidentId: incident.id,
    ...(deadlines[0] ? { deadline: deadlines[0] } : {}),
    severityRank: SEVERITY_RANK[incident.severity],
    revenueAtRisk: totals.remainingAtRisk,
    customers: totals.customersAtRisk,
    startedAt: incident.startedAt,
  };
}

/**
 * Deterministic priority, highest first:
 * 1. an earlier capture deadline (incidents with one come first),
 * 2. higher severity,
 * 3. more revenue at risk,
 * 4. more affected customers,
 * 5. older incident,
 * then incident ID so the order is always total.
 */
export function compareIncidentPriority(a: IncidentPriority, b: IncidentPriority): number {
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  }
  return (
    a.severityRank - b.severityRank ||
    b.revenueAtRisk - a.revenueAtRisk ||
    b.customers - a.customers ||
    a.startedAt.localeCompare(b.startedAt) ||
    a.incidentId.localeCompare(b.incidentId)
  );
}

export function rankActiveIncidents(repos: Repositories): IncidentRecord[] {
  const active = repos.incidents.list().filter((i) => i.status !== "resolved");
  const priorities = new Map(active.map((i) => [i.id, incidentPriority(repos, i)]));
  return active.sort((a, b) => compareIncidentPriority(priorities.get(a.id)!, priorities.get(b.id)!));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

function featuredIncident(repos: Repositories, incident: IncidentRecord, asOf: string): FeaturedIncident {
  const totals = incidentTotals(incident, repos.cases.list());
  const groups = groupIncidentCases(repos, incident.id, asOf);
  const safe = groups.find((g) => g.id === "safe");
  const health = healthResult(repos, incident.affectedService, asOf);
  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    statusLabel: statusLabel(incident.status),
    service: { label: `${serviceLabel(incident.affectedService)} ${health.status === "healthy" ? "healthy" : "failing"}`, healthy: health.status === "healthy" },
    requiredDecision: requiredDecision(repos, incident, asOf),
    revenueAtRisk: totals.remainingAtRisk,
    customers: totals.customersAtRisk,
    caseCount: totals.openCaseIds.length,
    ...(incident.investigation ? { likelyCause: incident.likelyCause ?? incident.investigation.likelyCause } : {}),
    safe: { count: safe?.caseIds.length ?? 0, value: safe?.value ?? 0, caseIds: safe?.caseIds ?? [] },
    held: groups.filter((g) => g.id !== "safe").reduce((n, g) => n + g.caseIds.length, 0),
  };
}

/** Whether the incident has findings that passed validation. */
function hasValidInvestigation(repos: Repositories, incident: IncidentRecord): boolean {
  if (!incident.investigation) return false;
  return (incident.investigationRun?.status ?? "valid") === "valid";
}

/**
 * "What needs my attention today?" Built only from repositories and current
 * state: active incidents and their totals, validated findings, service
 * health, recovery groups under current policy, system blockers and freshness.
 */
export function proactiveBriefing(repos: Repositories, asOf: string): ProactiveBriefingModel {
  const lastRefresh = lastDataRefresh(repos, asOf);
  const ranked = rankActiveIncidents(repos);
  const activeIds = new Set(ranked.map((i) => i.id));
  const atRisk = repos.cases.list().filter((c) => c.incidentId !== undefined && activeIds.has(c.incidentId) && isAtRisk(c));
  const totalAtRisk = sum(atRisk.map((c) => c.amountAtRisk));
  const totalCustomers = new Set(atRisk.map((c) => c.customerId)).size;
  const base = { incidentCount: ranked.length, totalAtRisk, totalCustomers, lastRefresh, lifecycle: agentLifecycle(repos, asOf) };

  const top = ranked[0];
  if (!top) {
    return {
      ...base,
      state: "clear",
      eyebrow: "Monitoring",
      heading: "No payment integrity incidents require action",
      body: "Payment Integrity continues to check payments against their Outcome Contracts.",
      secondaryActions: [{ label: "View resolved incidents", target: { kind: "incidents", filter: "resolved" } }],
    };
  }

  const featured = featuredIncident(repos, top, asOf);
  const run = describeIncidentInvestigation(repos, top.id, asOf);
  const withRun = { ...base, featured, ...(run ? { lastInvestigatedAt: run.at } : {}) };
  const multiple = ranked.length > 1;
  const exposure = `${formatINR(featured.revenueAtRisk)} across ${plural(featured.customers, "customer", "customers")} is at risk.`;
  const totalExposure = `${formatINR(totalAtRisk)} across ${plural(totalCustomers, "customer", "customers")} is at risk in ${ranked.length} incidents. Highest priority: ${top.title}.`;
  const view: BriefingAction = { label: "View incident", target: { kind: "incident", incidentId: top.id } };
  const allIncidents: BriefingAction[] = multiple ? [{ label: "View all incidents", target: { kind: "incidents" } }] : [];
  const countHeading = (what: string) =>
    multiple ? `Payment Integrity found ${ranked.length} incidents ${what}` : `Payment Integrity found one incident ${what}`;

  const blocker = systemicBlocker(repos, asOf);
  if (blocker) {
    // Same precedence as systemicBlocker.
    const notices = systemStatus(repos, asOf);
    const notice = BLOCKER_PRECEDENCE.map((id) => notices.find((n) => n.id === id)).find((n) => n !== undefined)!;
    return {
      ...withRun,
      state: "blocked",
      eyebrow: "Needs your attention",
      heading: notice.title,
      body: `${notice.description} ${plural(ranked.length, "incident", "incidents")} with ${formatINR(totalAtRisk)} at risk ${ranked.length === 1 ? "is" : "are"} waiting.`,
      secondaryActions: [view, ...allIncidents],
    };
  }

  if (!hasValidInvestigation(repos, top)) {
    const unavailable = !repos.config.flags().investigationAvailable || (top.investigationRun && top.investigationRun.status !== "valid");
    if (unavailable) {
      return {
        ...withRun,
        state: "investigator_unavailable",
        eyebrow: "Needs your attention",
        heading: `Rules detected ${plural(featured.caseCount, "payment", "payments")} with missing outcomes`,
        body: `Automated root-cause investigation is unavailable, so the incident requires manual review. ${multiple ? totalExposure : exposure}`,
        primaryAction: view,
        secondaryActions: allIncidents,
      };
    }
    return {
      ...withRun,
      state: "investigating",
      eyebrow: "Needs your attention",
      heading: `Payment Integrity is investigating ${plural(featured.caseCount, "successful payment", "successful payments")} with missing outcomes`,
      body: `${multiple ? totalExposure : exposure} The cause is not confirmed yet; recovery options appear once the investigation is validated.`,
      primaryAction: view,
      secondaryActions: allIncidents,
    };
  }

  const cause = featured.likelyCause ? ` Likely cause: ${sentence(featured.likelyCause)}` : "";
  if (!featured.service.healthy) {
    const service = serviceLabel(top.affectedService);
    return {
      ...withRun,
      state: "service_unhealthy",
      eyebrow: "Needs your attention",
      heading: countHeading("needing attention"),
      body: `The ${service.toLowerCase()} is still failing. Recovery is blocked until the service becomes healthy. ${multiple ? totalExposure : exposure}${cause}`,
      primaryAction: view,
      secondaryActions: [{ label: "View investigation", target: { kind: "incident", incidentId: top.id, section: "investigation" } }, ...allIncidents],
    };
  }

  const recovered = healthResult(repos, top.affectedService, asOf).since !== undefined;
  const service = `${serviceLabel(top.affectedService)} ${recovered ? "has recovered" : "is healthy"}`;
  const split =
    featured.safe.count > 0
      ? `${service}, and ${plural(featured.safe.count, "case", "cases")} worth ${formatINR(featured.safe.value)} ${featured.safe.count === 1 ? "is" : "are"} eligible for safe recovery.${featured.held > 0 ? ` ${plural(featured.held, "case needs", "cases need")} individual review.` : ""}`
      : `${service}. No cases are eligible for bulk recovery; ${plural(featured.held, "case needs", "cases need")} individual review.`;
  const primary: BriefingAction =
    featured.safe.count > 0
      ? { label: `Review ${plural(featured.safe.count, "recovery", "recoveries")}`, target: { kind: "incident", incidentId: top.id, section: "recovery" } }
      : featured.held > 0
        ? { label: `Review ${plural(featured.held, "case", "cases")}`, target: { kind: "incident", incidentId: top.id, section: "recovery" } }
        : view;
  return {
    ...withRun,
    state: "action",
    eyebrow: "Needs your attention",
    heading: countHeading("requiring a decision"),
    body: `${multiple ? totalExposure : exposure}${cause} ${split}`,
    primaryAction: primary,
    secondaryActions: [{ label: "View investigation", target: { kind: "incident", incidentId: top.id, section: "investigation" } }, ...allIncidents],
  };
}
