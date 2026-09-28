"use client";

import { Box, CheckIcon, Divider, HelpCircleIcon, Text, XCircleIcon, AlertTriangleIcon } from "@razorpay/blade/components";
import { Fragment } from "react";
import type { PolicyCheck, PolicyVerdict } from "@/domain/types";
import { VerdictBadge } from "@/ui/components/badges";

function CheckRow({ check }: { check: PolicyCheck }) {
  const failedHard = check.status !== "passed" && check.enforcement === "hard";
  const icon =
    check.status === "passed" ? (
      <CheckIcon size="small" color="surface.icon.gray.subtle" />
    ) : check.status === "unknown" ? (
      <HelpCircleIcon size="small" color={failedHard ? "feedback.icon.negative.intense" : "surface.icon.gray.subtle"} />
    ) : failedHard ? (
      <XCircleIcon size="small" color="feedback.icon.negative.intense" />
    ) : (
      <AlertTriangleIcon size="small" color="feedback.icon.notice.intense" />
    );
  const statusLabel = check.status === "passed" ? "Pass" : check.status === "failed" ? "Fail" : "Unknown";
  return (
    <Box display="grid" gridTemplateColumns="16px 1fr auto" columnGap="spacing.3" paddingY="spacing.2" alignItems="start">
      <Box paddingTop="spacing.1">{icon}</Box>
      <Box>
        <Text size="small">{check.label}</Text>
        <Text size="xsmall" color="surface.text.gray.muted">{check.explanation}</Text>
      </Box>
      <Text size="xsmall" weight="semibold" color={check.status === "passed" ? "surface.text.gray.subtle" : failedHard ? "feedback.text.negative.intense" : "feedback.text.notice.intense"}>
        {statusLabel}
      </Text>
    </Box>
  );
}

/** Every deterministic check, with a text status so the verdict reads without colour. */
export function PolicyVerdictSection({
  verdict,
  actionLabel,
  refusal,
}: {
  verdict: PolicyVerdict;
  actionLabel: string;
  refusal: boolean;
}) {
  const failing = verdict.checks.filter((c) => c.status !== "passed");
  const passing = verdict.checks.filter((c) => c.status === "passed");
  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" gap="spacing.3" marginBottom="spacing.2">
        <Text size="small" color="surface.text.gray.subtle">For {actionLabel.toLowerCase()}</Text>
        <VerdictBadge
          result={verdict.result}
          {...(verdict.result === "requires_approval" && verdict.approvalScope === "bulk" ? { label: "Eligible after approval" } : {})}
        />
      </Box>
      {[...failing, ...passing].map((check, index) => (
        <Fragment key={check.id}>
          {index > 0 ? <Divider /> : null}
          <CheckRow check={check} />
        </Fragment>
      ))}
      {refusal ? (
        <>
          <Divider />
          <Box display="grid" gridTemplateColumns="16px 1fr auto" columnGap="spacing.3" paddingY="spacing.2">
            <XCircleIcon size="small" color="feedback.icon.negative.intense" />
            <Text size="small" weight="semibold">Automatic fulfilment</Text>
            <Text size="xsmall" weight="semibold" color="feedback.text.negative.intense">Blocked</Text>
          </Box>
        </>
      ) : null}
    </Box>
  );
}
