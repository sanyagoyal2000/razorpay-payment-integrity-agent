"use client";

import { Box, SparklesIcon, Text } from "@razorpay/blade/components";
import { RAY } from "./theme";

/**
 * Marks content produced or assisted by the AI layer. Always shows the word
 * "RAY" beside the mark, so AI involvement is never signalled by colour alone.
 */
export function RayIdentity({ label, name = "RAY", tone = "light", size = "small" }: { label?: string; name?: string; tone?: "light" | "dark"; size?: "xsmall" | "small" }) {
  return (
    <Box display="inline-flex" alignItems="center" gap="spacing.2">
      <SparklesIcon size={size === "xsmall" ? "small" : "medium"} color={tone === "dark" ? RAY.accentIconOnDark : RAY.accentIcon} />
      <Text size={size} weight="semibold" color={tone === "dark" ? RAY.accentOnDark : RAY.accent}>
        {label ? `${name} · ${label}` : name}
      </Text>
    </Box>
  );
}
