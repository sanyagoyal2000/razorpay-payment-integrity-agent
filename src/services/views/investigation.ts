import type { Hypothesis, Investigation, InvestigationRun } from "@/domain/types";
import type { Repositories } from "@/repositories";
import { resolveEvidence } from "./evidence";

export type HypothesisView = Hypothesis & { evidence: Array<{ id: string; title: string }> };

export type InvestigationView = {
  summary: string;
  likelyCause: string;
  confidence: number;
  uncertainties: string[];
  hypotheses: HypothesisView[];
  run?: InvestigationRun;
};

const VERDICT_ORDER: Record<Hypothesis["verdict"], number> = { supported: 0, inconclusive: 1, ruled_out: 2 };

/** Investigation findings with each cited ID resolved to the event it names. */
export function investigationView(repos: Repositories, investigation: Investigation | undefined, run: InvestigationRun | undefined): InvestigationView | undefined {
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
    ...(run ? { run } : {}),
  };
}
