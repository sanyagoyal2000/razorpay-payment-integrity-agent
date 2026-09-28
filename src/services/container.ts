import { createDemoAgentGateway } from "@/adapters/demo/agent";
import { createLiveAgentGateway } from "@/adapters/live/agent";
import type { AgentGateway } from "@/services/agent/contracts";
import { createDemoGateway, createDemoMerchant } from "@/adapters/demo/merchant";
import type { Clock } from "@/domain/time";
import type { Dataset } from "@/fixtures/dataset-types";
import { createRepositories, type Repositories } from "@/repositories";
import { DataStore, type Persistence } from "@/repositories/store";
import type { InvestigationAdapter } from "@/services/investigation";
import type { ExecutionDeps } from "@/services/execution";

export type AppServices = ExecutionDeps & {
  store: DataStore;
  repos: Repositories;
  /** Investigations and drafts. Live model when configured, deterministic otherwise. */
  agent: AgentGateway;
  investigator: InvestigationAdapter;
};

/** Wires the store, repositories and demo adapters. Swap adapters here for real APIs. */
export function createAppServices(
  fixtures: Dataset,
  clock: Clock,
  persistence?: Persistence,
  options: { liveAgent?: boolean } = {},
): AppServices {
  const store = new DataStore(fixtures, clock.now(), persistence);
  const repos = createRepositories(store);
  const merchant = createDemoMerchant(repos, clock);
  const gateway = createDemoGateway(repos, clock, merchant);
  const demo = createDemoAgentGateway(
    (id) => store.investigationResponse(id),
    () => store.flags.investigationAvailable,
  );
  const agent = options.liveAgent ? createLiveAgentGateway(demo) : demo;
  const investigator: InvestigationAdapter = { investigateCase: agent.investigateCase, investigateIncident: agent.investigateIncident };
  return { store, repos, clock, merchant, gateway, agent, investigator };
}
