"use client";

import { StepGroup, StepItem, StepItemIndicator } from "@razorpay/blade/components";
import type { InvestigationStage } from "@/domain/types";
import { STAGE_ORDER, stageTitle } from "@/services/agent/progress";
import { RAY_VALUES } from "./theme";

/** Mint marker for a completed investigation stage: AI work done, not a success verdict. */
function CompletedMarker() {
  return (
    <span
      aria-hidden
      style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: RAY_VALUES.accentIcon, boxShadow: `0 0 0 3px ${RAY_VALUES.surfaceSubtle}` }}
    />
  );
}

const PREFIX: Record<InvestigationStage["status"], string> = { complete: "Done", failed: "Failed", skipped: "Skipped" };

/**
 * Observable investigation stages. Each stage states its status in words, so
 * progress is never conveyed by colour alone; the mint marker identifies
 * completed AI work, amber a failed stage, grey a skipped one.
 */
export function RayProgress({ stages, subject, pending }: { stages: InvestigationStage[]; subject: "case" | "incident"; pending: boolean }) {
  return (
    <StepGroup orientation={pending ? "horizontal" : "vertical"} size="medium">
      {STAGE_ORDER.map((step, index) => {
        const reached = stages.find((s) => s.step === step);
        const current = pending && !reached && index === stages.length;
        return (
          <StepItem
            key={step}
            title={stageTitle(step, subject)}
            {...(reached ? { description: `${PREFIX[reached.status]}: ${reached.detail}` } : current ? { description: "In progress" } : {})}
            stepProgress={reached ? "full" : current ? "start" : "none"}
            isDisabled={!reached && !current}
            marker={
              reached?.status === "complete" ? (
                <CompletedMarker />
              ) : (
                <StepItemIndicator color={reached ? (reached.status === "failed" ? "notice" : "neutral") : current ? "information" : "neutral"} />
              )
            }
          />
        );
      })}
    </StepGroup>
  );
}
