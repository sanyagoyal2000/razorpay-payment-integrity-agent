"use client";

import { Box, Text } from "@razorpay/blade/components";
import type { IncidentWorkspaceModel } from "@/services/views/incidents";
import { Surface } from "@/ui/components/Surface";

export function WhatHappened({ model }: { model: IncidentWorkspaceModel }) {
  return (
    <Surface title="What happened">
      <Text size="medium">{model.whatHappened}</Text>
      {model.likelyCause ? (
        <Box marginTop="spacing.5" display="grid" gridTemplateColumns="140px 1fr" rowGap="spacing.3" columnGap="spacing.4">
          <Text size="small" color="surface.text.gray.muted">Likely cause</Text>
          <Text size="small">{model.likelyCause}</Text>
          {model.rootCauseConfidence !== undefined ? (
            <>
              <Text size="small" color="surface.text.gray.muted">Confidence</Text>
              <Text size="small">
                {Math.round(model.rootCauseConfidence * 100)}%, based on the evidence below
              </Text>
            </>
          ) : null}
          <Text size="small" color="surface.text.gray.muted">Merchant intent</Text>
          <Text size="small">
            {model.contract.name}: {model.contract.expectedOutcome} within {model.contract.deadlineSeconds / 60} minutes
          </Text>
        </Box>
      ) : null}
    </Surface>
  );
}
