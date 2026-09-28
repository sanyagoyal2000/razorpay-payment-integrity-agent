"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { systemClock } from "@/domain/time";
import type { Dataset } from "@/fixtures/dataset-types";
import { localStoragePersistence } from "@/repositories/store";
import { createAppServices, type AppServices } from "@/services/container";
import { pendingExecutionIds, runExecutions } from "@/services/execution";
import { checkObservations } from "@/services/observation";

export type DataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; services: AppServices; version: number; now: Date };

const DataContext = createContext<DataState>({ status: "loading" });

const CLOCK_TICK_MS = 15_000;

/**
 * Loads fixtures and persisted state in the browser only, after mount, so the
 * server render (a loading state) and the first client render always match.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const servicesRef = useRef<AppServices | null>(null);
  const checkingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Observed cases past their contract deadline become missing outcomes.
    const observe = (current: AppServices) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      void checkObservations(current).finally(() => {
        checkingRef.current = false;
      });
    };
    let unsubscribe: (() => void) | undefined;
    import("@/fixtures/dataset.json")
      .then((module) => {
        if (cancelled) return;
        const created = createAppServices(module.default as unknown as Dataset, systemClock, localStoragePersistence(), { liveAgent: true });
        unsubscribe = created.store.subscribe(() => {
          setVersion((v) => v + 1);
          setNow(new Date());
        });
        created.store.sync(new Date());
        servicesRef.current = created;
        setServices(created);
        setNow(new Date());
        // Finish any recovery that was mid-flight when the page was last closed.
        const pending = pendingExecutionIds(created);
        if (pending.length > 0) void runExecutions(created, pending);
        observe(created);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Data could not be loaded");
      });
    const tick = window.setInterval(() => {
      const current = new Date();
      // Refresh from the data feed; while the feed is down, data goes stale.
      const active = servicesRef.current;
      if (active) {
        active.store.sync(current);
        observe(active);
      }
      setNow(current);
    }, CLOCK_TICK_MS);
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
