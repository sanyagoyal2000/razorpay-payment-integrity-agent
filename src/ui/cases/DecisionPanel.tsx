"use client";

import {
  Alert,
  Box,
  Button,
  Code,
  Divider,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Text,
  TextArea,
  useToast,
} from "@razorpay/blade/components";
import { useState, type ReactNode } from "react";
import type { ActionType } from "@/domain/types";
import { istTime } from "@/domain/time";
import { OPERATOR } from "@/fixtures/catalogue";
import type { AppServices } from "@/services/container";
import { applyDecision, DecisionError, MIN_REJECTION_REASON, rejectRecommendation, type DecisionOption } from "@/services/decisions";
import { runExecution } from "@/services/execution";
import { ACTIONS } from "@/services/policy/actions";
import type { CaseDetailModel } from "@/services/views/cases";
import { Surface } from "@/ui/components/Surface";
import { ExecutionProgress } from "./ExecutionProgress";
import { PolicyVerdictSection } from "./PolicyVerdictSection";

const OUTCOME_LABELS: Record<string, string> = {
  course_access_granted: "Course access granted",
  booking_confirmed: "Booking confirmed",
  membership_activated: "Membership activated",
  wallet_credited: "Wallet credited",
  plan_upgraded: "Plan upgraded",
};

type Dialog = { kind: "edit" } | { kind: "reject" } | { kind: "escalate" } | { kind: "confirm"; option: DecisionOption } | null;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Text size="small" weight="semibold" marginBottom="spacing.3">{title}</Text>
      {children}
    </Box>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box display="grid" gridTemplateColumns="112px 1fr" columnGap="spacing.3" paddingY="spacing.2">
      <Text size="xsmall" color="surface.text.gray.muted">{label}</Text>
      <Box>{children}</Box>
    </Box>
  );
}

export function DecisionPanel({ model, services }: { model: CaseDetailModel; services: AppServices }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editAction, setEditAction] = useState<ActionType | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { caseData: c, recommendation, primary, verdict, open, refusal } = model;

  const close = () => {
    setDialog(null);
    setError(null);
    setReason("");
    setEditAction("");
  };

  const run = (action: ActionType, note = "") => {
    try {
      const result = applyDecision(services, c.id, action, OPERATOR.name, note);
      close();
      if (result.kind === "execution") {
        void runExecution(services, result.executionId).then((execution) => {
          toast.show(
            execution.status === "resolved"
              ? { color: "positive", content: `${c.id} resolved. ${OUTCOME_LABELS[model.contract.expectedOutcome] ?? "Outcome"} confirmed.` }
              : { color: "notice", content: `${c.id}: ${execution.steps.at(-1)?.detail ?? "execution stopped"}.` },
          );
        });
      } else {
        toast.show({ color: "positive", content: result.message });
      }
    } catch (cause) {
      setError(cause instanceof DecisionError || cause instanceof Error ? cause.message : "The decision could not be recorded.");
    }
  };

  const reject = () => {
    try {
      rejectRecommendation(services.repos, c.id, reason, OPERATOR.name, new Date().toISOString());
      close();
      toast.show({ color: "positive", content: `Recommendation for ${c.id} rejected.` });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The rejection could not be recorded.");
    }
  };

  const outcomeLabel = OUTCOME_LABELS[model.contract.expectedOutcome] ?? model.contract.expectedOutcome;
  const confirmedAt = model.outcome?.event?.occurredAt ?? c.resolution?.resolvedAt;
  const lastDecision = c.decisions.at(-1);
  const primaryRequiresConfirm = primary && (primary.action === "capture" || primary.action === "prepare_refund");

  return (
    <Surface title="Decision">
      <Box display="flex" flexDirection="column" gap="spacing.6">
        {c.status === "resolved" ? (
          <Alert
            color="positive"
            title="Outcome confirmed"
            description={
              c.resolution?.method === "outcome_arrived"
                ? `${outcomeLabel} arrived without intervention at ${confirmedAt ? istTime(confirmedAt) : ""} IST. Payment and merchant outcome are consistent.`
                : `${outcomeLabel} at ${confirmedAt ? istTime(confirmedAt) : ""} IST. Payment and merchant outcome are now consistent.`
            }
            isDismissible={false}
            isFullWidth
          />
        ) : c.status === "rejected" ? (
          <Alert color="neutral" title="Recommendation rejected" description={`${lastDecision?.actor ?? ""}: ${lastDecision?.reason ?? ""}`} isDismissible={false} isFullWidth />
        ) : c.status === "escalated" ? (
          <Alert color="notice" title="Escalated for review" description={lastDecision?.reason ?? "Waiting for a person to decide."} isDismissible={false} isFullWidth />
        ) : refusal ? (
          <Alert
            color="neutral"
            title="No automatic action taken"
            description="The original inventory changed after payment. Completing this booking could create an overbooking. Human review is required."
            isDismissible={false}
            isFullWidth
          />
        ) : c.status === "observing" && c.observation ? (
          <Alert
            color="information"
            title="Observing: within normal processing range"
            description={`The outcome is ${c.observation.observedDelaySeconds} s late, inside this contract's normal range (median ${c.observation.normalRangeSeconds.p50} s, 95th percentile ${c.observation.normalRangeSeconds.p95} s). No action is recommended.`}
            isDismissible={false}
            isFullWidth
          />
        ) : null}

        {model.latestExecution ? (
          <Section title="Execution">
            <ExecutionProgress execution={model.latestExecution} />
          </Section>
        ) : null}

        <Section title="Agent recommendation">
          {recommendation ? (
            <>
              <Row label="Proposed action">
                <Text size="small" weight="semibold">{ACTIONS[recommendation.action].label}</Text>
              </Row>
              <Row label="Summary">
                <Text size="small">{recommendation.summary}</Text>
              </Row>
              <Row label="Confidence">
                <Text size="small">{Math.round(recommendation.confidence * 100)}%</Text>
              </Row>
              <Row label="Evidence">
                {model.evidence.length === 0 ? (
                  <Text size="small" color="surface.text.gray.muted">None cited</Text>
                ) : (
                  <Box display="flex" flexDirection="column" gap="spacing.2">
                    {model.evidence.flatMap((g) => g.items).map((item) => (
                      <Box key={item.id}>
                        <Text size="xsmall">{item.title}</Text>
                        <Code size="small">{item.id}</Code>
                      </Box>
                    ))}
                  </Box>
                )}
              </Row>
              <Row label="Uncertainties">
                {recommendation.uncertainties.length === 0 ? (
                  <Text size="small" color="surface.text.gray.muted">None</Text>
                ) : (
                  recommendation.uncertainties.map((u) => <Text key={u} size="small">{u}</Text>)
                )}
              </Row>
              <Row label="Customer impact">
                <Text size="small">{recommendation.customerImpact}</Text>
              </Row>
              <Row label="If nothing is done">
                <Text size="small">{recommendation.consequenceOfInaction}</Text>
              </Row>
            </>
          ) : (
            <Text size="small" color="surface.text.gray.muted">
              No recommendation. The outcome is still within its normal processing time, so no action is proposed.
            </Text>
          )}
        </Section>

        <Divider />

        <Section title="Policy verdict">
          {open && verdict && primary ? (
            <PolicyVerdictSection verdict={verdict} actionLabel={primary.label} refusal={refusal} />
          ) : model.latestExecution?.verdict ? (
            <>
              <Text size="xsmall" color="surface.text.gray.muted" marginBottom="spacing.2">
                Re-checked at {istTime(model.latestExecution.verdict.evaluatedAt)} IST, immediately before execution.
              </Text>
              <PolicyVerdictSection verdict={model.latestExecution.verdict} actionLabel={ACTIONS[model.latestExecution.action].label} refusal={false} />
            </>
          ) : model.recordedPolicyResult ? (
            <Text size="small" color="surface.text.gray.subtle">
              Last recorded: {model.recordedPolicySummary}. Policy is evaluated again only while a decision is open.
            </Text>
          ) : (
            <Text size="small" color="surface.text.gray.muted">No action to evaluate.</Text>
          )}
        </Section>

        {open ? (
          <>
            <Divider />
            <Section title="Your decision">
              <Box display="flex" flexDirection="column" gap="spacing.3">
                {primary ? (
                  <Box>
                    <Button
                      variant="primary"
                      isFullWidth
                      isDisabled={primary.disabledReason !== undefined}
                      onClick={() => (primaryRequiresConfirm ? setDialog({ kind: "confirm", option: primary }) : run(primary.action))}
                    >
                      {refusal ? "Approve fulfilment" : `Approve: ${primary.label}`}
                    </Button>
                    {primary.disabledReason ? (
                      <Text size="xsmall" color="surface.text.gray.muted" marginTop="spacing.2">{primary.disabledReason}</Text>
                    ) : primary.verdict.result === "allowed" ? null : (
                      <Text size="xsmall" color="surface.text.gray.muted" marginTop="spacing.2">
                        Policy requires your approval. It is checked again immediately before execution.
                      </Text>
                    )}
                  </Box>
                ) : null}

                {refusal ? (
                  <Box display="flex" flexDirection="column" gap="spacing.2">
                    <Text size="xsmall" color="surface.text.gray.muted">Available instead</Text>
                    {model.refusalOptions.map((option) => (
                      <Box key={option.action}>
                        <Button
                          variant="secondary"
                          isFullWidth
                          isDisabled={option.disabledReason !== undefined}
                          onClick={() => (option.action === "escalate" ? setDialog({ kind: "escalate" }) : setDialog({ kind: "confirm", option }))}
                        >
                          {option.action === "notify_customer" ? "Contact customer" : option.label}
                        </Button>
                        {option.disabledReason ? <Text size="xsmall" color="surface.text.gray.muted">{option.disabledReason}</Text> : null}
                      </Box>
                    ))}
                  </Box>
                ) : null}

                <Box display="grid" gridTemplateColumns="1fr 1fr" gap="spacing.2">
                  {!refusal && recommendation ? (
                    <Button variant="secondary" onClick={() => setDialog({ kind: "edit" })}>Edit</Button>
                  ) : null}
                  {recommendation ? (
                    <Button variant="secondary" onClick={() => setDialog({ kind: "reject" })}>Reject</Button>
                  ) : null}
                  {!refusal ? (
                    <Button variant="secondary" isDisabled={model.escalateOption?.disabledReason !== undefined} onClick={() => setDialog({ kind: "escalate" })}>
                      Escalate
                    </Button>
                  ) : null}
                  <Button variant="tertiary" onClick={() => run("wait")}>Wait and re-check</Button>
                </Box>
              </Box>
            </Section>
          </>
        ) : null}

        {c.followUps && c.followUps.length > 0 ? (
          <>
            <Divider />
            <Section title="Follow-ups">
              {c.followUps.map((f) => (
                <Box key={f.id} paddingY="spacing.2">
                  <Text size="small">{f.detail}</Text>
                  <Text size="xsmall" color="surface.text.gray.muted">
                    {istTime(f.createdAt)} IST · {f.actor} · {f.status.replace("_", " ")}
                  </Text>
                </Box>
              ))}
            </Section>
          </>
        ) : null}
      </Box>

      <Modal isOpen={dialog?.kind === "edit"} onDismiss={close} size="medium" accessibilityLabel="Edit recommendation">
        <ModalHeader title="Edit the recommended action" subtitle="Blocked actions cannot be chosen. Policy is re-checked before anything runs." />
        <ModalBody>
          <RadioGroup label="Action" value={editAction} onChange={({ value }) => setEditAction(value as ActionType)}>
            {model.editOptions.map((option) => (
              <Radio
                key={option.action}
                value={option.action}
                isDisabled={option.disabledReason !== undefined}
                helpText={option.disabledReason ?? (option.executes ? "Runs through the execution state machine" : "Recorded; nothing is executed")}
              >
                {option.label}
              </Radio>
            ))}
          </RadioGroup>
          {error ? <Text size="small" color="feedback.text.negative.intense" marginTop="spacing.3">{error}</Text> : null}
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="primary" isDisabled={!editAction} onClick={() => editAction && (editAction === "escalate" ? setDialog({ kind: "escalate" }) : run(editAction))}>
              Apply
            </Button>
          </Box>
        </ModalFooter>
      </Modal>

      <Modal isOpen={dialog?.kind === "reject"} onDismiss={close} size="medium" accessibilityLabel="Reject recommendation">
        <ModalHeader title="Reject the recommendation" subtitle="The case closes and no action is taken on this payment." />
        <ModalBody>
          <TextArea
            label="Reason"
            necessityIndicator="required"
            isRequired
            value={reason}
            onChange={({ value }) => setReason(value ?? "")}
            helpText={`Recorded in the audit log. At least ${MIN_REJECTION_REASON} characters.`}
            {...(error ? { validationState: "error" as const, errorText: error } : {})}
          />
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="primary" color="negative" isDisabled={reason.trim().length < MIN_REJECTION_REASON} onClick={reject}>
              Reject recommendation
            </Button>
          </Box>
        </ModalFooter>
      </Modal>

      <Modal isOpen={dialog?.kind === "escalate"} onDismiss={close} size="medium" accessibilityLabel="Escalate case">
        <ModalHeader title="Escalate for review" subtitle="Posts the case to #payments-ops. No payment or outcome is changed." />
        <ModalBody>
          <TextArea label="Note for the reviewer" value={reason} onChange={({ value }) => setReason(value ?? "")} necessityIndicator="optional" />
          {error ? <Text size="small" color="feedback.text.negative.intense" marginTop="spacing.3">{error}</Text> : null}
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={() => run("escalate", reason)}>Escalate</Button>
          </Box>
        </ModalFooter>
      </Modal>

      <Modal isOpen={dialog?.kind === "confirm"} onDismiss={close} size="small" accessibilityLabel="Confirm action">
        <ModalHeader title={dialog?.kind === "confirm" ? `${dialog.option.action === "notify_customer" ? "Contact customer" : dialog.option.label}?` : ""} />
        <ModalBody>
          <Text size="small">
            {dialog?.kind === "confirm"
              ? {
                  capture: `Captures ${c.paymentId}, after which LearnLoop grants access. Policy is re-checked first.`,
                  prepare_refund: "Prepares a refund for LearnLoop finance to issue. Payment Integrity cannot issue refunds itself.",
                  notify_customer: "Sends: “Your payment is safe. A specialist is reviewing your order before any further action.”",
                  review_alternate_inventory: "Asks LearnLoop to confirm a valid replacement seat. Fulfilment stays blocked until one is confirmed.",
                }[dialog.option.action as string] ?? ""
              : ""}
          </Text>
          {error ? <Text size="small" color="feedback.text.negative.intense" marginTop="spacing.3">{error}</Text> : null}
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={() => dialog?.kind === "confirm" && run(dialog.option.action)}>Confirm</Button>
          </Box>
        </ModalFooter>
      </Modal>
    </Surface>
  );
}
