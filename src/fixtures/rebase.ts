import { istDate, MS_PER_DAY } from "@/domain/time";
import type { Dataset } from "./dataset-types";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_MINUTE = 60_000;

/** How long before first load the latest fixture event appears. */
export const HORIZON_LEAD_MS = MS_PER_MINUTE;

/**
 * Whole minutes to add to the committed fixtures so that the latest fixture
 * event lands about a minute before `now`. Relative timing between events is
 * preserved exactly, so the incident reads as having just happened.
 */
export function rebaseOffsetMinutes(dataset: Pick<Dataset, "meta">, now: Date): number {
  return Math.floor((now.getTime() - HORIZON_LEAD_MS - Date.parse(dataset.meta.horizon)) / MS_PER_MINUTE);
}

/**
 * Returns a deep copy with every timestamp shifted by `minutes`. Calendar dates
 * (daily aggregates) move by the number of days the horizon's IST date moved.
 */
export function rebaseDataset(dataset: Dataset, minutes: number): Dataset {
  if (minutes === 0) return structuredClone(dataset);
  const shiftMs = minutes * MS_PER_MINUTE;
  const horizon = Date.parse(dataset.meta.horizon);
  const dayShift = Math.round(
    (Date.parse(`${istDate(new Date(horizon + shiftMs))}T00:00:00Z`) - Date.parse(`${istDate(new Date(horizon))}T00:00:00Z`)) / MS_PER_DAY,
  );
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (ISO_TIMESTAMP.test(value)) return new Date(Date.parse(value) + shiftMs).toISOString();
      if (ISO_DATE.test(value)) return new Date(Date.parse(`${value}T00:00:00Z`) + dayShift * MS_PER_DAY).toISOString().slice(0, 10);
      return value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, visit(inner)]));
    }
    return value;
  };
  return visit(dataset) as Dataset;
}
