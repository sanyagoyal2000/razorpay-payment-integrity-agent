"use client";

import { Box, Button, Heading, SparklesIcon, Text } from "@razorpay/blade/components";
import type { DecisionSummary as Summary } from "@/services/views/incidentDecision";
import { Surface } from "@/ui/components/Surface";

/**
 * The 20-second answer at the top of the Decision tab: what happened, what is
 * at risk, what is recommended and what is excluded, with the next steps.
 */
export function DecisionSummary({
  summary,
  onReview,
  onInvestigate,
  onAsk,
}: {
  summary: Summary;
  onReview: () => void;
  onInvestigate: () => void;
  onAsk: () => void;
}) {
  return (
    <Surface id="decision-summary">
      <Box display="flex" flexDirection="column" gap="spacing.4">
        <Box display="flex" flexDirection="column" gap="spacing.2">
          <Heading as="h2" size="medium" weight="semibold">{summary.headline}</Heading>
          <Box maxWidth="760px">
            <Text size="medium">
              {summary.atRisk}
              {summary.cause ? ` ${summary.cause}` : ""}
            </Text>
          </Box>
        </Box>
        <Box maxWidth="760px">
          <Text size="medium">
            <Text as="span" size="medium" weight="semibold">Recommended: </Text>
            {summary.recommendation}
          </Text>
        </Box>
        <Box display="flex" flexWrap="wrap" gap="spacing.3">
          {summary.safeCount > 0 ? (
            <Button variant="primary" onClick={onReview}>{`Review ${summary.safeCount} ${summary.safeCount === 1 ? "recovery" : "recoveries"}`}</Button>
          ) : null}
          <Button variant="secondary" onClick={onInvestigate}>View investigation</Button>
          <Button variant="secondary" icon={SparklesIcon} onClick={onAsk}>Ask RAY</Button>
        </Box>
        <Text size="xsmall" color="surface.text.gray.muted">{summary.status.join(" · ")}</Text>
      </Box>
    </Surface>
  );
}
