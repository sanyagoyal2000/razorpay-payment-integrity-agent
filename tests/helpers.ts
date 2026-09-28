import dataset from "@/fixtures/dataset.json";
import type { Dataset } from "@/fixtures/dataset-types";
import { FIXTURE_ANCHOR_DATE } from "@/fixtures/build";
import { istToIso, type Clock } from "@/domain/time";
import { createAppServices } from "@/services/container";
import type { Persistence } from "@/repositories/store";

export const fixtures = dataset as unknown as Dataset;

/** 14:30 IST on the fixture's incident day: after recovery, before anything is resolved. */
export const NOW = istToIso(FIXTURE_ANCHOR_DATE, "14:30:00");

export type TestClock = Clock & { advance(seconds: number): void; set(iso: string): void };

export function testClock(iso = NOW): TestClock {
  let current = Date.parse(iso);
  return {
    now: () => new Date(current),
    advance: (seconds) => {
      current += seconds * 1000;
    },
    set: (next) => {
      current = Date.parse(next);
    },
  };
}

export function setup(options: { now?: string; persistence?: Persistence } = {}) {
  const clock = testClock(options.now);
  const services = createAppServices(fixtures, clock, options.persistence);
  const { repos } = services;
  const incident = repos.incidents.get("INC-0017")!;
  const incidentCases = repos.cases.forIncident("INC-0017");
  const byType = (type: string) => repos.cases.list().filter((c) => c.type === type && c.status !== "resolved" && c.status !== "rejected");
  return {
    ...services,
    clock,
    incident,
    incidentCases,
    refusalCase: byType("inventory_conflict")[0]!,
    lateAuthCase: byType("late_authorization")[0]!,
    waitingCase: byType("delayed_processing")[0]!,
    safeCases: incidentCases.filter((c) => c.type === "missing_outcome" && c.amountAtRisk <= 5000),
    highValueCases: incidentCases.filter((c) => c.amountAtRisk > 5000),
    duplicateCases: incidentCases.filter((c) => c.type === "duplicate_payment"),
  };
}

/** Sleep that advances the test clock instead of waiting. */
export const clockSleep = (clock: TestClock) => async (ms: number) => clock.advance(ms / 1000);
