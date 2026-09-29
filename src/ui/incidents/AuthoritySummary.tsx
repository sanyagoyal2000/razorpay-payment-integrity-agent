"use client";

import { Box, Button, Drawer, DrawerBody, DrawerHeader, Text } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RecoveryAuthority } from "@/services/views/incidentDecision";
import { PolicyVerdictSection } from "@/ui/cases/PolicyVerdictSection";
import { Surface } from "@/ui/components/Surface";
import { AGENT_PATH, caseHref } from "@/ui/shell/nav";
import { AppLink } from "@/ui/components/AppLink";

/** Compact, incident-specific authority. The full matrix lives on Agent details. */
export function AuthoritySummary({ authority }: { authority: RecoveryAuthority }) {
  const router = useRouter();
  const [checksOpen, setChecksOpen] = useState(false);
  const preview = authority.policyPreview;
  return (
    <Surface id="context-authority" title="Authority for this recovery">
      <Box display="flex" flexDirection="column" gap="spacing.4">
        <Text size="small">{authority.summary.join(" · ")}.</Text>
        <Box display="flex" flexWrap="wrap" gap="spacing.3">
          <Button variant="secondary" size="small" onClick={() => router.push(`${AGENT_PATH}?contract=${authority.contractId}#context-authority`)}>View permissions</Button>
          {preview ? <Button variant="tertiary" size="small" onClick={() => setChecksOpen(true)}>View policy checks</Button> : null}
        </Box>
      </Box>
      {preview ? (
        <Drawer isOpen={checksOpen} onDismiss={() => setChecksOpen(false)} accessibilityLabel="Policy checks">
          <DrawerHeader title="Policy checks" subtitle={`Current deterministic checks for ${preview.caseId}`} />
          <DrawerBody>
            <Box display="flex" flexDirection="column" gap="spacing.4">
              <Text size="small" color="surface.text.gray.subtle">
                Evaluated now for a representative case in the recommended group. Every case is checked again immediately before its action runs.
              </Text>
              <PolicyVerdictSection verdict={preview.verdict} actionLabel={preview.actionLabel} refusal={false} />
              <AppLink href={caseHref(preview.caseId)} size="small">{`Open ${preview.caseId}`}</AppLink>
            </Box>
          </DrawerBody>
        </Drawer>
      ) : null}
    </Surface>
  );
}
