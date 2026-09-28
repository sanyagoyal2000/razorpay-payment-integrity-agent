"use client";

import { FilterChipDatePicker } from "@razorpay/blade/components";
import { istDate } from "@/domain/time";

/** Converts an IST calendar date (YYYY-MM-DD) to a local Date at noon, so the calendar shows the same day. */
function toCalendarDate(date: string | undefined): Date | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
}

function fromCalendarDate(date: Date | null): string | undefined {
  if (!date) return undefined;
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  return istDate(new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 6, 30)));
}

/** Blade date-range filter chip whose values are IST calendar dates. */
export function DateRangeFilterChip({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
}) {
  return (
    <FilterChipDatePicker
      label={label}
      selectionType="range"
      value={[toCalendarDate(from), toCalendarDate(to)]}
      onChange={(value) => {
        const [start, end] = Array.isArray(value) ? value : [value, value];
        const next: { from?: string; to?: string } = {};
        const f = fromCalendarDate(start ?? null);
        const t = fromCalendarDate(end ?? null);
        if (f) next.from = f;
        if (t) next.to = t;
        onChange(next);
      }}
      onClearButtonClick={() => onChange({})}
    />
  );
}
