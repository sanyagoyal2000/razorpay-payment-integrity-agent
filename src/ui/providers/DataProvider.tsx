"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { systemClock } from "@/domain/time";
import type { Dataset } from "@/fixtures/dataset-types";
import { localStoragePersistence } from "@/repositories/store";
import { createAppServices, type AppServices } from "@/services/container";
import { pendingExecutionIds, runExecutions } from "@/services/execution";

export type DataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; services: AppServices; version: number; now: Date };

const DataContext = createContext<DataState>({ status: "loading" });

const CLOCK_TICK_MS = 30_000;

/**
 * Loads fixtures and persisted state in the browser only, after mount, so the
 * server render (a loading state) and the first client render always match.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    import("@/fixtures/dataset.json")
      .then((module) => {
        if (cancelled) return;
        const created = createAppServices(module.default as unknown as Dataset, systemClock, localStoragePersistence(), { liveAgent: true });
        unsubscribe = created.store.subscribe(() => {
          setVersion((v) => v + 1);
          setNow(new Date());
        });
        setServices(created);
        setNow(new Date());
        // Finish any recovery that was mid-flight when the page was last closed.
        const pending = pendingExecutionIds(created);
        if (pending.length > 0) void runExecutions(created, pending);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Data could not be loaded");
      });
    const tick = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.clearInterval(tick);
    };
  }, []);

  const state: DataState = error
    ? { status: "error", message: error }
    : services && now
      ? { status: "ready", services, version, now }
      : { status: "loading" };
  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useDataState(): DataState {
  return useContext(DataContext);
}
