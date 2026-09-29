"use client";

import { Badge, Box, Button, Code, Divider, Modal, ModalBody, ModalFooter, ModalHeader, Text, useToast } from "@razorpay/blade/components";
import { Fragment, useState } from "react";
import { formatIstShort, formatRelative } from "@/domain/time";
import { OPERATOR } from "@/fixtures/catalogue";
import { setIntegrationConnected, setWriteAuthority } from "@/services/configuration";
import { integrationHealth, integrationRows, permissionModel, type IntegrationRow } from "@/services/views/configuration";
import { PageHeader } from "@/ui/components/PageHeader";
import { PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1">
      <Text size="xsmall" color="surface.text.gray.muted">{label}</Text>
      {children}
    </Box>
  );
}

function Scopes({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <Text size="small" color="surface.text.gray.muted">{empty}</Text>;
  return (
    <Box display="flex" flexWrap="wrap" gap="spacing.2">
      {values.map((v) => (
        <Code key={v} size="small">{v}</Code>
      ))}
    </Box>
  );
}

export function IntegrationsPage() {
  const toast = useToast();
  const state = useModel((services, asOf) => ({
    rows: integrationRows(services.repos, asOf),
    health: integrationHealth(services.repos, asOf),
    permissions: permissionModel(services.repos),
  }));
  const [pending, setPending] = useState<IntegrationRow | null>(null);
  const [pendingWrite, setPendingWrite] = useState<IntegrationRow | null>(null);
  const header = <PageHeader title="Integrations" description="The systems Payment Integrity reads from and acts through, what each may do, and how healthy each connection is." />;
  if (state.status === "loading") return <>{header}<PageSkeleton rows={2} /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;
  const { rows, health, permissions } = state.model;
  const pct = (v: number | null, digits = 2) => (v === null ? "No data" : `${(v * 100).toFixed(digits)}%`);

  const confirm = () => {
    if (!pending) return;
    const reconnect = pending.status !== "connected";
    setIntegrationConnected(state.services.repos, pending.id, reconnect, OPERATOR.name, new Date().toISOString());
    toast.show({ color: reconnect ? "positive" : "notice", content: `${pending.name} ${reconnect ? "reconnected with read access; grant write access separately" : "revoked"}.` });
    setPending(null);
  };
  const writeGranted = (row: IntegrationRow) => row.writeAuthority !== "not_granted";
  const confirmWrite = () => {
    if (!pendingWrite) return;
    const grant = !writeGranted(pendingWrite);
    setWriteAuthority(state.services.repos, pendingWrite.id, grant, OPERATOR.name, new Date().toISOString());
    toast.show({ color: grant ? "positive" : "notice", content: `Write access to ${pendingWrite.name} ${grant ? "granted" : "removed"}.` });
    setPendingWrite(null);
  };

  const indicators: Array<{ label: string; value: string; detail: string }> = [
    { label: "Webhook delivery success", value: pct(health.webhookSuccess.value), detail: health.webhookSuccess.detail },
    { label: "Outcome Receipt completion", value: pct(health.receiptCompletion.value), detail: health.receiptCompletion.detail },
    { label: "Median event latency", value: health.medianLatencyMs.value === null ? "No data" : `${Math.round(health.medianLatencyMs.value)} ms`, detail: health.medianLatencyMs.detail },
    { label: "Authentication errors", value: String(health.authErrors.value), detail: health.authErrors.detail },
    { label: "Schema errors", value: String(health.schemaErrors.value), detail: health.schemaErrors.detail },
    { label: "Permission failures", value: String(health.permissionFailures.value), detail: health.permissionFailures.detail },
  ];

  return (
    <>
      {header}
      <Box display="flex" flexDirection="column" gap="spacing.6">
        <Surface title="Integration health" description="Each indicator separately, from the last 7 days of traffic and 30 days of connector logs.">
          <Box display="grid" gridTemplateColumns={{ base: "repeat(2, 1fr)", l: "repeat(3, 1fr)" }} gap="spacing.4">
            {indicators.map((i) => (
              <Box key={i.label} padding="spacing.4" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium">
                <Text size="small" color="surface.text.gray.subtle">{i.label}</Text>
                <Text size="large" weight="semibold">{i.value}</Text>
                <Text size="xsmall" color="surface.text.gray.muted">{i.detail}</Text>
              </Box>
            ))}
          </Box>
        </Surface>

        <Surface title="Connections" padded={false}>
          {rows.map((row, index) => (
            <Fragment key={row.id}>
              {index > 0 ? <Divider /> : null}
              <Box padding="spacing.6" display="flex" flexDirection="column" gap="spacing.4">
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap="spacing.4">
                  <Box>
                    <Box display="flex" alignItems="center" gap="spacing.3">
                      <Text size="medium" weight="semibold">{row.name}</Text>
                      <Badge color={row.status === "connected" ? "positive" : "negative"} size="small">
                        {row.status === "connected" ? "Connected" : "Revoked"}
                      </Badge>
                      <Badge color="neutral" size="small">{row.access === "read_only" ? "Read-only" : "Scoped action permission"}</Badge>
                    </Box>
                    <Text size="small" color="surface.text.gray.subtle">{row.purpose}</Text>
                  </Box>
                  <Button variant="secondary" size="small" color={row.status === "connected" ? "negative" : "primary"} onClick={() => setPending(row)}>
                    {row.status === "connected" ? "Revoke" : "Reconnect"}
                  </Button>
                </Box>
                <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "repeat(4, 1fr)" }} gap="spacing.5">
                  <Field label="Last successful event">
                    <Text size="small">{row.lastSuccessfulEventAt ? formatIstShort(row.lastSuccessfulEventAt, state.now) : "None yet"}</Text>
                    {row.lastSuccessfulEventAt ? <Text size="xsmall" color="surface.text.gray.muted">{formatRelative(row.lastSuccessfulEventAt, state.now)}</Text> : null}
                  </Field>
                  <Field label="Recent errors">
                    <Text size="small">{row.errorSummary}</Text>
                  </Field>
                  <Field label="Data accessed">
                    <Text size="small">{row.dataAccessed.join(", ")}</Text>
                  </Field>
                  <Field label="Actions allowed">
                    <Text size="small">{row.actionsAllowed.length === 0 ? "None" : row.actionsAllowed.join(", ")}</Text>
                    {row.scopes.write.length > 0 && row.status === "connected" ? (
                      <Box display="flex" alignItems="center" gap="spacing.2" flexWrap="wrap">
                        <Text size="xsmall" color="surface.text.gray.muted">Write access {writeGranted(row) ? "granted" : "not granted"}</Text>
                        <Button variant="tertiary" size="xsmall" onClick={() => setPendingWrite(row)}>
                          {writeGranted(row) ? "Remove write access" : "Grant write access"}
                        </Button>
                      </Box>
                    ) : null}
                  </Field>
                </Box>
                <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "repeat(3, 1fr)" }} gap="spacing.5">
                  <Field label="Read">
                    <Scopes values={row.scopes.read} empty="None" />
                  </Field>
                  <Field label="Write">
                    <Scopes values={row.scopes.write} empty="None" />
                  </Field>
                  <Field label="Not granted">
                    <Scopes values={row.scopes.notGranted} empty="None" />
                  </Field>
                </Box>
              </Box>
            </Fragment>
          ))}
        </Surface>

        <Surface title="Permission model" description="What Payment Integrity can use right now. Anything not granted is impossible: policy blocks it before any call is made.">
          <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "repeat(3, 1fr)" }} gap="spacing.5">
            <Field label="Read"><Scopes values={permissions.read} empty="None" /></Field>
            <Field label="Write"><Scopes values={permissions.write} empty="None" /></Field>
            <Field label="Not granted"><Scopes values={permissions.notGranted} empty="None" /></Field>
          </Box>
        </Surface>
      </Box>

      <Modal isOpen={pending !== null} onDismiss={() => setPending(null)} size="small" accessibilityLabel="Change integration">
        <ModalHeader title={pending ? `${pending.status === "connected" ? "Revoke" : "Reconnect"} ${pending.name}?` : ""} />
        <ModalBody>
          <Text size="small">
            {pending?.status === "connected"
              ? `Payment Integrity loses ${[...(pending?.scopes.read ?? []), ...(pending?.scopes.write ?? [])].join(", ")}. ${pending?.actionsAllowed.length ? `${pending.actionsAllowed.join(", ")} will be blocked by policy.` : ""} Detection on other data continues.`
              : `Restores read access (${pending?.scopes.read.join(", ") || "none"}). ${pending?.scopes.write.length ? "Write access stays off until you grant it separately." : ""}`}
          </Text>
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" color={pending?.status === "connected" ? "negative" : "primary"} onClick={confirm}>
              {pending?.status === "connected" ? "Revoke" : "Reconnect"}
            </Button>
          </Box>
        </ModalFooter>
      </Modal>

      <Modal isOpen={pendingWrite !== null} onDismiss={() => setPendingWrite(null)} size="small" accessibilityLabel="Change write access">
        <ModalHeader title={pendingWrite ? `${writeGranted(pendingWrite) ? "Remove" : "Grant"} write access to ${pendingWrite.name}?` : ""} />
        <ModalBody>
          <Text size="small">
            {pendingWrite
              ? writeGranted(pendingWrite)
                ? `Payment Integrity can no longer use ${pendingWrite.scopes.write.join(", ")}. It keeps read access.`
                : `Payment Integrity may use ${pendingWrite.scopes.write.join(", ")}, still subject to each action's Automations mode and policy. Recorded in the audit log.`
              : ""}
          </Text>
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={() => setPendingWrite(null)}>Cancel</Button>
            <Button variant="primary" color={pendingWrite && writeGranted(pendingWrite) ? "negative" : "primary"} onClick={confirmWrite}>
              {pendingWrite && writeGranted(pendingWrite) ? "Remove write access" : "Grant write access"}
            </Button>
          </Box>
        </ModalFooter>
      </Modal>
    </>
  );
}
