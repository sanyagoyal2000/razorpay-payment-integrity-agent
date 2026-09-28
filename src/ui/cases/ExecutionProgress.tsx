"use client";

import { Box, StepGroup, StepItem, StepItemIndicator, Text } from "@razorpay/blade/components";
import type { Execution, ExecutionState } from "@/domain/types";
import { istTime } from "@/domain/time";
import { EXECUTION_STATES } from "@/services/execution";

const LABELS: Record<ExecutionState, string> = {
  approval_recorded: "Approval recorded",
  policy_rechecking: "Policy re-checked",
  idempotency_reserved: "Idempotency key reserved",
  action_started: "Action started",
  awaiting_outcome: "Awaiting outcome",
  outcome_verified: "Outcome verified",
  resolved: "Resolved",
};

/** The execution state machine for one approved action, step by step. */
export function ExecutionProgress({ execution }: { execution: Execution }) {
  const reached = new Map(execution.steps.map((s) => [s.state, s]));
  const terminal = execution.steps.find((s) => s.state === "stopped" || s.state === "failed");
  const lastReachedIndex = Math.max(...EXECUTION_STATES.map((state, i) => (reached.has(state) ? i : -1)));
  return (
    <Box>
      <StepGroup orientation="vertical" size="medium">
        {EXECUTION_STATES.map((state, index) => {
          const step = reached.get(state);
          const isCurrent = !terminal && !step && index === lastReachedIndex + 1;
          const failedHere = terminal && index === lastReachedIndex + 1;
          const color = step ? (state === "outcome_verified" || state === "resolved" ? "positive" : "neutral") : failedHere ? "negative" : isCurrent ? "information" : "neutral";
          return (
            <StepItem
              key={state}
              title={failedHere ? (terminal.state === "stopped" ? "Stopped" : "Failed") : LABELS[state]}
              {...(step ? { timestamp: `${istTime(step.at)} IST` } : failedHere ? { timestamp: `${istTime(terminal.at)} IST` } : {})}
              {...(step ? { description: step.detail } : failedHere ? { description: terminal.detail } : isCurrent ? { description: "In progress" } : {})}
              stepProgress={step ? "full" : isCurrent ? "start" : "none"}
              isDisabled={!step && !isCurrent && !failedHere}
              marker={<StepItemIndicator color={color} />}
            />
          );
        })}
      </StepGroup>
      <Text size="xsmall" color="surface.text.gray.muted" marginTop="spacing.2">
        Idempotency key {execution.idempotencyKey}. Approved by {execution.approvedBy}.
      </Text>
    </Box>
  );
}
