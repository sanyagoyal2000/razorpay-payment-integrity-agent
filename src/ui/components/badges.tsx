"use client";

import { Badge, Box, Indicator, Text } from "@razorpay/blade/components";
import type { CaseStatus, IncidentStatus, PolicyVerdict, Severity } from "@/domain/types";

type BadgeColor = "positive" | "negative" | "notice" | "information" | "neutral" | "primary";

const INCIDENT_STATUS: Record<IncidentStatus, { label: string; color: BadgeColor }> = {
  investigating: { label: "Investigating", color: "neutral" },
  action_required: { label: "Action required", color: "notice" },
  contained: { label: "Contained", color: "information" },
  resolved: { label: "Resolved", color: "positive" },
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const { label, color } = INCIDENT_STATUS[status];
  return <StatusBadge label={label} color={color} />;
}

/**
 * Amber status. Neither Blade amber badge meets 4.5:1 at badge size, so amber
 * states use an amber indicator (non-text, above 3:1) beside full-contrast text.
 */
export function NoticeLabel({ children }: { children: string }) {
  return (
    <Box display="inline-flex" alignItems="center" gap="spacing.2">
      <Indicator color="notice" emphasis="intense" size="medium" accessibilityLabel="" />
      <Text size="small" weight="semibold">{children}</Text>
    </Box>
  );
}

function StatusBadge({ label, color }: { label: string; color: BadgeColor }) {
  if (color === "notice") return <NoticeLabel>{label}</NoticeLabel>;
  return (
    <Badge size="medium" color={color}>
      {label}
    </Badge>
  );
}

const CASE_STATUS: Record<CaseStatus, { label: string; color: BadgeColor }> = {
  observing: { label: "Observing", color: "neutral" },
  open: { label: "Open", color: "notice" },
  review_required: { label: "Review required", color: "notice" },
  approved: { label: "Approved", color: "information" },
  executing: { label: "Executing", color: "information" },
  resolved: { label: "Resolved", color: "positive" },
  rejected: { label: "Rejected", color: "neutral" },
  escalated: { label: "Escalated", color: "notice" },
};

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  const { label, color } = CASE_STATUS[status];
  return <StatusBadge label={label} color={color} />;
}

const SEVERITY: Record<Severity, { label: string; color: "negative" | "notice" | "neutral" }> = {
  critical: { label: "Critical", color: "negative" },
  high: { label: "High", color: "notice" },
  medium: { label: "Medium", color: "neutral" },
  low: { label: "Low", color: "neutral" },
};

/** Severity as text with a small indicator, so it is legible without colour. */
export function SeverityLabel({ severity }: { severity: Severity }) {
  const { label, color } = SEVERITY[severity];
  return (
    <Box display="flex" alignItems="center" gap="spacing.2">
      <Indicator color={color} emphasis="intense" size="small" accessibilityLabel="" />
      <Text size="small">{label}</Text>
    </Box>
  );
}

const VERDICT: Record<PolicyVerdict["result"], { label: string; color: BadgeColor }> = {
  allowed: { label: "Allowed", color: "positive" },
  requires_approval: { label: "Approval required", color: "notice" },
  blocked: { label: "Blocked", color: "negative" },
};

export function VerdictBadge({ result, label }: { result: PolicyVerdict["result"]; label?: string }) {
  const meta = VERDICT[result];
  return <StatusBadge label={label ?? meta.label} color={meta.color} />;
}
