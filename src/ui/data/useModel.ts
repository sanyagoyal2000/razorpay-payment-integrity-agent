"use client";

import { useMemo } from "react";
import type { AppServices } from "@/services/container";
import { useDataState } from "@/ui/providers/DataProvider";

export type ModelState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; model: T; services: AppServices; now: Date; asOf: string };

/**
 * Builds a view model from the current data. Recomputes when the store changes
 * or the clock ticks. `build` must be a pure function of its inputs.
 */
export function useModel<T>(build: (services: AppServices, asOf: string) => T, deps: readonly unknown[] = []): ModelState<T> {
  const state = useDataState();
  const services = state.status === "ready" ? state.services : undefined;
  const version = state.status === "ready" ? state.version : -1;
  const now = state.status === "ready" ? state.now : undefined;
  const model = useMemo(
    () => (services && now ? build(services, now.toISOString()) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services, version, now, ...deps],
  );
  if (state.status === "error") return state;
  if (!services || !now || model === undefined) return { status: "loading" };
  return { status: "ready", model, services, now, asOf: now.toISOString() };
}
