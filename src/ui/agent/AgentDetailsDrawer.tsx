"use client";

import { Box, Chip, ChipGroup, Divider, Drawer, DrawerBody, DrawerHeader, Heading, Text } from "@razorpay/blade/components";
import { useState } from "react";
import { agentProfile, contextAndAuthority } from "@/services/views/agentProfile";
import { MetaList } from "@/ui/components/MetaList";
import { useModel } from "@/ui/data/useModel";
import { RayIdentity } from "@/ui/ray/RayIdentity";
import { ContextAuthorityView } from "./ContextAuthority";
import { LifecycleLabel } from "./LifecycleLabel";

/** Agent details: the specialist job, its current state, connected systems, authority and outcome. */
export function AgentDetailsDrawer({ isOpen, onDismiss }: { isOpen: boolean; onDismiss: () => void }) {
  const [contractId, setContractId] = useState<string | null>(null);
  const state = useModel((services, asOf) => {
    const profile = agentProfile(services.repos, asOf);
    const selected = services.repos.config.contract(contractId ?? profile.contracts[0]?.id ?? "") ?? services.repos.config.contracts()[0]!;
    return { profile, authority: contextAndAuthority(services.repos, selected), selectedId: selected.id };
  }, [contractId]);

  return (
    <Drawer isOpen={isOpen} onDismiss={onDismiss} accessibilityLabel="Agent details">
      <DrawerHeader title="Payment Integrity Agent" subtitle="Agent Studio worker" />
      <DrawerBody>
        {state.status !== "ready" ? null : (
          <Box display="flex" flexDirection="column" gap="spacing.6">
            <Box display="flex" flexDirection="column" gap="spacing.2">
              <RayIdentity label="Specialist worker" />
              <Text size="medium">{state.model.profile.purpose}</Text>
              <LifecycleLabel lifecycle={state.model.profile.lifecycle} showReason />
            </Box>
            <MetaList
              minColumnWidth={200}
              items={[
                { label: "Permission mode", value: state.model.profile.permissionMode.label, help: state.model.profile.permissionMode.detail },
                { label: state.model.profile.outcomeMetric.label, value: state.model.profile.outcomeMetric.value, help: state.model.profile.outcomeMetric.detail },
                { label: state.model.profile.verifiedOutcomes.label, value: state.model.profile.verifiedOutcomes.value, help: state.model.profile.verifiedOutcomes.detail },
              ]}
            />
            <Box display="flex" flexDirection="column" gap="spacing.2">
              <Heading as="h3" size="small" weight="semibold">Connected systems</Heading>
              {state.model.profile.connected.map((c) => (
                <Box key={c.name} display="flex" justifyContent="space-between" gap="spacing.4">
                  <Text size="small">{c.name}</Text>
                  <Text size="small" color="surface.text.gray.muted">{c.access}</Text>
                </Box>
              ))}
            </Box>
            <Divider />
            <Box display="flex" flexDirection="column" gap="spacing.4">
              <Heading as="h3" size="small" weight="semibold">Context &amp; authority</Heading>
              <ChipGroup label="Outcome Contract" selectionType="single" value={state.model.selectedId} onChange={({ values }) => setContractId(values[0] ?? null)}>
                {state.model.profile.contracts.map((c) => (
                  <Chip key={c.id} value={c.id}>{c.name}</Chip>
                ))}
              </ChipGroup>
              <ContextAuthorityView model={state.model.authority} headingLevel="h3" />
            </Box>
          </Box>
        )}
      </DrawerBody>
    </Drawer>
  );
}
