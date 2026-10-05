"use client";

import { Box, Text } from "@razorpay/blade/components";
import { formatIstShort, istTime } from "@/domain/time";
import type { IncidentWorkspaceModel } from "@/services/views/incidents";
import { MetaList } from "@/ui/components/MetaList";
import { Surface } from "@/ui/components/Surface";

export function WhatHappened({ model, now }: { model: IncidentWorkspaceModel; now: Date }) {
  const failures = model.failureWindow;
  const range = (from?: string, to?: string) => (from && to ? `${formatIstShort(from, now)} to ${istTime(to).slice(0, 5)} IST` : "Not recorded");
  return (
    <Surface title="What happened">
      <Text size="medium">{model.whatHappened}</Text>
      <Text size="small" color="surface.text.gray.subtle" marginTop="spacing.3">{failures.summary}</Text>
      {/* Likely cause, confidence and the technical contract definition are on the other tabs. */}
      <Box marginTop="spacing.5">
        <MetaList
          minColumnWidth={200}
          items={[
            { label: "Expected outcome", value: model.intent.expectedOutcome },
            { label: "Verified through", value: model.intent.verifiedThrough },
            { label: "Fulfilment failures", value: range(failures.firstFailureAt, failures.lastFailureAt) },
            { label: "Cases opened", value: range(failures.firstCaseOpenedAt, failures.lastCaseOpenedAt) },
          ]}
        />
      </Box>
    </Surface>
  );
}
