"use client";

import { Box, Text } from "@razorpay/blade/components";
import type { IncidentWorkspaceModel } from "@/services/views/incidents";
import { MetaList } from "@/ui/components/MetaList";
import { Surface } from "@/ui/components/Surface";

export function WhatHappened({ model }: { model: IncidentWorkspaceModel }) {
  return (
    <Surface title="What happened">
      <Text size="medium">{model.whatHappened}</Text>
      {/* Likely cause, confidence and the technical contract definition are on the other tabs. */}
      <Box marginTop="spacing.5">
        <MetaList
          minColumnWidth={200}
          items={[
            { label: "Expected outcome", value: model.intent.expectedOutcome },
            { label: "Verified through", value: model.intent.verifiedThrough },
          ]}
        />
      </Box>
    </Surface>
  );
}
