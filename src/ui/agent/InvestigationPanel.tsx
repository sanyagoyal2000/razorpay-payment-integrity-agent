"use client";

import {
  Box,
  Button,
  CheckIcon,
  Code,
  Divider,
  HelpCircleIcon,
  MinusCircleIcon,
  RefreshIcon,
  StepGroup,
  StepItem,
  StepItemIndicator,
  Text,
  useToast,
} from "@razorpay/blade/components";
import { Fragment, useState } from "react";
import { formatIstShort } from "@/domain/time";
import type { InvestigationProgress, InvestigationStep } from "@/services/agent";
import type { InvestigationView } from "@/services/views/investigation";
import { Surface } from "@/ui/components/Surface";

const VERDICTS = {
  supported: { label: "Supported", icon: CheckIcon },
  ruled_out: { label: "Ruled out", icon: MinusCircleIcon },
  inconclusive: { label: "Inconclusive", icon: HelpCircleIcon },
} as const;

const STEPS: Array<{ step: InvestigationStep; title: string }> = [
  { step: "gathering", title: "Collect evidence" },
  { step: "reviewing", title: "Weigh possible causes" },
  { step: "checking", title: "Check every citation" },
  { step: "done", title: "Update recommendation" },
];

/**
 * The Payment Integrity Agent's investigation: what it examined, the causes it
 * weighed with the evidence for each, and how its citations were checked.
 */
export function InvestigationPanel({
  view,
  now,
  onReinvestigate,
  subject,
}: {
  view: InvestigationView | undefined;
  now: Date;
  onReinvestigate?: (onProgress: (p: InvestigationProgress) => void) => Promise<unknown>;
  subject: "case" | "incident";
}) {
  const toast = useToast();
  const [progress, setProgress] = useState<InvestigationProgress[] | null>(null);
  const running = progress !== null && !progress.some((p) => p.step === "done");

  const run = async () => {
    if (!onReinvestigate) return;
    setProgress([]);
    try {
      await onReinvestigate((p) => setProgress((current) => [...(current ?? []), p]));
      toast.show({ color: "positive", content: `Investigation of this ${subject} updated.` });
    } catch {
      toast.show({ color: "notice", content: "The investigation could not be completed. Previous findings are unchanged." });
    } finally {
      setTimeout(() => setProgress(null), 1500);
    }
  };

  const runInfo = view?.run;
  const sources = runInfo ? Object.entries(runInfo.sources).map(([source, n]) => `${source} (${n})`).join(", ") : "";

  return (
    <Surface
      title="Investigation"
      description={
        runInfo
          ? `By Payment Integrity Agent · ${formatIstShort(runInfo.at, now)} · ${runInfo.eventsExamined} events examined from ${sources}`
          : "By Payment Integrity Agent"
      }
      actions={
        onReinvestigate ? (
          <Button variant="secondary" size="small" icon={RefreshIcon} isLoading={running} isDisabled={running} onClick={run}>
            Re-investigate
          </Button>
        ) : undefined
      }
    >
      {progress !== null ? (
        <Box marginBottom="spacing.5">
          <StepGroup orientation="horizontal" size="medium">
            {STEPS.map(({ step, title }, index) => {
              const reached = progress.find((p) => p.step === step);
              const current = !reached && index === progress.length;
              return (
                <StepItem
                  key={step}
                  title={title}
                  {...(reached ? { description: reached.detail } : current ? { description: "In progress" } : {})}
                  stepProgress={reached ? "full" : current ? "start" : "none"}
                  isDisabled={!reached && !current}
                  marker={<StepItemIndicator color={reached ? "positive" : current ? "information" : "neutral"} />}
                />
              );
            })}
          </StepGroup>
        </Box>
      ) : null}

      {!view ? (
        <Text size="small" color="surface.text.gray.muted">
          No investigation yet. The outcome is still within its normal processing time.
        </Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="spacing.5">
          <Box>
            <Text size="small" color="surface.text.gray.muted">Likely cause · {Math.round(view.confidence * 100)}% confidence</Text>
            <Text size="medium" weight="semibold">{view.likelyCause}</Text>
          </Box>

          {view.hypotheses.length > 0 ? (
            <Box>
              <Text size="small" weight="semibold" marginBottom="spacing.2">Causes considered</Text>
              <Box borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium">
                {view.hypotheses.map((h, index) => {
                  const { label, icon: Icon } = VERDICTS[h.verdict];
                  return (
                    <Fragment key={`${h.cause}-${index}`}>
                      {index > 0 ? <Divider /> : null}
                      <Box display="grid" gridTemplateColumns="16px 1fr" columnGap="spacing.3" padding="spacing.4">
                        <Box paddingTop="spacing.1">
                          <Icon size="small" color={h.verdict === "supported" ? "surface.icon.gray.normal" : "surface.icon.gray.muted"} />
                        </Box>
                        <Box display="flex" flexDirection="column" gap="spacing.1">
                          <Box display="flex" justifyContent="space-between" gap="spacing.3">
                            <Text size="small" weight={h.verdict === "supported" ? "semibold" : "regular"}>{h.cause}</Text>
                            <Text size="xsmall" weight="semibold" color="surface.text.gray.subtle">{label}</Text>
                          </Box>
                          <Text size="xsmall" color="surface.text.gray.subtle">{h.reasoning}</Text>
                          {h.evidence.length > 0 ? (
                            <Box display="flex" flexWrap="wrap" gap="spacing.2" marginTop="spacing.1">
                              {h.evidence.map((e) => (
                                <Box key={e.id} display="flex" alignItems="center" gap="spacing.1">
                                  <Code size="small">{e.id}</Code>
                                  <Text size="xsmall" color="surface.text.gray.muted">{e.title}</Text>
                                </Box>
                              ))}
                            </Box>
                          ) : (
                            <Text size="xsmall" color="surface.text.gray.muted">No evidence cited</Text>
                          )}
                        </Box>
                      </Box>
                    </Fragment>
                  );
                })}
              </Box>
            </Box>
          ) : null}

          {runInfo ? (
            <Text size="xsmall" color="surface.text.gray.muted">
              {runInfo.status === "valid"
                ? `${runInfo.citationsChecked} citations checked against recorded events; ${runInfo.citationsRemoved.length === 0 ? "none removed" : `${runInfo.citationsRemoved.length} removed (${runInfo.citationsRemoved.join(", ")})`}. The agent proposes; policy and you decide.`
                : runInfo.status === "unavailable"
                  ? "Automated investigation unavailable. Deterministic detection remains active; escalation is recommended."
                  : "The investigation output could not be used, so escalation is recommended."}
            </Text>
          ) : null}
        </Box>
      )}
    </Surface>
  );
}
