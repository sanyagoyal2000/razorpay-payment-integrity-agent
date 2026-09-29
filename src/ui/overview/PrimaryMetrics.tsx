"use client";

import { Box, Button, Heading, Text } from "@razorpay/blade/components";
import type { ReactNode } from "react";
import type { PrimaryMetrics as Metrics } from "@/services/metrics/overview";
import type { CaseListRequest } from "@/ui/components/CaseListDrawer";
import { MoneyHeading } from "@/ui/components/Money";

function Metric({
  label,
  value,
  footnote,
  action,
}: {
  label: string;
  value: ReactNode;
  footnote: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Box padding="spacing.6" display="flex" flexDirection="column" gap="spacing.2">
      <Text size="small" weight="medium" color="surface.text.gray.subtle">
        {label}
      </Text>
      <Box minHeight="40px" display="flex" alignItems="center">
        {value}
      </Box>
      <Box display="flex" alignItems="center" gap="spacing.2" flexWrap="wrap">
        <Text size="xsmall" color="surface.text.gray.muted">
          {footnote}
        </Text>
        {action ? (
          <Button variant="tertiary" size="xsmall" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

export function PrimaryMetrics({ metrics, onShowCases }: { metrics: Metrics; onShowCases: (request: CaseListRequest) => void }) {
  const count = (n: number) => (
    <Heading as="span" size="xlarge" weight="semibold">
      {n.toLocaleString("en-IN")}
    </Heading>
  );
  return (
    <Box
      as="section"
      aria-label="Key figures"
      display="grid"
      gridTemplateColumns={{ base: "repeat(2, 1fr)", l: "repeat(4, 1fr)" }}
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="medium"
    >
      <Metric
        label="Revenue at risk across all open cases"
        value={<MoneyHeading value={metrics.revenueAtRisk.value} />}
        footnote={`Across ${metrics.revenueAtRisk.caseIds.length} open cases, in incidents and on their own`}
        action={{
          label: "View cases",
          onClick: () =>
            onShowCases({
              title: "Revenue at risk across all open cases",
              explanation: "Open, review-required, approved, executing and escalated cases. Observed cases are not yet at risk.",
              caseIds: metrics.revenueAtRisk.caseIds,
            }),
        }}
      />
      <Metric
        label="Customers affected"
        value={count(metrics.customersAffected.value)}
        footnote="Distinct customers with a case at risk"
      />
      <Metric
        label="Open incidents"
        value={count(metrics.openIncidents.value)}
        footnote={metrics.openIncidents.value === 0 ? "No systemic issues detected" : metrics.openIncidents.incidentIds.join(", ")}
      />
      <Metric
        label="Cases resolved before customer contact"
        value={count(metrics.resolvedBeforeContact.value)}
        footnote="Trailing 30 days"
        action={{
          label: "View cases",
          onClick: () =>
            onShowCases({
              title: "Resolved before customer contact",
              explanation:
                "Cases resolved with a verified outcome in the last 30 days, before the learner contacted Marrow, where the default would have been a refund or a customer contact.",
              caseIds: metrics.resolvedBeforeContact.caseIds,
            }),
        }}
      />
    </Box>
  );
}
