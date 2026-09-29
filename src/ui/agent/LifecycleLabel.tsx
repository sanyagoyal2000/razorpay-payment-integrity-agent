"use client";

import { Box, Indicator, Text } from "@razorpay/blade/components";
import type { AgentState, Lifecycle } from "@/services/lifecycle";
import { RAY_VALUES } from "@/ui/ray/theme";

/** Operational colour for each state; investigating is AI work, so it uses the RAY mark instead. */
const COLOR: Record<Exclude<AgentState, "investigating">, "positive" | "notice" | "negative" | "information" | "neutral"> = {
  monitoring: "neutral",
  awaiting_approval: "notice",
  executing: "information",
  verifying_outcome: "information",
  resolved: "positive",
  blocked: "negative",
};

/** The agent's lifecycle state in words, with a marker. Supporting context, never the headline. */
export function LifecycleLabel({ lifecycle, showReason = false }: { lifecycle: Lifecycle; showReason?: boolean }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1">
      <Box display="inline-flex" alignItems="center" gap="spacing.2">
        {lifecycle.state === "investigating" ? (
          <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: RAY_VALUES.accentIcon }} />
        ) : (
          <Indicator color={COLOR[lifecycle.state]} emphasis="intense" size="small" accessibilityLabel="" />
        )}
        <Text size="small" weight="semibold">Agent: {lifecycle.label}</Text>
      </Box>
      {showReason ? <Text size="xsmall" color="surface.text.gray.muted">{lifecycle.reason}</Text> : null}
    </Box>
  );
}
