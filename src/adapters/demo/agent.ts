import type { AgentGateway } from "@/services/agent/contracts";
import { askByRule, draftContractByRule, draftMessageByRule, explainAutonomyByRule } from "@/services/agent/rules";
import { createFixtureInvestigationAdapter } from "./investigation";

/**
 * Deterministic agent used when no live model is configured. Investigations
 * come from fixture responses; drafts and explanations are built from rules
 * over the same inputs the live model receives.
 */
export function createDemoAgentGateway(lookup: (id: string) => unknown, isAvailable: () => boolean = () => true): AgentGateway {
  const investigator = createFixtureInvestigationAdapter(lookup, isAvailable);
  return {
    investigateCase: (input) => investigator.investigateCase(input),
    investigateIncident: (input) => investigator.investigateIncident(input),
    draftMessage: async (input) => draftMessageByRule(input),
    draftContract: async (input) => draftContractByRule(input),
    explainAutonomy: async (input) => explainAutonomyByRule(input),
    askIncident: async (input) => askByRule(input),
    describe: async () => "Deterministic fixtures (offline)",
  };
}
