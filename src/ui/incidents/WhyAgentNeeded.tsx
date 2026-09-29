"use client";

import { Alert, Box, Button, Collapsible, CollapsibleBody, CollapsibleLink, Heading, List, ListItem, Text } from "@razorpay/blade/components";
import type { AgentContribution } from "@/services/views/agentContribution";
import type { CaseListRequest } from "@/ui/components/CaseListDrawer";
import { RAY } from "@/ui/ray/theme";

function Column({ label, text, ai = false }: { label: string; text: string; ai?: boolean }) {
  return (
    <Box padding="spacing.4" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" {...(ai ? { backgroundColor: RAY.surfaceSubtle } : {})}>
      <Text size="small" weight="semibold" marginBottom="spacing.1">{label}</Text>
      <Text size="small" color="surface.text.gray.subtle">{text}</Text>
    </Box>
  );
}

/**
 * What the fixed rule found and what the investigation added. Every figure
 * comes from the AgentContribution view model. Shown inside "See how RAY
 * investigated" rather than in the main decision flow.
 */
export function ContributionDetails({ contribution, onShowCases }: { contribution: AgentContribution; onShowCases: (request: CaseListRequest) => void }) {
  return (
      <Box display="flex" flexDirection="column" gap="spacing.5">
        {contribution.notice ? (
          <Alert color="notice" title="No usable investigation" description={contribution.notice} isDismissible={false} isFullWidth />
        ) : null}

        <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "1fr 1fr" }} gap="spacing.4">
          <Column label="Fixed rule" text={contribution.comparison.fixedRule} />
          <Column label="AI investigator" text={contribution.comparison.agent} ai />
        </Box>

        <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="spacing.4">
          {contribution.metrics.map((metric) => (
            <Box key={metric.id} display="flex" flexDirection="column" gap="spacing.1">
              <Text size="small" color="surface.text.gray.muted">{metric.label}</Text>
              <Heading as="span" size="medium" weight="semibold">{metric.value.toLocaleString("en-IN")}</Heading>
              <Text size="xsmall" color="surface.text.gray.subtle">{metric.detail}</Text>
              {metric.caseIds && metric.caseIds.length > 0 ? (
                <Box>
                  <Button
                    variant="tertiary"
                    size="xsmall"
                    accessibilityLabel={`View cases: ${metric.label}`}
                    onClick={() => onShowCases({ title: metric.label, explanation: `${metric.value} ${metric.detail}`, caseIds: metric.caseIds! })}
                  >
                    View cases
                  </Button>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>

        {contribution.conclusion ? <Text size="small">{contribution.conclusion}</Text> : null}

        <Collapsible>
          <CollapsibleLink size="small">How this is calculated</CollapsibleLink>
          <CollapsibleBody>
            <List size="small">
              {contribution.howCalculated.map((line) => (
                <ListItem key={line}>{line}</ListItem>
              ))}
            </List>
          </CollapsibleBody>
        </Collapsible>
      </Box>
  );
}
