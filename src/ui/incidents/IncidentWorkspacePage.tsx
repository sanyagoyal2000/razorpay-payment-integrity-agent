"use client";

import { Box, Button, SparklesIcon, TabItem, TabList, TabPanel, Tabs, Text } from "@razorpay/blade/components";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { reinvestigateIncident, type InvestigationProgress } from "@/services/agent";
import { INCIDENT_TABS, parseIncidentTab, type IncidentTab } from "@/services/views/incidentDecision";
import { incidentWorkspace } from "@/services/views/incidents";
import { AskRayDrawer } from "@/ui/agent/AskRayDrawer";
import { InvestigationPanel } from "@/ui/agent/InvestigationPanel";
import { LifecycleLabel } from "@/ui/agent/LifecycleLabel";
import { AppLink } from "@/ui/components/AppLink";
import { CaseListDrawer, type CaseListRequest } from "@/ui/components/CaseListDrawer";
import { IncidentStatusBadge, SeverityLabel } from "@/ui/components/badges";
import { PageHeader } from "@/ui/components/PageHeader";
import { NotFound, PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";
import { BASE_PATH } from "@/ui/shell/nav";
import { AuthoritySummary } from "./AuthoritySummary";
import { ContainmentSection } from "./ContainmentSection";
import { DecisionSummary } from "./DecisionSummary";
import { EvidenceSection } from "./EvidenceSection";
import { EvidenceSummary } from "./EvidenceSummary";
import { HistorySection } from "./HistorySection";
import { IncidentSummary } from "./IncidentSummary";
import { RecoverySection } from "./RecoverySection";
import { UncertaintiesPanel } from "./UncertaintiesPanel";
import { WhatHappened } from "./WhatHappened";
import { WhyRayRecommends } from "./WhyRayRecommends";

/**
 * An incident in three local tabs: Decision (default), Investigation, and
 * Evidence & history. The selected tab lives in the URL (?tab=…), so it
 * survives refresh, works with Back and Forward, and can be deep-linked.
 */
export function IncidentWorkspacePage({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseIncidentTab(searchParams.get("tab"));
  const state = useModel((services, asOf) => incidentWorkspace(services.repos, incidentId, asOf) ?? null, [incidentId]);
  const [drawer, setDrawer] = useState<CaseListRequest | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const crumbs = [{ label: "Incidents", href: `${BASE_PATH}/incidents` }, { label: incidentId }];
  const ready = state.status === "ready" && state.model !== null;

  const selectTab = (next: IncidentTab, section?: string) => {
    const query = next === "decision" ? "" : `?tab=${next}`;
    router.push(`${pathname}${query}${section ? `#${section}` : ""}`, { scroll: false });
  };
  // Sections render after data loads and after a tab switch, so jump to a linked section once it exists.
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    const id = window.location.hash.slice(1);
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(timer);
  }, [ready, tab]);

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
  const reviewRecovery = () => {
    if (tab === "decision") document.getElementById("recovery")?.scrollIntoView({ block: "start" });
    else selectTab("decision", "recovery");
  };
  return (
    <>
      <PageHeader
        title={incident.title}
        crumbs={crumbs}
        description={
          <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
            <IncidentStatusBadge status={incident.status} />
            <SeverityLabel severity={incident.severity} />
            <LifecycleLabel lifecycle={model.lifecycle} />
          </Box>
        }
      />
      <Tabs value={tab} onChange={(value) => selectTab(parseIncidentTab(value))} variant="bordered" isLazy>
        <TabList>
          {INCIDENT_TABS.map((t) => (
            <TabItem key={t.id} value={t.id}>{t.label}</TabItem>
          ))}
        </TabList>

        <TabPanel value="decision">
          <Box display="flex" flexDirection="column" gap="spacing.6" paddingTop="spacing.6">
            <DecisionSummary summary={model.decision} onReview={reviewRecovery} onInvestigate={() => selectTab("investigation")} onAsk={() => setAskOpen(true)} />
            <WhatHappened model={model} />
            <RecoverySection model={model} services={state.services} asOf={state.asOf} onShowCases={setDrawer} />
            <ContainmentSection model={model} services={state.services} now={state.now} />
          </Box>
        </TabPanel>

        <TabPanel value="investigation">
          <Box display="flex" flexDirection="column" gap="spacing.6" paddingTop="spacing.6">
            <WhyRayRecommends reasons={model.reasons} contribution={model.contribution} onShowCases={setDrawer} />
            <InvestigationPanel
              subject="incident"
              view={model.investigation}
              now={state.now}
              {...(incident.status !== "resolved" ? { onReinvestigate: (onProgress: (p: InvestigationProgress) => void) => reinvestigateIncident(state.services, incident.id, onProgress) } : {})}
            />
            <UncertaintiesPanel uncertainties={model.uncertainties} />
            <AuthoritySummary authority={model.recoveryAuthority} />
            <Surface id="ask-ray" title="Questions about this incident">
              <Box display="flex" alignItems="center" justifyContent="space-between" gap="spacing.4" flexWrap="wrap">
                <Text size="small" color="surface.text.gray.subtle">Answers cite this incident&apos;s evidence. Nothing is executed from here.</Text>
                <Button variant="secondary" size="small" icon={SparklesIcon} onClick={() => setAskOpen(true)}>Ask RAY</Button>
              </Box>
            </Surface>
          </Box>
        </TabPanel>

        <TabPanel value="evidence">
          <Box display="flex" flexDirection="column" gap="spacing.6" paddingTop="spacing.6">
            {model.evidenceCounts ? <EvidenceSummary counts={model.evidenceCounts} /> : null}
            <EvidenceSection groups={model.evidence} now={state.now} />
            <HistorySection entries={model.history} now={state.now} />
            <Surface id="incident-details" title="Incident details" actions={<AppLink href={`${BASE_PATH}/audit-log?incident=${incident.id}`}>View in Audit Log</AppLink>}>
              <IncidentSummary model={model} now={state.now} />
            </Surface>
          </Box>
        </TabPanel>
      </Tabs>
      <CaseListDrawer request={drawer} onDismiss={() => setDrawer(null)} />
      <AskRayDrawer isOpen={askOpen} onDismiss={() => setAskOpen(false)} incidentId={incident.id} suggestions={model.askSuggestions} services={state.services} />
    </>
  );
}
