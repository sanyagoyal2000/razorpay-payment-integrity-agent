"use client";

import { Badge } from "@razorpay/blade/components";
import { MERCHANT } from "@/fixtures/catalogue";
import { formatIstDateTime, formatRelative } from "@/domain/time";
import type { OverviewModel } from "@/services/views/overview";
import { NoticeLabel } from "@/ui/components/badges";
import { MetaList } from "@/ui/components/MetaList";

export function OverviewMeta({ model, now }: { model: OverviewModel; now: Date }) {
  return (
    <MetaList
      items={[
        { label: "Merchant", value: MERCHANT.name },
        { label: "Environment", value: <Badge color="positive" size="small">Live</Badge> },
        { label: "Last data refresh", value: formatIstDateTime(model.lastRefresh), help: formatRelative(model.lastRefresh, now) },
        { label: "Agent status", value: model.agent.label, help: model.agent.detail },
        {
          label: "Automation",
          value: model.automation.paused ? <NoticeLabel>Paused</NoticeLabel> : model.automation.label,
          help: model.automation.detail,
        },
      ]}
      minColumnWidth={170}
    />
  );
}
