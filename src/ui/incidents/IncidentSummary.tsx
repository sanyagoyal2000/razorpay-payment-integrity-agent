"use client";

import { Badge } from "@razorpay/blade/components";
import { MetaList } from "@/ui/components/MetaList";
import { formatINR } from "@/domain/money";
import { formatDuration, formatIstShort, formatRelative, secondsBetween } from "@/domain/time";
import type { IncidentWorkspaceModel } from "@/services/views/incidents";
import { Money } from "@/ui/components/Money";

export function IncidentSummary({ model, now }: { model: IncidentWorkspaceModel; now: Date }) {
  const { incident, totals, systemHealth } = model;
  const resolvedPart = totals.resolvedAmount > 0 ? `${formatINR(totals.resolvedAmount)} resolved of ${formatINR(totals.initialAmountAtRisk)}` : `${totals.caseCount} cases`;
  return (
    <MetaList
      items={[
        { label: "Revenue at risk", value: <Money value={totals.remainingAtRisk} size="medium" weight="semibold" />, help: resolvedPart },
        { label: "Affected customers", value: String(totals.affectedCustomers), help: `${totals.customersAtRisk} still waiting` },
        { label: "Started", value: formatIstShort(incident.startedAt, now), help: formatRelative(incident.startedAt, now) },
        { label: "Detected", value: formatIstShort(incident.detectedAt, now), help: `${formatDuration(secondsBetween(incident.startedAt, incident.detectedAt))} after start` },
        {
          label: "System health",
          value: (
            <Badge color={systemHealth.status === "healthy" ? "positive" : "negative"} size="small">
              {systemHealth.label}
            </Badge>
          ),
          help: systemHealth.since ? `Since ${formatIstShort(systemHealth.since, now)}` : "No incidents reported",
        },
        { label: "Owner", value: incident.owner },
      ]}
    />
  );
}
