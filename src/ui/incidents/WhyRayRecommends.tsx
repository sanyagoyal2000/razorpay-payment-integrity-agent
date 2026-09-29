"use client";

import { Box, CheckIcon, Collapsible, CollapsibleBody, CollapsibleLink, Text } from "@razorpay/blade/components";
import type { AgentContribution } from "@/services/views/agentContribution";
import type { Reason } from "@/services/views/incidentDecision";
import type { CaseListRequest } from "@/ui/components/CaseListDrawer";
import { RaySurface } from "@/ui/ray/RaySurface";
import { ContributionDetails } from "./WhyAgentNeeded";

/**
 * Operational reasons behind the recommendation, each backed by recorded
 * evidence or the current policy evaluation. The fixed-rule versus
 * investigator figures stay one click away.
 */
export function WhyRayRecommends({ reasons, contribution, onShowCases }: { reasons: Reason[]; contribution: AgentContribution; onShowCases: (request: CaseListRequest) => void }) {
  return (
    <RaySurface id="why-ray" identityName="RAY investigation" title="Why RAY recommends this">
      <Box display="flex" flexDirection="column" gap="spacing.5">
        {contribution.notice ? <Text size="small" color="feedback.text.notice.intense">{contribution.notice}</Text> : null}
        <Box display="flex" flexDirection="column" gap="spacing.3">
          {reasons.map((r) => (
            <Box key={r.id} display="grid" gridTemplateColumns="20px 1fr" columnGap="spacing.3">
              <Box paddingTop="spacing.1"><CheckIcon size="small" color="surface.icon.gray.subtle" /></Box>
              <Box>
                <Text size="small">{r.text}</Text>
                {r.evidenceIds.length > 0 ? (
                  <Text size="xsmall" color="surface.text.gray.muted">
                    Based on {r.evidenceIds.length} recorded {r.evidenceIds.length === 1 ? "item" : "items"}
                  </Text>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>
        <Collapsible>
          <CollapsibleLink size="small">See how RAY investigated</CollapsibleLink>
          <CollapsibleBody>
            <Box paddingTop="spacing.3">
              <ContributionDetails contribution={contribution} onShowCases={onShowCases} />
            </Box>
          </CollapsibleBody>
        </Collapsible>
      </Box>
    </RaySurface>
  );
}
