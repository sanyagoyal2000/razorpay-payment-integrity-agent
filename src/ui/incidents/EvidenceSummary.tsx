"use client";

import { Box, Heading, IconButton, InfoIcon, Text, Tooltip } from "@razorpay/blade/components";
import { EVIDENCE_COUNT_NOTE, type EvidenceCounts } from "@/services/views/incidentDecision";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Box display="flex" flexDirection="column">
      <Heading as="span" size="medium" weight="semibold">{value.toLocaleString("en-IN")}</Heading>
      <Text size="small" color="surface.text.gray.muted">{label}</Text>
    </Box>
  );
}

/** Four counts with distinct meanings, none adjusted to match another. */
export function EvidenceSummary({ counts }: { counts: EvidenceCounts }) {
  return (
    <Box display="flex" flexWrap="wrap" alignItems="flex-start" gap="spacing.7" padding="spacing.5" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" backgroundColor="surface.background.gray.intense">
      <Stat value={counts.eventsAnalysed} label="Events analysed" />
      <Stat value={counts.citationsValidated} label="Citations validated" />
      <Stat value={counts.keyEventsShown} label="Key events shown" />
      <Stat value={counts.connectedSources} label="Connected sources" />
      <Tooltip content={EVIDENCE_COUNT_NOTE} placement="top">
        <IconButton icon={InfoIcon} size="small" accessibilityLabel="What these counts mean" onClick={() => undefined} />
      </Tooltip>
    </Box>
  );
}
