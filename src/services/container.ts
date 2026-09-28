import { createFixtureInvestigationAdapter } from "@/adapters/demo/investigation";
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
  investigator: InvestigationAdapter;
};

/** Wires the store, repositories and demo adapters. Swap adapters here for real APIs. */
export function createAppServices(fixtures: Dataset, clock: Clock, persistence?: Persistence): AppServices {
  const store = new DataStore(fixtures, clock.now(), persistence);
  const repos = createRepositories(store);
  const merchant = createDemoMerchant(repos, clock);
  const gateway = createDemoGateway(repos, clock, merchant);
  const investigator = createFixtureInvestigationAdapter(
    (id) => store.investigationResponse(id),
    () => store.flags.investigationAvailable,
  );
  return { store, repos, clock, merchant, gateway, investigator };
}
