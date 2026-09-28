"use client";

import {
  ActionList,
  ActionListItem,
  Alert,
  Box,
  Button,
  Dropdown,
  DropdownOverlay,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SelectInput,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
  TextInput,
  useToast,
} from "@razorpay/blade/components";
import { useEffect, useState } from "react";
import type { ActionMode, GlobalControls, PolicyAction } from "@/domain/types";
import { formatINR } from "@/domain/money";
import { formatIstShort } from "@/domain/time";
import { OPERATOR } from "@/fixtures/catalogue";
import { assessAutonomy, ConfigurationError, saveGlobalControls, setActionMode, setAutomationPaused } from "@/services/configuration";
import { POLICY_ACTION_LABELS } from "@/services/policy/actions";
import { actionPolicyRows, MODE_OPTIONS } from "@/services/views/configuration";
import { CaseListDrawer, type CaseListRequest } from "@/ui/components/CaseListDrawer";
import { PageHeader } from "@/ui/components/PageHeader";
import { PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";
import type { AppServices } from "@/services/container";
import { EarnedAutonomy } from "./EarnedAutonomy";

type PendingMode = { action: PolicyAction; from: ActionMode; to: ActionMode };

const modeText = (mode: ActionMode) => MODE_OPTIONS.find((o) => o.value === mode)!.label;

export function AutomationsPage() {
  const toast = useToast();
  const state = useModel((services) => ({
    rows: actionPolicyRows(services.repos),
    controls: services.repos.config.globalControls(),
    queued: services.repos.executions.list().filter((e) => !["resolved", "stopped", "failed"].includes(e.status)).length,
    assessment: assessAutonomy(services.repos, "retry_provisioning"),
  }));
  const [drawer, setDrawer] = useState<CaseListRequest | null>(null);
  const [pending, setPending] = useState<PendingMode | null>(null);
  const [killDialog, setKillDialog] = useState(false);

  const header = (
    <PageHeader
      title="Automations and policies"
      description="Choose what the agent may do on its own. Nothing here changes unless you change it; policy is checked again before every action."
    />
  );
  if (state.status === "loading") return <>{header}<PageSkeleton rows={2} /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;
  const { services, asOf } = state;
  const { rows, controls, queued, assessment } = state.model;

  const confirmMode = () => {
    if (!pending) return;
    setActionMode(services.repos, pending.action, pending.to, OPERATOR.name, new Date().toISOString());
    toast.show({ color: "positive", content: `${POLICY_ACTION_LABELS[pending.action]} set to ${modeText(pending.to)}.` });
    setPending(null);
  };
  const toggleKill = () => {
    setAutomationPaused(services.repos, !controls.automationPaused, OPERATOR.name, new Date().toISOString());
    toast.show({ color: controls.automationPaused ? "positive" : "notice", content: controls.automationPaused ? "Automated actions resumed." : "All automated actions paused." });
    setKillDialog(false);
  };

  return (
    <>
      {header}
      <Box display="flex" flexDirection="column" gap="spacing.6">
        <KillSwitch paused={controls.automationPaused} since={controls.updatedAt} queued={queued} now={state.now} onToggle={() => setKillDialog(true)} />

        <Surface title="Action policies" description="Each action is configured separately from Outcome Contracts." padded={false}>
          <Table data={{ nodes: rows.map((r) => ({ ...r, id: r.action })) }} rowDensity="normal" gridTemplateColumns="minmax(180px, 1fr) minmax(240px, 2fr) 280px 170px">
            {(items) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Action</TableHeaderCell>
                    <TableHeaderCell>What it does</TableHeaderCell>
                    <TableHeaderCell>Mode</TableHeaderCell>
                    <TableHeaderCell>Last changed</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id} item={row}>
                      <TableCell>
                        <Box paddingY="spacing.2">
                          <Text size="small" weight="semibold">{row.label}</Text>
                          {row.permissionMissing ? (
                            <Text size="xsmall" color="feedback.text.negative.intense">Scope {row.permissionMissing} not granted; cannot run</Text>
                          ) : null}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Text size="small" color="surface.text.gray.subtle">{row.description}</Text>
                      </TableCell>
                      <TableCell>
                        <Box width="100%" paddingY="spacing.2">
                          <Dropdown selectionType="single">
                            <SelectInput
                              label=""
                              accessibilityLabel={`Mode for ${row.label}`}
                              value={row.mode}
                              onChange={({ values }) => {
                                const to = values[0] as ActionMode | undefined;
                                if (to && to !== row.mode) setPending({ action: row.action, from: row.mode, to });
                              }}
                            />
                            <DropdownOverlay>
                              <ActionList>
                                {MODE_OPTIONS.map((o) => (
                                  <ActionListItem key={o.value} title={o.label} description={o.description} value={o.value} />
                                ))}
                              </ActionList>
                            </DropdownOverlay>
                          </Dropdown>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Text size="small">{formatIstShort(row.updatedAt, state.now)}</Text>
                          <Text size="xsmall" color="surface.text.gray.muted">{row.updatedBy}</Text>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </Table>
        </Surface>

        <EarnedAutonomy
          services={services}
          assessment={assessment}
          currentMode={rows.find((r) => r.action === "retry_provisioning")!.mode}
          asOf={asOf}
          now={state.now}
          onShowCases={setDrawer}
        />

        <GlobalControlsForm services={services} controls={controls} />
      </Box>

      <Modal isOpen={pending !== null} onDismiss={() => setPending(null)} size="small" accessibilityLabel="Change action mode">
        <ModalHeader title={pending ? `Change ${POLICY_ACTION_LABELS[pending.action]}?` : ""} />
        <ModalBody>
          {pending ? (
            <Box display="flex" flexDirection="column" gap="spacing.3">
              <Text size="small">
                {modeText(pending.from)} → <Text as="span" size="small" weight="semibold">{modeText(pending.to)}</Text>
              </Text>
              <Text size="small" color="surface.text.gray.subtle">{MODE_OPTIONS.find((o) => o.value === pending.to)!.description}</Text>
              {pending.to === "automatic_below_threshold" ? (
                <Text size="small" color="surface.text.gray.subtle">
                  Limits: up to {formatINR(controls.maxAutomaticValue)} and at least {Math.round(controls.minimumConfidence * 100)}% confidence, or the stricter
                  Outcome Contract limit. Duplicates, high-value and inventory cases still come to you.
                </Text>
              ) : null}
              <Text size="xsmall" color="surface.text.gray.muted">Recorded in the audit log.</Text>
            </Box>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" onClick={confirmMode}>Change mode</Button>
          </Box>
        </ModalFooter>
      </Modal>

      <Modal isOpen={killDialog} onDismiss={() => setKillDialog(false)} size="small" accessibilityLabel="Pause automated actions">
        <ModalHeader title={controls.automationPaused ? "Resume automated actions?" : "Pause all automated actions?"} />
        <ModalBody>
          <Text size="small">
            {controls.automationPaused
              ? "New executions will be allowed again, subject to each action's mode and policy."
              : `No new action will execute, including ones you have already approved${queued > 0 ? ` (${queued} queued; they stay visible and stop at their policy re-check)` : ""}. Monitoring, investigation and escalation continue.`}
          </Text>
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={() => setKillDialog(false)}>Cancel</Button>
            <Button variant="primary" color={controls.automationPaused ? "primary" : "negative"} onClick={toggleKill}>
              {controls.automationPaused ? "Resume" : "Pause all automated actions"}
            </Button>
          </Box>
        </ModalFooter>
      </Modal>
      <CaseListDrawer request={drawer} onDismiss={() => setDrawer(null)} />
    </>
  );
}

function KillSwitch({ paused, since, queued, now, onToggle }: { paused: boolean; since: string; queued: number; now: Date; onToggle: () => void }) {
  return (
    <Box
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      gap="spacing.5"
      padding="spacing.5"
      borderWidth="thin"
      borderRadius="medium"
      borderColor="surface.border.gray.muted"
      backgroundColor={paused ? "feedback.background.notice.subtle" : "surface.background.gray.intense"}
    >
      <Box>
        <Text size="medium" weight="semibold">{paused ? "All automated actions are paused" : "Automated actions are running"}</Text>
        <Text size="small" color="surface.text.gray.subtle">
          {paused
            ? `Since ${formatIstShort(since, now)}. Monitoring and investigation continue.${queued > 0 ? ` ${queued} queued actions remain visible.` : ""}`
            : "The kill switch stops every new execution immediately. Monitoring and investigation keep running."}
        </Text>
      </Box>
      <Button variant={paused ? "primary" : "secondary"} color={paused ? "primary" : "negative"} onClick={onToggle}>
        {paused ? "Resume automated actions" : "Pause all automated actions"}
      </Button>
    </Box>
  );
}

function GlobalControlsForm({ services, controls }: { services: AppServices; controls: GlobalControls }) {
  const toast = useToast();
  const initial = {
    maxAutomaticValue: String(controls.maxAutomaticValue),
    dailyRefundLimit: String(controls.dailyRefundLimit),
    minimumConfidence: String(Math.round(controls.minimumConfidence * 100)),
    neverActAfterInventoryChange: controls.neverActAfterInventoryChange,
    neverActOnLowConfidenceMatch: controls.neverActOnLowConfidenceMatch,
    requireApprovalForCustomerCommunication: controls.requireApprovalForCustomerCommunication,
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setForm(initial), [controls.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = () => {
    try {
      saveGlobalControls(
        services.repos,
        {
          maxAutomaticValue: Number(form.maxAutomaticValue),
          dailyRefundLimit: Number(form.dailyRefundLimit),
          minimumConfidence: Number(form.minimumConfidence) / 100,
          neverActAfterInventoryChange: form.neverActAfterInventoryChange,
          neverActOnLowConfidenceMatch: form.neverActOnLowConfidenceMatch,
          requireApprovalForCustomerCommunication: form.requireApprovalForCustomerCommunication,
        },
        OPERATOR.name,
        new Date().toISOString(),
      );
      setErrors({});
      toast.show({ color: "positive", content: "Global controls saved." });
    } catch (error) {
      if (error instanceof ConfigurationError) setErrors(error.fieldErrors);
    }
  };
  const toggles: Array<{ key: "neverActAfterInventoryChange" | "neverActOnLowConfidenceMatch" | "requireApprovalForCustomerCommunication"; label: string; help: string }> = [
    { key: "neverActAfterInventoryChange", label: "Never act after inventory changes", help: "Fulfilment is blocked if the purchased seat or stock changed after payment." },
    { key: "neverActOnLowConfidenceMatch", label: "Never act on low-confidence record matches", help: "Payments must match the merchant order exactly before any action." },
    { key: "requireApprovalForCustomerCommunication", label: "Require approval for customer communication", help: "Every customer message waits for your review." },
  ];
  return (
    <Surface id="global-controls" title="Global controls" description="Limits that apply to every action and contract.">
      <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "repeat(3, 1fr)" }} gap="spacing.5" marginBottom="spacing.6">
        <TextInput
          label="Maximum automatic value (₹)"
          type="number"
          value={form.maxAutomaticValue}
          onChange={({ value }) => setForm({ ...form, maxAutomaticValue: value ?? "" })}
          helpText="Above this, every action needs approval"
          {...(errors["maxAutomaticValue"] ? { validationState: "error" as const, errorText: errors["maxAutomaticValue"] } : {})}
        />
        <TextInput
          label="Daily refund limit (₹)"
          type="number"
          value={form.dailyRefundLimit}
          onChange={({ value }) => setForm({ ...form, dailyRefundLimit: value ?? "" })}
          helpText="Refunds stop for the day once reached"
          {...(errors["dailyRefundLimit"] ? { validationState: "error" as const, errorText: errors["dailyRefundLimit"] } : {})}
        />
        <TextInput
          label="Minimum confidence (%)"
          type="number"
          value={form.minimumConfidence}
          onChange={({ value }) => setForm({ ...form, minimumConfidence: value ?? "" })}
          helpText="Below this, recommendations need individual approval"
          {...(errors["minimumConfidence"] ? { validationState: "error" as const, errorText: errors["minimumConfidence"] } : {})}
        />
      </Box>
      <Box display="flex" flexDirection="column" gap="spacing.4" marginBottom="spacing.6">
        {toggles.map((t) => (
          <Box key={t.key} display="flex" justifyContent="space-between" alignItems="center" gap="spacing.4">
            <Box>
              <Text size="small" weight="semibold">{t.label}</Text>
              <Text size="xsmall" color="surface.text.gray.muted">{t.help}</Text>
            </Box>
            <Switch accessibilityLabel={t.label} isChecked={form[t.key]} onChange={({ isChecked }) => setForm({ ...form, [t.key]: isChecked })} />
          </Box>
        ))}
      </Box>
      {Object.keys(errors).length > 0 ? (
        <Box marginBottom="spacing.4">
          <Alert color="negative" description="Some values are not valid. Fix the highlighted fields." isDismissible={false} isFullWidth />
        </Box>
      ) : null}
      <Box display="flex" justifyContent="flex-end" gap="spacing.3">
        <Button variant="secondary" isDisabled={!dirty} onClick={() => { setForm(initial); setErrors({}); }}>Discard changes</Button>
        <Button variant="primary" isDisabled={!dirty} onClick={save}>Save controls</Button>
      </Box>
    </Surface>
  );
}
