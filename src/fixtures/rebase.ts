import { MS_PER_DAY } from "@/domain/time";
import type { Dataset } from "./dataset-types";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole days to add to the committed fixtures so that the latest fixture event
 * falls within the 24 hours before `now`. Shifting by whole days keeps every
 * wall-clock time (for example the 14:04 IST deploy) unchanged.
 */
export function rebaseOffsetDays(dataset: Pick<Dataset, "meta">, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(dataset.meta.horizon)) / MS_PER_DAY);
}

/** Returns a deep copy of the dataset with every timestamp and date shifted by `days`. */
export function rebaseDataset(dataset: Dataset, days: number): Dataset {
  if (days === 0) return structuredClone(dataset);
  const shiftMs = days * MS_PER_DAY;
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (ISO_TIMESTAMP.test(value)) return new Date(Date.parse(value) + shiftMs).toISOString();
      if (ISO_DATE.test(value)) return new Date(Date.parse(`${value}T00:00:00Z`) + shiftMs).toISOString().slice(0, 10);
      return value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, visit(inner)]));
    }
    return value;
  };
  const shifted = visit(dataset) as Dataset;
  return shifted;
}
