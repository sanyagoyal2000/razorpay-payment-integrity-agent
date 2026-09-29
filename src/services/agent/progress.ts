import type { InvestigationRun, InvestigationStage, InvestigationStepId, OutcomeContract } from "@/domain/types";
import { formatDuration, formatIstShort, istDate, istTime } from "@/domain/time";
import type { Repositories } from "@/repositories";
import type { EvidenceItem, InvestigationResult } from "@/services/investigation";
import { serviceLabel } from "@/services/policy/actions";
import { serviceHealth } from "@/services/policy/currentState";

/**
 * Merchant-safe investigation stages. Every stage reports an operation that
 * ran and its observable result (counts, health, validation). None of them
 * exposes model reasoning, prompts or intermediate output.
 */
export const STAGE_ORDER: InvestigationStepId[] = ["gathering", "comparing", "checking_health", "validating", "preparing"];

export function stageTitle(step: InvestigationStepId, subject: "case" | "incident"): string {
  switch (step) {
    case "gathering":
      return "Gather evidence";
    case "comparing":
      return subject === "incident" ? "Compare affected cases" : "Compare with the Outcome Contract";
    case "checking_health":
      return "Check current service state";
    case "validating":
      return "Validate evidence";
    case "preparing":
      return "Prepare recommendation";
  }
}

export const SOURCE_LABELS: Record<EvidenceItem["source"], string> = {
  razorpay: "Razorpay",
  merchant: "Marrow",
  platform_monitoring: "Platform Monitoring",
  payment_integrity: "Payment Integrity",
};

export function countSources(evidence: readonly EvidenceItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of evidence) counts[SOURCE_LABELS[item.source]] = (counts[SOURCE_LABELS[item.source]] ?? 0) + 1;
  return counts;
}

function evidenceKind(item: EvidenceItem): string {
  if (item.source === "razorpay") return item.type.startsWith("webhook.") ? "webhook" : "payment";
  if (item.source === "merchant") return "merchant";
  if (item.source === "platform_monitoring") return "observability";
  return "outcome receipt";
}

const KIND_ORDER = ["payment", "webhook", "merchant", "observability", "outcome receipt"];

export function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function gatherStage(evidence: readonly EvidenceItem[]): InvestigationStage {
  const kinds = KIND_ORDER.filter((kind) => evidence.some((item) => evidenceKind(item) === kind));
  const sources = Object.keys(countSources(evidence)).length;
  return {
    step: "gathering",
    status: "complete",
    detail: `Collected ${evidence.length} ${listPhrase(kinds)} events from ${sources} ${sources === 1 ? "source" : "sources"}.`,
  };
}

export function compareStage(
  status: InvestigationResult["status"],
  subject: { kind: "incident"; caseCount: number } | { kind: "case"; contract: Pick<OutcomeContract, "name" | "expectedOutcome" | "deadlineSeconds"> },
): InvestigationStage {
  if (status === "unavailable") return { step: "comparing", status: "failed", detail: "Investigator unavailable; no automated comparison was made." };
  if (status === "invalid") return { step: "comparing", status: "failed", detail: "The investigator's output could not be used." };
  return {
    step: "comparing",
    status: "complete",
    detail:
      subject.kind === "incident"
        ? `Compared ${subject.caseCount} cases for shared timing, service and outcome patterns.`
        : `Compared the payment's events with the ${subject.contract.name} contract (${subject.contract.expectedOutcome} within ${formatDuration(subject.contract.deadlineSeconds)}).`,
  };
}

export function healthResult(repos: Repositories, service: string, asOf: string): NonNullable<InvestigationRun["serviceHealth"]> {
  const status = serviceHealth(repos, service, asOf);
  const latest = repos.outcomes
    .observability(service)
    .filter((e) => e.type !== "deploy.completed" && e.occurredAt <= asOf)
    .at(-1);
  return { service, status, ...(latest ? { since: latest.occurredAt } : {}) };
}

export function healthStage(health: NonNullable<InvestigationRun["serviceHealth"]>, asOf: string): InvestigationStage {
  const label = serviceLabel(health.service);
  const when = health.since ? (istDate(health.since) === istDate(asOf) ? istTime(health.since).slice(0, 5) : formatIstShort(health.since, asOf)) : undefined;
  const detail =
    health.status === "down"
      ? `${label} still failing${when ? ` since ${when} IST` : ""}.`
      : when
        ? `${label} recovered at ${when} IST.`
        : `${label} healthy; no errors recorded.`;
  return { step: "checking_health", status: "complete", detail };
}

export function validateStage(result: InvestigationResult): InvestigationStage {
  if (result.status !== "valid") return failedValidationStage(result.status);
  return citationStage(result.citationsChecked, result.removedEvidenceIds.length);
}

export function failedValidationStage(status: "invalid" | "unavailable"): InvestigationStage {
  return status === "unavailable"
    ? { step: "validating", status: "skipped", detail: "No output to validate." }
    : { step: "validating", status: "failed", detail: "Output failed validation and was not used." };
}

export function citationStage(checked: number, removed: number): InvestigationStage {
  return {
    step: "validating",
    status: "complete",
    detail: `Checked ${checked} ${checked === 1 ? "citation" : "citations"} against recorded events; ${removed === 0 ? "none removed" : `${removed} removed`}.`,
  };
}

export const ESCALATION_PREPARED = "Escalation prepared for manual review.";

/** Final stage after a failed run: never reported as a prepared recommendation. */
export function failedPreparingStage(detail = ESCALATION_PREPARED): InvestigationStage {
  return { step: "preparing", status: "failed", detail };
}

export function preparingStage(detail: string): InvestigationStage {
  return { step: "preparing", status: "complete", detail };
}

export function recoverySplitDetail(safe: number, held: number): string {
  if (safe === 0 && held === 0) return "No open cases remain to recover.";
  const heldPart = `${held} ${held === 1 ? "requires" : "require"} individual review`;
  if (safe === 0) return `No cases are eligible for bulk recovery; ${heldPart}.`;
  return `${safe} ${safe === 1 ? "case is" : "cases are"} eligible for recovery; ${heldPart}.`;
}
