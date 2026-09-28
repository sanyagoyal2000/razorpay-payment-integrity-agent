"use client";

import { Alert, Box, Button } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { incidentWorkspace } from "@/services/views/incidents";
import { CaseListDrawer, type CaseListRequest } from "@/ui/components/CaseListDrawer";
import { IncidentStatusBadge, SeverityLabel } from "@/ui/components/badges";
import { PageHeader } from "@/ui/components/PageHeader";
import { NotFound, PageError, PageSkeleton } from "@/ui/components/states";
import { useModel } from "@/ui/data/useModel";
import { BASE_PATH } from "@/ui/shell/nav";
import { ContainmentSection } from "./ContainmentSection";
import { EvidenceSection } from "./EvidenceSection";
import { HistorySection } from "./HistorySection";
import { IncidentSummary } from "./IncidentSummary";
import { RecoverySection } from "./RecoverySection";
import { UncertaintiesPanel } from "./UncertaintiesPanel";
import { WhatHappened } from "./WhatHappened";

export function IncidentWorkspacePage({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const state = useModel((services, asOf) => incidentWorkspace(services.repos, incidentId, asOf) ?? null, [incidentId]);
  const [drawer, setDrawer] = useState<CaseListRequest | null>(null);
  const crumbs = [{ label: "Incidents", href: `${BASE_PATH}/incidents` }, { label: incidentId }];

  if (state.status === "loading") return <><PageHeader title="Incident" crumbs={crumbs} /><PageSkeleton /></>;
  if (state.status === "error") return <><PageHeader title="Incident" crumbs={crumbs} /><PageError message={state.message} /></>;
  if (state.model === null) {
    return (
      <>
        <PageHeader title="Incident not found" crumbs={crumbs} />
        <NotFound
          title={`No incident ${incidentId}`}
          description="It may have been mistyped. All incidents are listed on the Incidents page."
          action={<Button variant="secondary" onClick={() => router.push(`${BASE_PATH}/incidents`)}>View incidents</Button>}
        />
      </>
    );
  }

  const model = state.model;
  const { incident } = model;
  return (
    <>
      <PageHeader
        title={incident.title}
        crumbs={crumbs}
        description={
          <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
            <IncidentStatusBadge status={incident.status} />
            <SeverityLabel severity={incident.severity} />
          </Box>
        }
        meta={<IncidentSummary model={model} now={state.now} />}
      />
      <Box display="flex" flexDirection="column" gap="spacing.6">
        {incident.status !== "resolved" ? (
          <Alert
            color={incident.status === "action_required" ? "notice" : "information"}
            title="Required decision"
            description={model.requiredDecision}
            isDismissible={false}
            isFullWidth
          />
        ) : null}
        <Box display="grid" gridTemplateColumns={{ base: "1fr", l: "2fr 1fr" }} gap="spacing.6" alignItems="start">
          <WhatHappened model={model} />
          <UncertaintiesPanel uncertainties={model.uncertainties} />
        </Box>
        <EvidenceSection groups={model.evidence} now={state.now} />
        <RecoverySection model={model} services={state.services} asOf={state.asOf} onShowCases={setDrawer} />
        <ContainmentSection model={model} services={state.services} now={state.now} />
        <HistorySection entries={model.history} now={state.now} />
      </Box>
      <CaseListDrawer request={drawer} onDismiss={() => setDrawer(null)} />
    </>
  );
}
