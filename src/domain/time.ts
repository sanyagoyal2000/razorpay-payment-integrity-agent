export const MS_PER_SECOND = 1000;
export const MS_PER_DAY = 86_400_000;
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Source of the current time. Services take a clock so tests stay deterministic. */
export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  const date = new Date(iso);
  return { now: () => new Date(date.getTime()) };
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * MS_PER_SECOND).toISOString();
}

export function secondsBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_SECOND;
}

/** Converts an IST wall-clock date and time to a UTC ISO string. */
export function istToIso(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}Z`) - IST_OFFSET_MS).toISOString();
}

/** IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(iso: string | Date): string {
  const ms = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST wall-clock time (HH:MM:SS) of an instant. */
export function istTime(iso: string | Date): string {
  const ms = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(11, 19);
}

export function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "16 Jun 2026, 13:48 IST". */
export function formatIstDateTime(iso: string): string {
  const [year, month, day] = istDate(iso).split("-") as [string, string, string];
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}, ${istTime(iso).slice(0, 5)} IST`;
}
