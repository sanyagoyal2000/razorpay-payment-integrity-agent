import type { InvestigationAdapter } from "@/services/investigation";

/**
 * Deterministic investigator backed by fixture responses. Returns the stored
 * response for a case or incident, and fails like an unreachable API when none
 * exists, so callers exercise the same fallback path as a live adapter.
 */
export function createFixtureInvestigationAdapter(
  lookup: (id: string) => unknown,
  isAvailable: () => boolean = () => true,
): InvestigationAdapter {
  const respond = async (id: string): Promise<unknown> => {
    if (!isAvailable()) throw new Error("Investigation service unavailable");
    const response = lookup(id);
    if (response === undefined) throw new Error(`No investigation available for ${id}`);
    return structuredClone(response);
  };
  return {
    investigateCase: (input) => respond(input.caseId),
    investigateIncident: (input) => respond(input.incidentId),
  };
}
