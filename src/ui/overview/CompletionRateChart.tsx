"use client";

import { useTheme } from "@razorpay/blade/components";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type CompletionPoint = { label: string; rate: number };

/**
 * Single-series line chart of daily completion rate. Recharts, coloured with
 * Blade tokens. No legend: the section title names the series.
 */
export function CompletionRateChart({ data, min }: { data: CompletionPoint[]; min: number }) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const font = theme.typography.fonts.family.text;
  const axisText = { fill: colors.surface.text.gray.muted, fontSize: 12, fontFamily: font };
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round((min + ((100 - min) * i) / 5) * 10) / 10).filter((t, i, all) => all.indexOf(t) === i);
  return (
    <ResponsiveContainer width="100%" height={180} initialDimension={{ width: 640, height: 180 }}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={colors.surface.border.gray.muted} />
        <XAxis dataKey="label" interval={6} tick={axisText} tickLine={false} axisLine={{ stroke: colors.surface.border.gray.muted }} />
        <YAxis
          domain={[min, 100]}
          ticks={ticks}
          tickFormatter={(v: number) => `${v}%`}
          tick={axisText}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(2)}%`, "Completion rate"]}
          cursor={{ stroke: colors.surface.border.gray.normal, strokeWidth: 1 }}
          contentStyle={{
            fontFamily: font,
            fontSize: 12,
            borderRadius: 8,
            border: `1px solid ${colors.surface.border.gray.muted}`,
            color: colors.surface.text.gray.normal,
          }}
          labelStyle={{ color: colors.surface.text.gray.subtle }}
        />
        <Line
          type="linear"
          dataKey="rate"
          name="Completion rate"
          stroke={colors.data.background.categorical.blue.strong}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: colors.surface.background.gray.intense }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
