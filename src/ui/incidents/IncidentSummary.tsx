"use client";

import { Badge, InfoGroup, InfoItem, InfoItemKey, InfoItemValue } from "@razorpay/blade/components";
import { formatINR } from "@/domain/money";
import { formatDuration, formatIstShort, formatRelative, secondsBetween } from "@/domain/time";
import type { IncidentWorkspaceModel } from "@/services/views/incidents";
import { Money } from "@/ui/components/Money";

export function IncidentSummary({ model, now }: { model: IncidentWorkspaceModel; now: Date }) {
  const { incident, totals, systemHealth } = model;
  const resolvedPart = totals.resolvedAmount > 0 ? `${formatINR(totals.resolvedAmount)} resolved of ${formatINR(totals.initialAmountAtRisk)}` : `${totals.caseCount} cases`;
  return (
    <InfoGroup itemOrientation="vertical" size="small" gridTemplateColumns={{ base: "repeat(2, 1fr)", m: "repeat(3, 1fr)", l: "repeat(6, auto)" }}>
      <InfoItem>
        <InfoItemKey>Revenue at risk</InfoItemKey>
        <InfoItemValue helpText={resolvedPart}>
          <Money value={totals.remainingAtRisk} size="medium" weight="semibold" />
        </InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>Affected customers</InfoItemKey>
        <InfoItemValue helpText={`${totals.customersAtRisk} still waiting`}>{String(totals.affectedCustomers)}</InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>Started</InfoItemKey>
        <InfoItemValue helpText={formatRelative(incident.startedAt, now)}>{formatIstShort(incident.startedAt, now)}</InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>Detected</InfoItemKey>
        <InfoItemValue helpText={`${formatDuration(secondsBetween(incident.startedAt, incident.detectedAt))} after start`}>
          {formatIstShort(incident.detectedAt, now)}
        </InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>System health</InfoItemKey>
        <InfoItemValue helpText={systemHealth.since ? `Since ${formatIstShort(systemHealth.since, now)}` : "No incidents reported"}>
          <Badge color={systemHealth.status === "healthy" ? "positive" : "negative"} size="small">
            {systemHealth.label}
          </Badge>
        </InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>Owner</InfoItemKey>
        <InfoItemValue>{incident.owner}</InfoItemValue>
      </InfoItem>
    </InfoGroup>
  );
}
