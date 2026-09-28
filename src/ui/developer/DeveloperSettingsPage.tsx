"use client";

import { Box, Button, Divider, Modal, ModalBody, ModalFooter, ModalHeader, Switch, Text, useToast } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SystemFlags } from "@/domain/types";
import { formatIstDateTime } from "@/domain/time";
import { STALE_AFTER_MS } from "@/services/policy/currentState";
import { PageHeader } from "@/ui/components/PageHeader";
import { PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";
import { BASE_PATH } from "@/ui/shell/nav";

const DEPENDENCIES: Array<{ key: keyof SystemFlags; label: string; effect: string }> = [
  { key: "dataFeedAvailable", label: "Payment and outcome data feed", effect: "When off, data stops refreshing and goes stale after 2 minutes; consequential actions are then blocked." },
  { key: "outcomeVerificationAvailable", label: "Merchant outcome verification", effect: "When off, recovery actions are blocked because their results could not be confirmed." },
  { key: "investigationAvailable", label: "Automated investigation", effect: "When off, re-investigation falls back to a rule-based alert that recommends escalation." },
  { key: "policyServiceAvailable", label: "Policy service", effect: "When off, every execution is blocked." },
];

/** Developer settings: simulate dependency failures and reset data. Not part of the primary interface. */
export function DeveloperSettingsPage() {
  const toast = useToast();
  const router = useRouter();
  const state = useModel((services) => ({
    flags: services.repos.config.flags(),
    lastSyncedAt: services.repos.config.lastSyncedAt(),
    offsetMinutes: services.store.offsetMinutes,
    horizon: services.store.meta.horizon,
  }));
  const [confirmReset, setConfirmReset] = useState(false);
  const header = <PageHeader title="Developer settings" description="Simulate dependency failures and reset the prototype's data. These controls are not part of the product." />;
  if (state.status === "loading") return <>{header}<PageSkeleton rows={1} /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;
  const { store } = state.services;
  const { flags } = state.model;

  const reset = () => {
    store.clearPersisted();
    try {
      for (const key of Object.keys(window.localStorage)) if (key.startsWith("payment-integrity:")) window.localStorage.removeItem(key);
    } catch {
      // Storage unavailable: nothing to clear.
    }
    window.location.assign("/payment-integrity");
  };

  return (
    <>
      {header}
      <Box display="flex" flexDirection="column" gap="spacing.6">
        <Surface title="Dependencies" description="Turn a dependency off to see how the product degrades.">
          {DEPENDENCIES.map((d, index) => (
            <Box key={d.key}>
              {index > 0 ? <Divider marginY="spacing.4" /> : null}
              <Box display="flex" justifyContent="space-between" alignItems="center" gap="spacing.4">
                <Box>
                  <Text size="small" weight="semibold">{d.label}</Text>
                  <Text size="xsmall" color="surface.text.gray.muted">{d.effect}</Text>
                </Box>
                <Switch
                  accessibilityLabel={d.label}
                  isChecked={flags[d.key]}
                  onChange={({ isChecked }) => {
                    store.setFlags({ ...flags, [d.key]: isChecked });
                    if (d.key === "dataFeedAvailable" && isChecked) store.sync(new Date());
                  }}
                />
              </Box>
            </Box>
          ))}
          <Divider marginY="spacing.4" />
          <Box display="flex" justifyContent="space-between" alignItems="center" gap="spacing.4">
            <Box>
              <Text size="small" weight="semibold">Make data stale now</Text>
              <Text size="xsmall" color="surface.text.gray.muted">
                Last successful update {formatIstDateTime(state.model.lastSyncedAt)}. The next refresh clears this unless the data feed is off.
              </Text>
            </Box>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                store.markStale(new Date(Date.now() - STALE_AFTER_MS - 60_000).toISOString());
                toast.show({ color: "information", content: "Data marked stale." });
              }}
            >
              Make stale
            </Button>
          </Box>
        </Surface>

        <Surface title="Data" description={`Fixture times are shifted by ${state.model.offsetMinutes.toLocaleString("en-IN")} minutes so the latest event (${formatIstDateTime(state.model.horizon)}) was about a minute before your first visit.`}>
          <Box display="flex" justifyContent="space-between" alignItems="center" gap="spacing.4">
            <Box>
              <Text size="small" weight="semibold">Reset all data</Text>
              <Text size="xsmall" color="surface.text.gray.muted">Discards every decision, recovery, setting and saved filter, and re-seeds the fixtures anchored to the current time.</Text>
            </Box>
            <Button variant="secondary" color="negative" size="small" onClick={() => setConfirmReset(true)}>
              Reset data
            </Button>
          </Box>
        </Surface>

        <Surface title="Investigator validation" description="Offline comparison of the AI investigator and a fixed-rule baseline on labeled, simulated incidents.">
          <Box display="flex" justifyContent="space-between" alignItems="center" gap="spacing.4">
            <Text size="xsmall" color="surface.text.gray.muted">Uses committed investigator outputs; opening it makes no model calls and executes nothing.</Text>
            <Button variant="secondary" size="small" onClick={() => router.push(`${BASE_PATH}/developer/evaluations`)}>
              Open investigator validation
            </Button>
          </Box>
        </Surface>
      </Box>
      <Modal isOpen={confirmReset} onDismiss={() => setConfirmReset(false)} size="small" accessibilityLabel="Reset all data">
        <ModalHeader title="Reset all data?" />
        <ModalBody>
          <Text size="small">Every change made in this browser is discarded. This cannot be undone.</Text>
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="primary" color="negative" onClick={reset}>Reset data</Button>
          </Box>
        </ModalFooter>
      </Modal>
    </>
  );
}
