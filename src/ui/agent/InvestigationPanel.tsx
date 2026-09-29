"use client";

import {
  Box,
  Button,
  CheckIcon,
  Code,
  Collapsible,
  CollapsibleBody,
  CollapsibleLink,
  Divider,
  HelpCircleIcon,
  MinusCircleIcon,
  RefreshIcon,
  Text,
  useToast,
} from "@razorpay/blade/components";
import { Fragment, useState } from "react";
import { formatIstShort } from "@/domain/time";
import type { InvestigationProgress } from "@/services/agent";
import type { InvestigationProduction, InvestigationView } from "@/services/views/investigation";
import { MetaList } from "@/ui/components/MetaList";
import { RayInsight } from "@/ui/ray/RayInsight";
import { RayProgress } from "@/ui/ray/RayProgress";
import { RaySurface } from "@/ui/ray/RaySurface";

const VERDICTS = {
  supported: { label: "Supported", icon: CheckIcon },
  ruled_out: { label: "Ruled out", icon: MinusCircleIcon },
  inconclusive: { label: "Inconclusive", icon: HelpCircleIcon },
} as const;

function Production({ production, subject, now }: { production: InvestigationProduction; subject: "case" | "incident"; now: Date }) {
  const { hypotheses } = production;
  const evaluated = hypotheses.supported + hypotheses.ruled_out + hypotheses.inconclusive;
  return (
    <Collapsible>
      <CollapsibleLink size="small">How this investigation was produced</CollapsibleLink>
      <CollapsibleBody>
        <Box display="flex" flexDirection="column" gap="spacing.5" paddingTop="spacing.3">
          <MetaList
            minColumnWidth={160}
            items={[
              { label: "Result", value: production.resultLabel },
              { label: "Investigated", value: `${formatIstShort(production.at, now)} IST` },
              { label: "Events examined", value: production.eventsExamined.toLocaleString("en-IN") },
              {
                label: "Sources used",
                value: production.sources.length > 0 ? production.sources.map((s) => `${s.label} (${s.count})`).join(", ") : "Not recorded",
              },
              ...(production.casesCompared !== undefined ? [{ label: "Cases compared", value: production.casesCompared.toLocaleString("en-IN") }] : []),
              { label: "Service health", value: production.serviceHealth ?? "Not recorded" },
              {
                label: "Causes evaluated",
                value: evaluated === 0 ? "None recorded" : `${evaluated}: ${hypotheses.supported} supported, ${hypotheses.ruled_out} ruled out, ${hypotheses.inconclusive} inconclusive`,
              },
              { label: "Citations checked", value: production.citationsChecked.toLocaleString("en-IN") },
              {
                label: "Citations removed",
                value: production.citationsRemoved.length === 0 ? "None" : `${production.citationsRemoved.length} (${production.citationsRemoved.join(", ")})`,
              },
            ]}
          />
          {production.stages.length > 0 ? <RayProgress stages={production.stages} subject={subject} pending={false} /> : null}
          <Text size="xsmall" color="surface.text.gray.muted">
            Stages record operations that ran and what they found. The investigator&apos;s private reasoning is not stored or shown.
          </Text>
        </Box>
      </CollapsibleBody>
    </Collapsible>
  );
}

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
  onReinvestigate?: (onProgress: (p: InvestigationProgress) => void) => Promise<{ status: "valid" | "invalid" | "unavailable" }>;
  subject: "case" | "incident";
}) {
  const toast = useToast();
  const [progress, setProgress] = useState<InvestigationProgress[] | null>(null);
  const running = progress !== null && !progress.some((p) => p.step === "preparing");

  const run = async () => {
    if (!onReinvestigate) return;
    setProgress([]);
    try {
      const result = await onReinvestigate((p) => setProgress((current) => [...(current ?? []), p]));
      if (result.status === "valid") {
        toast.show({ color: "positive", content: `Investigation of this ${subject} updated.` });
        // The stored run now carries these stages; show them in the disclosure instead.
        setTimeout(() => setProgress(null), 1500);
      } else {
        toast.show({ color: "notice", content: "The investigator's output could not be used. Escalation prepared for manual review." });
      }
    } catch {
      toast.show({ color: "notice", content: "The investigation could not be completed. Previous findings are unchanged." });
      setProgress(null);
    }
  };

  const runInfo = view?.run;

  return (
    <RaySurface
      id="investigation"
      title="Investigation"
      description={runInfo ? `Investigated ${formatIstShort(runInfo.at, now)} IST` : undefined}
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
          <div role="status" aria-live="polite">
            <RayProgress stages={progress} subject={subject} pending />
          </div>
        </Box>
      ) : null}

      {!view ? (
        <Text size="small" color="surface.text.gray.muted">
          No investigation yet. The outcome is still within its normal processing time.
        </Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="spacing.5">
          <RayInsight validated={(runInfo?.status ?? "valid") === "valid"} {...(runInfo ? { citations: runInfo.citationsChecked } : {})}>
            <Text size="small" color="surface.text.gray.muted">Likely cause · {Math.round(view.confidence * 100)}% confidence</Text>
            <Text size="medium" weight="semibold">{view.likelyCause}</Text>
          </RayInsight>

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

          {runInfo && runInfo.status !== "valid" ? (
            <Text size="xsmall" color="surface.text.gray.muted">
              {runInfo.status === "unavailable"
                ? "Automated investigation unavailable. Deterministic detection remains active; escalation is recommended."
                : "The investigation output could not be used, so escalation is recommended."}
            </Text>
          ) : null}
          {view.production ? <Production production={view.production} subject={subject} now={now} /> : null}
        </Box>
      )}
    </RaySurface>
  );
}
