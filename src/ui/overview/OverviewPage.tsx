"use client";

import { Box } from "@razorpay/blade/components";
import { useState } from "react";
import { proactiveBriefing } from "@/services/views/briefing";
import { overviewModel } from "@/services/views/overview";
import { CaseListDrawer, type CaseListRequest } from "@/ui/components/CaseListDrawer";
import { PageHeader } from "@/ui/components/PageHeader";
import { PageError, PageSkeleton } from "@/ui/components/states";
import { useModel } from "@/ui/data/useModel";
import { ActiveIncidents } from "./ActiveIncidents";
import { AttentionCases } from "./AttentionCases";
import { IntegrityActivity } from "./IntegrityActivity";
import { OverviewMeta } from "./OverviewMeta";
import { PerformanceSummary } from "./PerformanceSummary";
import { PrimaryMetrics } from "./PrimaryMetrics";
import { ProactiveBriefing } from "./ProactiveBriefing";
import { ValueDelivered } from "./ValueDelivered";

export function OverviewPage() {
  const state = useModel((services, asOf) => ({ ...overviewModel(services.repos, asOf), briefing: proactiveBriefing(services.repos, asOf) }));
  const [drawer, setDrawer] = useState<CaseListRequest | null>(null);

  const header = (
    <PageHeader
      title="Payment Integrity"
      description="Monitor and recover successful payments that have not completed their promised outcome."
      meta={state.status === "ready" ? <OverviewMeta model={state.model} now={state.now} /> : undefined}
    />
  );
  if (state.status === "loading") return <>{header}<PageSkeleton /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;

  const { model } = state;
  return (
    <>
      {header}
      <Box display="flex" flexDirection="column" gap="spacing.6">
        <ProactiveBriefing model={model.briefing} now={state.now} />
        <PrimaryMetrics metrics={model.metrics} onShowCases={setDrawer} />
        <ActiveIncidents rows={model.incidents} lastRefresh={model.lastRefresh} now={state.now} />
        <AttentionCases rows={model.attention} now={state.now} />
        <ValueDelivered value={model.value} onShowCases={setDrawer} />
        <Box display="grid" gridTemplateColumns={{ base: "1fr", l: "3fr 2fr" }} gap="spacing.6" alignItems="start">
          <PerformanceSummary performance={model.performance} onShowCases={setDrawer} />
          <IntegrityActivity entries={model.activity} now={state.now} />
        </Box>
      </Box>
      <CaseListDrawer request={drawer} onDismiss={() => setDrawer(null)} />
    </>
  );
}
