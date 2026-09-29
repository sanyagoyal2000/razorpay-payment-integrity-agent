"use client";

import {
  Box,
  Button,
  CheckCircleIcon,
  Divider,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ProgressBar,
  Text,
  useToast,
} from "@razorpay/blade/components";
import { Fragment, useState } from "react";
import type { ContainmentAction } from "@/domain/types";
import { formatIstShort } from "@/domain/time";
import { OPERATOR } from "@/fixtures/catalogue";
import { applyContainment, type ContainmentOption } from "@/services/containment";
import type { AppServices } from "@/services/container";
import type { IncidentWorkspaceModel } from "@/services/views/incidents";
import { draftCustomerMessage, messageInputForIncident } from "@/services/agent";
import { communicationSummary } from "@/services/communication";
import { MessageDraftModal } from "@/ui/agent/MessageDraftModal";
import { Surface } from "@/ui/components/Surface";

export function ContainmentSection({ model, services, now }: { model: IncidentWorkspaceModel; services: AppServices; now: Date }) {
  const toast = useToast();
  const [pending, setPending] = useState<ContainmentOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = (action: ContainmentAction, message?: string) => {
    try {
      const decision = applyContainment(services.repos, model.incident.id, action, OPERATOR.name, new Date().toISOString(), message);
      toast.show({ color: "positive", content: decision.detail });
      setPending(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The decision could not be recorded.");
    }
  };

  const recipients = model.notification.recipientCaseIds.length;
  const product = model.contract.name.toLowerCase();

  return (
    <Surface
      id="containment"
      title="Containment"
      description="Decisions that limit further impact. Payments and checkout are never paused."
    >
      <Box borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium">
        {model.containment.map((option, index) => (
          <Fragment key={option.action}>
            {index > 0 ? <Divider /> : null}
            <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "1fr 260px" }} gap="spacing.4" paddingX="spacing.5" paddingY="spacing.4" alignItems="center">
              <Box>
                <Text size="small" weight="semibold">{option.label}</Text>
                <Text size="xsmall" color="surface.text.gray.muted">{option.description}</Text>
                {option.action === "monitor_next_purchases" && model.monitoring ? (
                  <Box marginTop="spacing.2" maxWidth="360px">
                    <ProgressBar
                      label={model.monitoring.complete ? "Monitoring complete" : "Monitoring"}
                      value={Math.round((model.monitoring.observed / model.monitoring.target) * 100)}
                      showPercentage={false}
                      size="small"
                      color={model.monitoring.complete ? "positive" : "information"}
                    />
                    <Text size="xsmall" color="surface.text.gray.subtle" marginTop="spacing.1">
                      {model.monitoring.observed} of {model.monitoring.target} purchases observed, {model.monitoring.confirmed} with a confirmed outcome
                    </Text>
                  </Box>
                ) : null}
                {option.action === "engineering_incident" && model.engineering ? (
                  <Text size="xsmall" color="surface.text.gray.subtle" marginTop="spacing.1">
                    {model.engineering.reference} · {model.engineering.status}
                  </Text>
                ) : null}
              </Box>
              <Box display="flex" justifyContent={{ base: "flex-start", m: "flex-end" }}>
                {option.decision ? (
                  <Box display="flex" alignItems="flex-start" gap="spacing.2">
                    <CheckCircleIcon size="medium" color="feedback.icon.positive.intense" />
                    <Box>
                      <Text size="xsmall" weight="semibold">Recorded {formatIstShort(option.decision.decidedAt, now)}</Text>
                      <Text size="xsmall" color="surface.text.gray.muted">{option.decision.detail}</Text>
                    </Box>
                  </Box>
                ) : option.unavailableReason ? (
                  <Text size="xsmall" color="surface.text.gray.muted" textAlign="right">
                    {option.unavailableReason}
                  </Text>
                ) : (
                  <Button variant="secondary" size="small" onClick={() => setPending(option)}>
                    {option.action === "notify_customers" ? `Review message for ${recipients}` : "Record decision"}
                  </Button>
                )}
              </Box>
            </Box>
          </Fragment>
        ))}
      </Box>
      <MessageDraftModal
        isOpen={pending?.action === "notify_customers"}
        title="Notify affected customers"
        summarize={(text) =>
          communicationSummary(
            services.repos,
            [...model.notification.recipientCaseIds, ...model.notification.optedOutCaseIds].map((id) => services.repos.cases.get(id)!.customerId),
            text,
            model.notification.template,
          )
        }
        loadDraft={() => draftCustomerMessage(services.agent, messageInputForIncident(services.repos, model.incident.id))}
        onSend={(message) => confirm("notify_customers", message)}
        onDismiss={() => {
          setPending(null);
          setError(null);
        }}
        error={error}
      />
      <Modal isOpen={pending !== null && pending.action !== "notify_customers"} onDismiss={() => setPending(null)} size="medium" accessibilityLabel={pending?.label ?? "Containment"}>
        <ModalHeader title={pending?.label ?? ""} />
        <ModalBody>
          {pending?.action === "notify_customers" ? (
            <Box display="flex" flexDirection="column" gap="spacing.4">
              <Text size="small">
                {recipients} learners whose {product} outcome is still missing will receive this message by email:
              </Text>
              <Box padding="spacing.4" borderRadius="medium" backgroundColor="surface.background.gray.moderate">
                <Text size="small">{model.notification.template.replace("{product}", "your learning package")}</Text>
              </Box>
              <Text size="xsmall" color="surface.text.gray.muted">
                Customer messages require your approval. Customers already contacted are not messaged again.
              </Text>
            </Box>
          ) : (
            <Text size="small">{pending?.description}</Text>
          )}
          {error ? (
            <Text size="small" color="feedback.text.negative.intense" marginTop="spacing.3">
              {error}
            </Text>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => pending && confirm(pending.action)}>
              {pending?.action === "notify_customers" ? `Send to ${recipients} customers` : "Record decision"}
            </Button>
          </Box>
        </ModalFooter>
      </Modal>
    </Surface>
  );
}
