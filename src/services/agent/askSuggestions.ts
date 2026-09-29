import type { Repositories } from "@/repositories";
import { buildIncidentInvestigationInput } from "@/services/investigation";
import { groupIncidentCases } from "@/services/recovery/groups";

/** Questions offered on the incident, worded from its current state. */
export function suggestedQuestions(repos: Repositories, incidentId: string, asOf: string): string[] {
  const groups = groupIncidentCases(repos, incidentId, asOf);
  const held = groups.filter((g) => g.id !== "safe").reduce((n, g) => n + g.caseIds.length, 0);
  const deploy = buildIncidentInvestigationInput(repos, incidentId).evidence.filter((e) => e.type === "deploy.completed").at(-1);
  const version = typeof deploy?.detail?.["version"] === "string" ? deploy.detail["version"] : undefined;
  return [
    ...(held > 0 ? [`Why are ${held} ${held === 1 ? "case" : "cases"} held?`] : []),
    ...(deploy ? [version ? `What changed after deployment ${version}?` : "What changed after the deployment?"] : []),
    ...(groups.some((g) => g.id === "safe") ? ["What would happen if I approve this batch?"] : []),
  ];
}
