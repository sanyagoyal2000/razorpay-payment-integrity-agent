"use client";

import { Box, Button, Heading, IconButton, InfoIcon, Text, Tooltip } from "@razorpay/blade/components";
import { formatINR } from "@/domain/money";
import { formatDuration } from "@/domain/time";
import { VALUE_DELIVERED_EXPLANATIONS, type ValueDelivered as Value } from "@/services/metrics/overview";
import type { CaseListRequest } from "@/ui/components/CaseListDrawer";
import { Surface } from "@/ui/components/Surface";

function ValueFigure({
  label,
  value,
  detail,
  explanation,
  onView,
}: {
  label: string;
  value: string;
  detail?: string;
  explanation: string;
  onView: () => void;
}) {
  return (
    <Box padding="spacing.5" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" display="flex" flexDirection="column" gap="spacing.2">
      <Box display="flex" alignItems="center" gap="spacing.1">
        <Text size="small" weight="medium" color="surface.text.gray.subtle">{label}</Text>
        <Tooltip content={explanation} placement="top">
          <IconButton icon={InfoIcon} size="small" accessibilityLabel={`How ${label.toLowerCase()} is calculated`} onClick={() => undefined} />
        </Tooltip>
      </Box>
      <Heading as="span" size="large" weight="semibold">{value}</Heading>
      <Box display="flex" alignItems="center" justifyContent="space-between" gap="spacing.2">
        <Text size="xsmall" color="surface.text.gray.muted">{detail ?? ""}</Text>
        <Button variant="tertiary" size="xsmall" onClick={onView}>View cases</Button>
      </Box>
    </Box>
  );
}

export function ValueDelivered({ value, onShowCases }: { value: Value; onShowCases: (request: CaseListRequest) => void }) {
  const show = (title: string, explanation: string, caseIds: string[]) => () => onShowCases({ title, explanation, caseIds });
  const median = value.medianDetectionToVerifiedSeconds.value;
  return (
    <Surface
      title="Value delivered (trailing 30 days)"
      description="Counts only cases that would otherwise have been refunded automatically or raised by the customer."
    >
      <Box display="grid" gridTemplateColumns={{ base: "repeat(2, 1fr)", l: "repeat(4, 1fr)" }} gap="spacing.4">
        <ValueFigure
          label="GMV resolved before refund or dispute"
          value={formatINR(value.gmvResolvedBeforeRefundOrDispute.value)}
          detail={`${value.gmvResolvedBeforeRefundOrDispute.caseIds.length} cases`}
          explanation={VALUE_DELIVERED_EXPLANATIONS.gmvResolvedBeforeRefundOrDispute}
          onView={show("GMV resolved before refund or dispute", VALUE_DELIVERED_EXPLANATIONS.gmvResolvedBeforeRefundOrDispute, value.gmvResolvedBeforeRefundOrDispute.caseIds)}
        />
        <ValueFigure
          label="Avoidable refunds prevented"
          value={value.avoidableRefundsPrevented.value.toLocaleString("en-IN")}
          detail={formatINR(value.avoidableRefundsPrevented.amount)}
          explanation={VALUE_DELIVERED_EXPLANATIONS.avoidableRefundsPrevented}
          onView={show("Avoidable refunds prevented", VALUE_DELIVERED_EXPLANATIONS.avoidableRefundsPrevented, value.avoidableRefundsPrevented.caseIds)}
        />
        <ValueFigure
          label="Estimated support contacts avoided"
          value={value.supportContactsAvoided.value.toLocaleString("en-IN")}
          detail="One contact per case"
          explanation={VALUE_DELIVERED_EXPLANATIONS.supportContactsAvoided}
          onView={show("Estimated support contacts avoided", VALUE_DELIVERED_EXPLANATIONS.supportContactsAvoided, value.supportContactsAvoided.caseIds)}
        />
        <ValueFigure
          label="Median detection to verified outcome"
          value={median === null ? "No cases" : formatDuration(median)}
          detail={`Across ${value.medianDetectionToVerifiedSeconds.caseIds.length} cases`}
          explanation={VALUE_DELIVERED_EXPLANATIONS.medianDetectionToVerifiedSeconds}
          onView={show("Median detection to verified outcome", VALUE_DELIVERED_EXPLANATIONS.medianDetectionToVerifiedSeconds, value.medianDetectionToVerifiedSeconds.caseIds)}
        />
      </Box>
    </Surface>
  );
}
