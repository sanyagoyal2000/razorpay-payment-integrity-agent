"use client";

import { Box, Text } from "@razorpay/blade/components";
import type { ReactNode } from "react";
import { RayIdentity } from "./RayIdentity";
import { RAY } from "./theme";

/**
 * A finding from the investigator. "Evidence-validated" appears only when the
 * output passed validation; otherwise the insight says it was not usable.
 */
export function RayInsight({ validated, citations, children }: { validated: boolean; citations?: number; children: ReactNode }) {
  return (
    <Box backgroundColor={RAY.surfaceSubtle} borderRadius="medium" padding="spacing.4" display="flex" flexDirection="column" gap="spacing.2">
      <Box display="flex" alignItems="center" gap="spacing.3" flexWrap="wrap">
        <RayIdentity label={validated ? "Evidence-validated finding" : "Finding not validated"} size="xsmall" />
        {validated && citations !== undefined ? (
          <Text size="xsmall" color="surface.text.gray.muted">
            {citations} {citations === 1 ? "citation" : "citations"} checked
          </Text>
        ) : null}
      </Box>
      {children}
    </Box>
  );
}
