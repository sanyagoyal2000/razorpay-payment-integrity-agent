import type { Hypothesis, Investigation, InvestigationRun, InvestigationStage } from "@/domain/types";
import type { Repositories } from "@/repositories";
import { STAGE_ORDER, stageTitle } from "@/services/agent/progress";
import { serviceLabel } from "@/services/policy/actions";
import { resolveEvidence } from "./evidence";

export type HypothesisView = Hypothesis & { evidence: Array<{ id: string; title: string }> };

export type HypothesisCounts = Record<Hypothesis["verdict"], number>;

export type StageView = InvestigationStage & { title: string };

/** "How this investigation was produced": observable facts about the run, never model reasoning. */
export type InvestigationProduction = {
  at: string;
  result: InvestigationRun["status"];
  resultLabel: string;
  eventsExamined: number;
  sources: Array<{ label: string; count: number }>;
  casesCompared?: number;
  serviceHealth?: string;
  hypotheses: HypothesisCounts;
  citationsChecked: number;
  citationsRemoved: string[];
  stages: StageView[];
};

export type InvestigationView = {
  summary: string;
  likelyCause: string;
  confidence: number;
  uncertainties: string[];
  hypotheses: HypothesisView[];
  run?: InvestigationRun;
  production?: InvestigationProduction;
};

const VERDICT_ORDER: Record<Hypothesis["verdict"], number> = { supported: 0, inconclusive: 1, ruled_out: 2 };

export const RESULT_LABELS: Record<InvestigationRun["status"], string> = {
  valid: "Valid investigation",
  invalid: "Invalid output; deterministic escalation used instead",
  unavailable: "Investigator unavailable; deterministic escalation used instead",
};

export function hypothesisCounts(investigation: Investigation | undefined): HypothesisCounts {
  const counts: HypothesisCounts = { supported: 0, ruled_out: 0, inconclusive: 0 };
  for (const h of investigation?.hypotheses ?? []) counts[h.verdict] += 1;
  return counts;
}

export function stageViews(stages: readonly InvestigationStage[], subject: "case" | "incident"): StageView[] {
  return [...stages]
    .sort((a, b) => STAGE_ORDER.indexOf(a.step) - STAGE_ORDER.indexOf(b.step))
    .map((stage) => ({ ...stage, title: stageTitle(stage.step, subject) }));
}

function production(investigation: Investigation, run: InvestigationRun, subject: "case" | "incident"): InvestigationProduction {
  const health = run.serviceHealth;
  return {
    at: run.at,
    result: run.status,
    resultLabel: RESULT_LABELS[run.status],
    eventsExamined: run.eventsExamined,
    sources: Object.entries(run.sources).map(([label, count]) => ({ label, count })),
    ...(run.casesCompared !== undefined ? { casesCompared: run.casesCompared } : {}),
    ...(health ? { serviceHealth: `${serviceLabel(health.service)} ${health.status === "healthy" ? "healthy" : "failing"}` } : {}),
    hypotheses: hypothesisCounts(investigation),
    citationsChecked: run.citationsChecked,
    citationsRemoved: run.citationsRemoved,
    stages: stageViews(run.stages ?? [], subject),
  };
}

/** Investigation findings with each cited ID resolved to the event it names. */
export function investigationView(
  repos: Repositories,
  investigation: Investigation | undefined,
  run: InvestigationRun | undefined,
  subject: "case" | "incident" = "case",
): InvestigationView | undefined {
  if (!investigation) return undefined;
  const titled = (ids: string[]) =>
    ids.map((id) => ({ id, title: resolveEvidence(repos, id)?.title ?? (repos.cases.get(id) ? `Case ${id}` : id) }));
  return {
    summary: investigation.summary,
    likelyCause: investigation.likelyCause,
    confidence: investigation.confidence,
    uncertainties: investigation.uncertainties,
    hypotheses: [...(investigation.hypotheses ?? [])]
      .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict])
      .map((h) => ({ ...h, evidence: titled(h.evidenceIds) })),
    ...(run ? { run, production: production(investigation, run, subject) } : {}),
  };
}
