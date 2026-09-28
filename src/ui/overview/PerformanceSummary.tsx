"use client";

import {
  Box,
  Button,
  Divider,
  Text,
  VisuallyHidden,
} from "@razorpay/blade/components";
import { formatINR } from "@/domain/money";
import { formatDuration } from "@/domain/time";
import type { OverviewModel } from "@/services/views/overview";
import type { CaseListRequest } from "@/ui/components/CaseListDrawer";
import { Surface } from "@/ui/components/Surface";
import { CompletionRateChart } from "./CompletionRateChart";

const percent = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

function Figure({ label, value, detail, action }: { label: string; value: string; detail: string; action?: { label: string; onClick: () => void } }) {
  return (
    <Box display="flex" justifyContent="space-between" alignItems="baseline" gap="spacing.4" paddingY="spacing.3">
      <Box>
        <Text size="small" color="surface.text.gray.subtle">{label}</Text>
        <Text size="xsmall" color="surface.text.gray.muted">{detail}</Text>
      </Box>
      <Box display="flex" alignItems="center" gap="spacing.3" flexShrink={0}>
        <Text size="medium" weight="semibold">{value}</Text>
        {action ? (
          <Button variant="tertiary" size="xsmall" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

export function PerformanceSummary({
  performance,
  onShowCases,
}: {
  performance: OverviewModel["performance"];
  onShowCases: (request: CaseListRequest) => void;
}) {
  const data = performance.daily.map((d) => ({ label: dayLabel(d.date), rate: Number((d.completionRate * 100).toFixed(2)) }));
  const rates = data.map((d) => d.rate);
  const min = Math.max(0, Math.floor(Math.min(...rates)));
  const lowest = performance.daily.reduce((low, d) => (d.completionRate < low.completionRate ? d : low), performance.daily[0]!);
  const wrong = performance.wrongActionRate;
  return (
    <Surface title="Performance summary" description="Trailing 28 days, all active Outcome Contracts">
      <Text size="small" weight="semibold">Payment-to-outcome completion rate</Text>
      <Text size="xsmall" color="surface.text.gray.muted" marginBottom="spacing.3">
        Captured payments whose promised outcome is confirmed, by day (IST). Latest:{" "}
        {performance.latestCompletionRate === null ? "no data" : percent(performance.latestCompletionRate)}
      </Text>
      <Box aria-hidden="true">
        <CompletionRateChart data={data} min={min} />
      </Box>
      <VisuallyHidden>
        <Text>
          {`Completion rate over the last ${data.length} days ranged from ${percent(lowest.completionRate)} on ${dayLabel(lowest.date)} to ${percent(Math.max(...performance.daily.map((d) => d.completionRate)))}.`}
        </Text>
      </VisuallyHidden>
      <Divider marginY="spacing.4" />
      <Figure
        label="Median outcome completion time"
        value={performance.medianCompletionSeconds === null ? "No data" : formatDuration(performance.medianCompletionSeconds)}
        detail="Course purchase, today"
      />
      <Divider />
      <Figure
        label="Cases resolved before customer contact"
        value={performance.resolvedBeforeContact.value.toLocaleString("en-IN")}
        detail="Trailing 30 days"
        action={{
          label: "View",
          onClick: () =>
            onShowCases({
              title: "Resolved before customer contact",
              explanation: "Resolved with a verified outcome before the customer contacted LearnLoop.",
              caseIds: performance.resolvedBeforeContact.caseIds,
            }),
        }}
      />
      <Divider />
      <Figure
        label="Avoidable refunds prevented"
        value={`${performance.avoidableRefunds.value} ${performance.avoidableRefunds.value === 1 ? "payment" : "payments"} · ${formatINR(performance.avoidableRefunds.amount)}`}
        detail="Late authorisations captured before the automatic refund"
        action={{
          label: "View",
          onClick: () =>
            onShowCases({
              title: "Avoidable refunds prevented",
              explanation: "Payments Razorpay would have refunded automatically, captured and fulfilled instead.",
              caseIds: performance.avoidableRefunds.caseIds,
            }),
        }}
      />
      <Divider />
      <Figure
        label="Wrong-action rate"
        value={percent(wrong.rate, 1)}
        detail={`${wrong.wrong.length} of ${wrong.executed.length} executed actions later reversed, trailing 30 days`}
        action={
          wrong.wrong.length > 0
            ? {
                label: "View",
                onClick: () =>
                  onShowCases({
                    title: "Wrong actions",
                    explanation: "Executed actions whose outcome was later reversed by the merchant.",
                    caseIds: wrong.wrong,
                  }),
              }
            : undefined
        }
      />
    </Surface>
  );
}
