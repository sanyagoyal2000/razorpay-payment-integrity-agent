"use client";

import { Box, Button, Indicator, Text } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { formatIstShort, formatRelative } from "@/domain/time";
import type { BriefingAction, BriefingTarget, ProactiveBriefingModel } from "@/services/views/briefing";
import { IncidentStatusBadge } from "@/ui/components/badges";
import { LifecycleLabel } from "@/ui/agent/LifecycleLabel";
import { MetaList } from "@/ui/components/MetaList";
import { RaySurface } from "@/ui/ray/RaySurface";
import { BASE_PATH, incidentHref } from "@/ui/shell/nav";

export function briefingHref(target: BriefingTarget): string {
  if (target.kind === "incidents") return `${BASE_PATH}/incidents${target.filter ? `?status=${target.filter}` : ""}`;
  return `${incidentHref(target.incidentId)}${target.section ? `#${target.section}` : ""}`;
}

/**
 * "What needs my attention today?" Leads the Overview; the metric cards below
 * are the supporting evidence. Actions only navigate: nothing executes here.
 */
export function ProactiveBriefing({ model, now }: { model: ProactiveBriefingModel; now: Date }) {
  const router = useRouter();
  const go = (action: BriefingAction) => () => router.push(briefingHref(action.target));
  const clear = model.state === "clear";
  const featured = model.featured;

  return (
    <RaySurface
      id="briefing"
      identity="Proactive briefing"
      ambient
      titleSize="large"
      title={model.heading}
      description={
        <Box as="span" display="inline-flex" alignItems="center" gap="spacing.2">
          <Indicator color={clear ? "positive" : "notice"} emphasis="intense" size="small" accessibilityLabel="" />
          <Text as="span" size="small" weight="semibold" color="surface.text.gray.subtle">{model.eyebrow}</Text>
        </Box>
      }
    >
      <Box display="flex" flexDirection="column" gap="spacing.5">
        <Box maxWidth="760px">
          <Text size="medium" color="surface.text.gray.normal">{model.body}</Text>
        </Box>

        {featured && !clear ? (
          <MetaList
            minColumnWidth={180}
            items={[
              { label: model.incidentCount > 1 ? "Highest-priority incident" : "Incident", value: featured.title, help: featured.id },
              { label: "Incident status", value: <IncidentStatusBadge status={featured.status} /> },
              {
                label: "Service health",
                value: (
                  <Box display="inline-flex" alignItems="center" gap="spacing.2">
                    <Indicator color={featured.service.healthy ? "positive" : "negative"} emphasis="intense" size="medium" accessibilityLabel="" />
                    <Text size="small" weight="medium">{featured.service.label}</Text>
                  </Box>
                ),
              },
              { label: "Required decision", value: featured.requiredDecision },
            ]}
          />
        ) : null}

        <Box display="flex" flexWrap="wrap" alignItems="center" justifyContent="space-between" gap="spacing.4">
          <Box display="flex" flexWrap="wrap" gap="spacing.3">
            {model.primaryAction ? (
              <Button variant="primary" onClick={go(model.primaryAction)}>{model.primaryAction.label}</Button>
            ) : null}
            {model.secondaryActions.map((action) => (
              <Button key={action.label} variant="secondary" onClick={go(action)}>{action.label}</Button>
            ))}
          </Box>
          <Box display="flex" flexDirection="column" alignItems="flex-end" gap="spacing.1">
            <LifecycleLabel lifecycle={model.lifecycle} />
            <Text size="xsmall" color="surface.text.gray.muted">
              {clear ? "Last monitored" : "Data refreshed"} {formatRelative(model.lastRefresh, now)}
              {model.lastInvestigatedAt ? ` · Last investigated ${formatIstShort(model.lastInvestigatedAt, now)} IST` : ""}
            </Text>
          </Box>
        </Box>
      </Box>
    </RaySurface>
  );
}
