"use client";

import { Badge, InfoGroup, InfoItem, InfoItemKey, InfoItemValue } from "@razorpay/blade/components";
import { MERCHANT } from "@/fixtures/catalogue";
import { formatIstDateTime, formatRelative } from "@/domain/time";
import type { OverviewModel } from "@/services/views/overview";

export function OverviewMeta({ model, now }: { model: OverviewModel; now: Date }) {
  return (
    <InfoGroup itemOrientation="vertical" size="small" gridTemplateColumns={{ base: "repeat(2, 1fr)", m: "repeat(5, auto)" }}>
      <InfoItem>
        <InfoItemKey>Merchant</InfoItemKey>
        <InfoItemValue>{MERCHANT.name}</InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>Environment</InfoItemKey>
        <InfoItemValue>
          <Badge color="positive" size="small">Live</Badge>
        </InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>Last data refresh</InfoItemKey>
        <InfoItemValue helpText={formatRelative(model.lastRefresh, now)}>{formatIstDateTime(model.lastRefresh)}</InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>Agent status</InfoItemKey>
        <InfoItemValue helpText={model.agent.detail}>{model.agent.label}</InfoItemValue>
      </InfoItem>
      <InfoItem>
        <InfoItemKey>Automation</InfoItemKey>
        <InfoItemValue helpText={model.automation.detail}>
          {model.automation.paused ? <Badge color="notice" size="small">Paused</Badge> : model.automation.label}
        </InfoItemValue>
      </InfoItem>
    </InfoGroup>
  );
}
