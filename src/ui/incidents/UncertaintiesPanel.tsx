"use client";

import { Box, Text } from "@razorpay/blade/components";
import { Surface } from "@/ui/components/Surface";

export function UncertaintiesPanel({ uncertainties }: { uncertainties: string[] }) {
  return (
    <Surface title="Uncertainties" description="What the system cannot safely infer">
      {uncertainties.length === 0 ? (
        <Text size="small" color="surface.text.gray.muted">No open uncertainties.</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="spacing.3">
          {uncertainties.map((u) => (
            <Box key={u} paddingLeft="spacing.4" borderLeftWidth="thick" borderLeftColor="surface.border.gray.normal">
              <Text size="small">{u}</Text>
            </Box>
          ))}
          <Text size="xsmall" color="surface.text.gray.muted">Cases affected by these questions are excluded from bulk recovery and need individual review.</Text>
        </Box>
      )}
    </Surface>
  );
}
