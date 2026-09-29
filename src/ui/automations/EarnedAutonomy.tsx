"use client";

import {
  Box,
  Button,
  CheckIcon,
  CloseIcon,
  Heading,
  Indicator,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Text,
  useToast,
} from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ActionMode } from "@/domain/types";
import { formatINR } from "@/domain/money";
import { formatIstShort } from "@/domain/time";
import { OPERATOR } from "@/fixtures/catalogue";
import { explainEarnedAutonomy, type CheckedAutonomyExplanation } from "@/services/agent";
import type { AppServices } from "@/services/container";
import { ConfigurationError, keepReviewFirst, switchOnEarnedAutomation, type AutonomyAssessment } from "@/services/configuration";
import { POLICY_ACTION_LABELS } from "@/services/policy/actions";
import { CASE_TYPE_LABELS } from "@/services/views/overview";
import type { CaseListRequest } from "@/ui/components/CaseListDrawer";
import { MetaList } from "@/ui/components/MetaList";
import { Surface } from "@/ui/components/Surface";
import { RayIdentity } from "@/ui/ray/RayIdentity";
import { BASE_PATH } from "@/ui/shell/nav";

const ACTION = "retry_provisioning" as const;

function Figure({ label, value, detail, onView }: { label: string; value: string; detail: string; onView?: () => void }) {
  return (
    <Box padding="spacing.4" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" display="flex" flexDirection="column" gap="spacing.1">
      <Text size="small" color="surface.text.gray.muted">{label}</Text>
      <Heading as="span" size="medium" weight="semibold">{value}</Heading>
      <Text size="xsmall" color="surface.text.gray.subtle">{detail}</Text>
      {onView ? (
        <Box>
          <Button variant="tertiary" size="xsmall" accessibilityLabel={`View cases: ${label}`} onClick={onView}>View cases</Button>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Earned autonomy: whether retry provisioning may run with less review.
 * Fixed criteria over verified outcomes decide; the agent only explains.
 */
export function EarnedAutonomy({
  services,
  assessment,
  currentMode,
  asOf,
  now,
  onShowCases,
}: {
  services: AppServices;
  assessment: AutonomyAssessment;
  currentMode: ActionMode;
  asOf: string;
  now: Date;
  onShowCases: (request: CaseListRequest) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const { evidence, eligibility } = assessment;
  const [explanation, setExplanation] = useState<CheckedAutonomyExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const load = (refresh = false) => {
    setLoading(true);
    explainEarnedAutonomy(services, ACTION, asOf, refresh)
      .then(setExplanation)
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), [services, evidence.executed, evidence.wrongActions, evidence.verifiedSuccessful]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (title: string, explanationText: string, caseIds: string[]) => () => onShowCases({ title, explanation: explanationText, caseIds });
  const window = evidence.evaluationWindow;
  const suggestion = eligibility.suggestion;
  const alreadyOn = currentMode === "automatic_below_threshold";

  const switchOn = () => {
    try {
      switchOnEarnedAutomation(services.repos, ACTION, OPERATOR.name, new Date().toISOString());
      toast.show({ color: "positive", content: `${POLICY_ACTION_LABELS[ACTION]} now runs automatically within the confirmed limits.` });
      setConfirming(false);
    } catch (error) {
      toast.show({ color: "negative", content: error instanceof ConfigurationError ? error.message : "The setting could not be changed." });
      setConfirming(false);
    }
  };
  const keep = () => {
    keepReviewFirst(services.repos, ACTION, OPERATOR.name, new Date().toISOString());
    toast.show({ color: "information", content: `${POLICY_ACTION_LABELS[ACTION]} stays review-first. Recorded in the audit log.` });
    setDismissed(true);
  };

  return (
    <Surface
      id="earned-autonomy"
      title="Earned autonomy"
      description="Automation is earned through verified customer outcomes, not approvals alone. Payment Integrity suggests; only you can change a setting."
      actions={
        <Button variant="tertiary" size="small" onClick={() => router.push(`${BASE_PATH}/developer/evaluations`)}>
          View evaluation evidence
        </Button>
      }
    >
      <Box display="flex" flexDirection="column" gap="spacing.6">
        <Box display="flex" flexDirection="column" gap="spacing.2">
          <Box display="flex" alignItems="center" gap="spacing.2">
            <Indicator color={eligibility.eligible ? "positive" : "notice"} emphasis="intense" size="medium" accessibilityLabel="" />
            <Text size="small" weight="semibold" color="surface.text.gray.subtle">{eligibility.eligible ? "Eligible for limited automation" : "Not eligible for automation"}</Text>
          </Box>
          <Heading as="h3" size="small" weight="semibold">{eligibility.headline}</Heading>
          <Box maxWidth="760px">
            <Text size="small">{eligibility.summary}</Text>
          </Box>
        </Box>

        <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))" gap="spacing.4">
          <Figure
            label="Approved without edits"
            value={`${evidence.approvedWithoutEdits} of ${evidence.recommendationsReviewed}`}
            detail="Recent recommendations you reviewed. Agreement only; not counted as success."
            {...(evidence.approvedCaseIds.length > 0 ? { onView: show("Approved without edits", "Recommendations you approved without changing them.", evidence.approvedCaseIds) } : {})}
          />
          <Figure
            label="Verified successful outcomes"
            value={`${evidence.verifiedSuccessful} of ${evidence.executed}`}
            detail="Executed actions with a confirmed Outcome Receipt and no later reversal."
            {...(evidence.verifiedCaseIds.length > 0 ? { onView: show("Verified successful outcomes", "Executed actions whose promised outcome was confirmed and never reversed.", evidence.verifiedCaseIds) } : {})}
          />
          <Figure
            label="Wrong or reversed actions"
            value={String(evidence.wrongActions)}
            detail={evidence.failedExecutions > 0 ? `Plus ${evidence.failedExecutions} failed executions.` : "Executed actions later found to be wrong."}
            {...(evidence.wrongActionCaseIds.length + evidence.failedCaseIds.length > 0
              ? { onView: show("Wrong, reversed or failed actions", "Executed actions later reversed or marked wrong, and executions that failed.", [...evidence.wrongActionCaseIds, ...evidence.failedCaseIds]) }
              : {})}
          />
          <Figure
            label="Evaluation window"
            value={window ? `${formatIstShort(window.from, now)} to ${formatIstShort(window.to, now)}` : "No executions"}
            detail={`The last ${evidence.windowSize} executed actions (${evidence.executed} found).`}
          />
        </Box>

        <Box>
          <Text size="small" weight="semibold" marginBottom="spacing.3">Criteria</Text>
          <Box display="flex" flexDirection="column" gap="spacing.3">
            {eligibility.criteria.map((c) => (
              <Box key={c.id} display="grid" gridTemplateColumns="20px 1fr" columnGap="spacing.3">
                <Box paddingTop="spacing.1">
                  {c.met ? <CheckIcon size="small" color="feedback.icon.positive.intense" /> : <CloseIcon size="small" color="feedback.icon.negative.intense" />}
                </Box>
                <Box>
                  <Text size="small" weight="medium">
                    {c.label}: {c.met ? "met" : "not met"}
                  </Text>
                  <Text size="xsmall" color="surface.text.gray.subtle">{c.detail}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        {eligibility.eligible && suggestion && !alreadyOn && !dismissed ? (
          <Box display="flex" flexWrap="wrap" gap="spacing.3">
            <Button variant="primary" onClick={() => setConfirming(true)}>Review and switch on</Button>
            <Button variant="secondary" onClick={() => document.getElementById("global-controls")?.scrollIntoView({ block: "start" })}>Change limits</Button>
            <Button variant="tertiary" onClick={keep}>Keep review-first</Button>
            <Button variant="tertiary" onClick={() => setDismissed(true)}>Not now</Button>
          </Box>
        ) : eligibility.eligible && alreadyOn ? (
          <Text size="small" color="surface.text.gray.muted">Limited automation is on. The kill switch above stops it immediately.</Text>
        ) : null}

        <Box borderTopWidth="thin" borderTopColor="surface.border.gray.muted" paddingTop="spacing.5" display="flex" flexDirection="column" gap="spacing.3">
          <Box display="flex" justifyContent="space-between" alignItems="center" gap="spacing.3">
            <Box>
              <RayIdentity label="Agent's explanation" />
              <Text size="xsmall" color="surface.text.gray.muted">Explains the evidence. It cannot change the decision above.</Text>
            </Box>
            <Button variant="tertiary" size="small" onClick={() => load(true)} isDisabled={loading}>Review again</Button>
          </Box>
          {loading || !explanation ? (
            <Box display="flex" alignItems="center" gap="spacing.3">
              <Spinner accessibilityLabel="Reviewing the evidence" size="medium" />
              <Text size="small" color="surface.text.gray.subtle">Reviewing the evidence</Text>
            </Box>
          ) : (
            <>
              <Text size="small" weight="medium">{explanation.headline}</Text>
              <Text size="small" color="surface.text.gray.subtle">{explanation.explanation}</Text>
              <Box display="flex" flexDirection="column" gap="spacing.2">
                {explanation.risks.map((r) => (
                  <Box key={r} paddingLeft="spacing.4" borderLeftWidth="thick" borderLeftColor="surface.border.gray.normal">
                    <Text size="small">{r}</Text>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
      </Box>

      <Modal isOpen={confirming} onDismiss={() => setConfirming(false)} size="medium" accessibilityLabel="Switch on limited automation">
        <ModalHeader title="Switch on limited automation?" />
        <ModalBody>
          {suggestion ? (
            <Box display="flex" flexDirection="column" gap="spacing.4">
              <MetaList
                minColumnWidth={200}
                items={[
                  { label: "Action", value: POLICY_ACTION_LABELS[ACTION] },
                  { label: "Outcome Contracts", value: suggestion.contracts.map((c) => c.name).join(", ") },
                  { label: "Maximum value", value: formatINR(suggestion.maxValue) },
                  { label: "Minimum confidence", value: `${Math.round(suggestion.minimumConfidence * 100)}%` },
                  { label: "Always require review", value: suggestion.alwaysReviewCaseTypes.map((t) => CASE_TYPE_LABELS[t]).join(", ") },
                  { label: "Required permissions", value: suggestion.requiredPermissions.join(", ") },
                  { label: "Kill switch", value: "Available on this page; stops every automated action immediately." },
                  {
                    label: "Supporting sample",
                    value: `${evidence.verifiedSuccessful} of ${evidence.executed} executed actions verified; ${evidence.wrongActions} wrong`,
                    ...(window ? { help: `${formatIstShort(window.from, now)} to ${formatIstShort(window.to, now)}` } : {}),
                  },
                ]}
              />
              <Text size="small" weight="medium">Refunds and inventory conflicts remain review-only.</Text>
              <Text size="xsmall" color="surface.text.gray.muted">Policy is still checked before every action. Recorded in the audit log.</Text>
            </Box>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" onClick={switchOn}>Switch on</Button>
          </Box>
        </ModalFooter>
      </Modal>
    </Surface>
  );
}
