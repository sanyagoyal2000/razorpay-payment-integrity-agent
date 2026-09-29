"use client";

import { Box, Chip, ChipGroup, Text } from "@razorpay/blade/components";
import { useState } from "react";
import { agentProfile, contextAndAuthority } from "@/services/views/agentProfile";
import { MetaList } from "@/ui/components/MetaList";
import { PageHeader } from "@/ui/components/PageHeader";
import { PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { RaySurface } from "@/ui/ray/RaySurface";
import { useModel } from "@/ui/data/useModel";
import { ContextAuthorityView } from "./ContextAuthority";
import { LifecycleLabel } from "./LifecycleLabel";

/** Agent details: the specialist job, its current state, connected systems, authority and outcome. */
export function AgentDetailsPage() {
  const [contractId, setContractId] = useState<string | null>(null);
  const state = useModel((services, asOf) => {
    const profile = agentProfile(services.repos, asOf);
    const selected = services.repos.config.contract(contractId ?? profile.contracts[0]?.id ?? "") ?? services.repos.config.contracts()[0]!;
    return { profile, authority: contextAndAuthority(services.repos, selected), selectedId: selected.id };
  }, [contractId]);
  const header = <PageHeader title="Agent details" description="What the Payment Integrity Agent does, what it can read, and what it may do on your behalf." />;
  if (state.status === "loading") return <>{header}<PageSkeleton rows={2} /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;
  const { profile, authority, selectedId } = state.model;

  return (
    <>
      {header}
      <Box display="flex" flexDirection="column" gap="spacing.6">
        <RaySurface id="agent" identity="Specialist worker" title={profile.name}>
          <Box display="flex" flexDirection="column" gap="spacing.5">
            <Box maxWidth="760px">
              <Text size="medium">{profile.purpose}</Text>
            </Box>
            <LifecycleLabel lifecycle={profile.lifecycle} showReason />
            <MetaList
              minColumnWidth={220}
              items={[
                { label: "Permission mode", value: profile.permissionMode.label, help: profile.permissionMode.detail },
                { label: profile.outcomeMetric.label, value: profile.outcomeMetric.value, help: profile.outcomeMetric.detail },
                { label: profile.verifiedOutcomes.label, value: profile.verifiedOutcomes.value, help: profile.verifiedOutcomes.detail },
              ]}
            />
          </Box>
        </RaySurface>

        <Surface id="connected" title="Connected systems" description="Connecting a system gives the agent read context. Write access is granted separately on the Integrations page.">
          <Box display="flex" flexDirection="column" gap="spacing.3">
            {profile.connected.map((c) => (
              <Box key={c.name} display="flex" justifyContent="space-between" gap="spacing.4" paddingBottom="spacing.2" borderBottomWidth="thin" borderBottomColor="surface.border.gray.muted">
                <Text size="small" weight="medium">{c.name}</Text>
                <Text size="small" color="surface.text.gray.muted">{c.access}</Text>
              </Box>
            ))}
          </Box>
        </Surface>

        <Surface id="context-authority" title="Context & authority">
          <Box display="flex" flexDirection="column" gap="spacing.5">
            <ChipGroup label="Outcome Contract" selectionType="single" value={selectedId} onChange={({ values }) => setContractId(values[0] ?? null)}>
              {profile.contracts.map((c) => (
                <Chip key={c.id} value={c.id}>{c.name}</Chip>
              ))}
            </ChipGroup>
            <ContextAuthorityView model={authority} headingLevel="h3" />
          </Box>
        </Surface>
      </Box>
    </>
  );
}
