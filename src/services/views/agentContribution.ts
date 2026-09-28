import type { IncidentRecord } from "@/domain/types";
import { formatINR } from "@/domain/money";
import { formatDuration } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { describeIncidentInvestigation } from "@/services/agent";
import { incidentTotals } from "@/services/metrics/cases";
import { requireContract } from "@/services/policy/currentState";
import { groupIncidentCases, type RecoveryGroupId } from "@/services/recovery/groups";
import { hypothesisCounts } from "./investigation";

export type AgentContributionState = "valid" | "no_safe" | "resolved" | "not_investigated" | "failed";

export type ContributionMetric = {
  id: "detected" | "examined" | "causes" | "safe" | "held" | "recovered";
  label: string;
  value: number;
  detail: string;
  caseIds?: string[];
};

export type AgentContribution = {
  state: AgentContributionState;
  comparison: { fixedRule: string; agent: string };
  metrics: ContributionMetric[];
  /** Shown only when a valid investigation separated safe recovery from risky cases. */
  conclusion?: string;
  /** Shown instead of any AI success when no usable investigation exists. */
  notice?: string;
  howCalculated: string[];
};

export const WITHOUT_INVESTIGATION = "Without the investigation, the affected cases would require manual log inspection or blanket escalation.";
export const NO_USABLE_INVESTIGATION =
  "Rules still detected the affected payments, but no usable automated root-cause analysis was available. The cases were escalated for manual review.";

export const HOW_CALCULATED = [
  "The rule detects a payment whose Outcome Contract deadline passed without the promised outcome.",
  "Event and source totals come from the investigation run: the recorded events supplied to the investigator.",
  "Cause counts come from the causes the investigation evaluated, by verdict.",
  "Safe and held cases come from the current policy evaluation of each open case.",
  "The agent does not authorise or execute any action. Policy and you decide what runs.",
];

const HELD_REASONS: Record<Exclude<RecoveryGroupId, "safe">, (n: number) => string> = {
  duplicate_review: (n) => `${n} duplicate ${n === 1 ? "payment" : "payments"}`,
  high_value: (n) => `${n} above the value limit`,
  individual_review: (n) => `${n} with open questions`,
  blocked: (n) => `${n} blocked by policy`,
};

const cases = (n: number) => (n === 1 ? "case" : "cases");

/**
 * What the fixed rule found and what the investigation added, derived from
 * the incident's cases, its investigation run and hypotheses, and the current
 * policy evaluation of its open cases.
 */
export function agentContribution(repos: Repositories, incident: IncidentRecord, asOf: string): AgentContribution {
  const totals = incidentTotals(incident, repos.cases.list());
  const contract = requireContract(repos, incident.outcomeContractId);
  const detected: ContributionMetric = {
    id: "detected",
    label: "Rule detected",
    value: totals.caseCount,
    detail: `payments missing ${contract.expectedOutcome} within ${formatDuration(contract.deadlineSeconds)}`,
  };
  const fixedRule = `Detected that ${totals.caseCount} payments missed their promised outcome.`;
  const groups = groupIncidentCases(repos, incident.id, asOf);
  const heldGroups = groups.filter((g): g is typeof g & { id: Exclude<RecoveryGroupId, "safe"> } => g.id !== "safe");
  const held = heldGroups.reduce((n, g) => n + g.caseIds.length, 0);
  const heldMetric: ContributionMetric = {
    id: "held",
    label: "Held for review",
    value: held,
    detail: held === 0 ? "cases need individual review" : heldGroups.map((g) => HELD_REASONS[g.id](g.caseIds.length)).join(", "),
    caseIds: heldGroups.flatMap((g) => g.caseIds),
  };

  const runStatus = incident.investigationRun?.status ?? (incident.investigation ? "valid" : undefined);
  if (!incident.investigation || runStatus !== "valid") {
    const failed = runStatus !== undefined || !repos.config.flags().investigationAvailable;
    const metrics = totals.openCaseIds.length > 0 ? [detected, { ...heldMetric, value: totals.openCaseIds.length, detail: "open cases for manual review", caseIds: totals.openCaseIds }] : [detected];
    return failed
      ? {
          state: "failed",
          comparison: { fixedRule, agent: "No usable root-cause analysis was available." },
          metrics,
          notice: NO_USABLE_INVESTIGATION,
          howCalculated: HOW_CALCULATED,
        }
      : {
          state: "not_investigated",
          comparison: { fixedRule, agent: "Investigation has not produced validated findings yet." },
          metrics,
          notice: "The agent has not finished investigating this incident. Only the detected symptoms are shown until its findings are validated.",
          howCalculated: HOW_CALCULATED,
        };
  }

  const run = describeIncidentInvestigation(repos, incident.id, asOf);
  const sourceCount = run ? Object.keys(run.sources).length : 0;
  const counts = hypothesisCounts(incident.investigation);
  const evaluated = counts.supported + counts.ruled_out + counts.inconclusive;
  const examined: ContributionMetric = {
    id: "examined",
    label: "Agent examined",
    value: run?.eventsExamined ?? 0,
    detail: sourceCount > 0 ? `events across ${sourceCount} connected ${sourceCount === 1 ? "source" : "sources"}` : "events; source breakdown not recorded",
  };
  const causes: ContributionMetric = {
    id: "causes",
    label: "Causes evaluated",
    value: evaluated,
    detail: evaluated === 0 ? "no alternative causes recorded" : `${counts.supported} supported, ${counts.ruled_out} ruled out, ${counts.inconclusive} inconclusive`,
  };

  if (totals.openCaseIds.length === 0) {
    const verified = totals.resolvedCaseIds.filter((id) => repos.cases.get(id)?.resolution?.receiptId).length;
    return {
      state: "resolved",
      comparison: { fixedRule, agent: "Diagnosed the likely cause and identified which cases could be recovered safely." },
      metrics: [
        detected,
        examined,
        causes,
        { id: "recovered", label: "Recovered", value: totals.resolvedCaseIds.length, detail: `${cases(totals.resolvedCaseIds.length)} resolved; ${verified} with a verified outcome`, caseIds: totals.resolvedCaseIds },
      ],
      howCalculated: HOW_CALCULATED,
    };
  }

  const safeGroup = groups.find((g) => g.id === "safe");
  const safe: ContributionMetric = {
    id: "safe",
    label: "Safe recovery identified",
    value: safeGroup?.caseIds.length ?? 0,
    detail: safeGroup ? `${cases(safeGroup.caseIds.length)} worth ${formatINR(safeGroup.value)}` : "no case is eligible for bulk recovery",
    caseIds: safeGroup?.caseIds ?? [],
  };
  const metrics = [detected, examined, causes, safe, heldMetric];
  if (!safeGroup) {
    return {
      state: "no_safe",
      comparison: { fixedRule, agent: `Diagnosed the likely cause. No case is safe to recover in bulk, so all ${held} need individual review.` },
      metrics,
      howCalculated: HOW_CALCULATED,
    };
  }
  return {
    state: "valid",
    comparison: {
      fixedRule,
      agent: `Diagnosed the likely cause and separated ${safeGroup.caseIds.length} safe ${safeGroup.caseIds.length === 1 ? "recovery" : "recoveries"} from ${held} risky ${cases(held)}.`,
    },
    metrics,
    ...(counts.supported > 0 ? { conclusion: WITHOUT_INVESTIGATION } : {}),
    howCalculated: HOW_CALCULATED,
  };
}
