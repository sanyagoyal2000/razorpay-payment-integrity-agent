import type { AuditEvent } from "@/domain/types";
import { ACTORS } from "@/domain/types";
import { istDate } from "@/domain/time";
import type { Repositories } from "@/repositories";

export type AuditCategory = "Detection" | "Recommendation" | "Policy" | "Decision" | "Execution" | "Verification" | "Configuration";
export type AuditOutcome = "verified" | "blocked" | "rejected" | "escalated" | "recorded";

export const AUDIT_CATEGORIES: AuditCategory[] = ["Detection", "Recommendation", "Policy", "Decision", "Execution", "Verification", "Configuration"];
export const AUDIT_OUTCOMES: Array<{ value: AuditOutcome; label: string }> = [
  { value: "verified", label: "Outcome verified or resolved" },
  { value: "blocked", label: "Blocked or stopped" },
  { value: "rejected", label: "Rejected" },
  { value: "escalated", label: "Escalated" },
  { value: "recorded", label: "Recorded" },
];
export const AUDIT_ACTORS = [ACTORS.operator, ACTORS.agent, ACTORS.policy, ACTORS.connector];

export function auditCategory(e: AuditEvent): AuditCategory {
  if (e.targetType === "policy" || e.targetType === "contract" || e.targetType === "integration") return "Configuration";
  if (["Verified outcome", "Resolved case", "Closed case"].includes(e.action)) return "Verification";
  if (e.action === "Recommended action") return "Recommendation";
  if (e.actor === ACTORS.policy) return "Policy";
  if (e.actor === ACTORS.connector) return "Execution";
  if (e.actor === ACTORS.operator) return "Decision";
  if (["Opened case", "Started observing payment", "Created incident", "Changed incident status", "Resolved incident"].includes(e.action)) return "Detection";
  if (e.action === "Escalated case") return "Decision";
  return "Detection";
}

export function auditOutcome(e: AuditEvent): AuditOutcome {
  if (["Verified outcome", "Resolved case", "Closed case", "Resolved incident"].includes(e.action)) return "verified";
  if (e.policyResult === "blocked" || e.action === "Stopped execution") return "blocked";
  if (e.action === "Rejected recommendation") return "rejected";
  if (e.action.startsWith("Escalated")) return "escalated";
  return "recorded";
}

export type AuditRow = AuditEvent & { category: AuditCategory; outcome: AuditOutcome };

export type AuditFilters = {
  actors: string[];
  categories: AuditCategory[];
  outcomes: AuditOutcome[];
  caseQuery: string;
  incidentIds: string[];
  from?: string;
  to?: string;
};

export const DEFAULT_AUDIT_FILTERS: AuditFilters = { actors: [], categories: [], outcomes: [], caseQuery: "", incidentIds: [] };

/** Audit rows, newest first. Read-only: the log is append-only in the repository. */
export function auditRows(repos: Repositories, asOf: string): AuditRow[] {
  return repos.audit
    .list()
    .filter((e) => e.occurredAt <= asOf)
    .map((e) => ({ ...e, category: auditCategory(e), outcome: auditOutcome(e) }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
}

export function filterAudit(rows: readonly AuditRow[], f: AuditFilters): AuditRow[] {
  const q = f.caseQuery.trim().toUpperCase();
  return rows.filter((r) => {
    if (f.actors.length > 0 && !f.actors.includes(r.actor)) return false;
    if (f.categories.length > 0 && !f.categories.includes(r.category)) return false;
    if (f.outcomes.length > 0 && !f.outcomes.includes(r.outcome)) return false;
    if (q && !(r.caseId ?? "").toUpperCase().includes(q) && !r.targetId.toUpperCase().includes(q)) return false;
    if (f.incidentIds.length > 0 && !f.incidentIds.includes(r.incidentId ?? "")) return false;
    const day = istDate(r.occurredAt);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
}

export function describeAuditFilters(f: AuditFilters): string[] {
  const parts: string[] = [];
  if (f.actors.length) parts.push(`Actor: ${f.actors.join(", ")}`);
  if (f.categories.length) parts.push(`Action type: ${f.categories.join(", ")}`);
  if (f.outcomes.length) parts.push(`Outcome: ${f.outcomes.map((o) => AUDIT_OUTCOMES.find((x) => x.value === o)!.label).join(", ")}`);
  if (f.caseQuery.trim()) parts.push(`Case "${f.caseQuery.trim()}"`);
  if (f.incidentIds.length) parts.push(`Incident: ${f.incidentIds.join(", ")}`);
  if (f.from || f.to) parts.push(`Date ${f.from ?? "any time"} to ${f.to ?? "today"}`);
  return parts;
}

export const APPROVAL_SOURCE_LABELS: Record<NonNullable<AuditEvent["approvalSource"]>, string> = {
  merchant: "Merchant",
  policy_automatic: "Policy (automatic)",
  not_required: "Not required",
};

export const AUDIT_DETAIL_LABELS: Record<keyof NonNullable<AuditEvent["detail"]>, string> = {
  invocationId: "Invocation",
  trigger: "Trigger",
  agentVersion: "Agent version",
  policyVersion: "Policy version",
  sources: "Sources accessed",
  producedBy: "Produced by",
  inputFingerprint: "Input fingerprint",
  outputFingerprint: "Output fingerprint",
  idempotencyKey: "Idempotency key",
  state: "Execution state",
  failure: "Failure",
};

/**
 * Machine-readable export of audit entries: the stored events exactly as
 * recorded, plus their derived category and outcome. Contains no customer
 * contact details, because audit events never store them.
 */
export function auditExport(rows: readonly AuditRow[], exportedAt: string) {
  return { format: "payment-integrity.audit.v1", exportedAt, count: rows.length, events: rows };
}
