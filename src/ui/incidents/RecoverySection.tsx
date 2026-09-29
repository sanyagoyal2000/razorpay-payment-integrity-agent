"use client";

import {
  Box,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleBody,
  CollapsibleLink,
  Divider,
  IconButton,
  InfoIcon,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
  Tooltip,
  useToast,
} from "@razorpay/blade/components";
import { useMemo, useState } from "react";
import { OPERATOR } from "@/fixtures/catalogue";
import { formatINR } from "@/domain/money";
import type { AppServices } from "@/services/container";
import { approveBulk, isTerminal, runExecutions } from "@/services/execution";
import type { RecoveryGroupId } from "@/services/recovery/groups";
import { selectedActionConfidence } from "@/services/views/incidentDecision";
import { AUTOMATION_EVIDENCE_HREF, recoveryFacts, recoveryPlan, type IncidentWorkspaceModel } from "@/services/views/incidents";
import { MetaList } from "@/ui/components/MetaList";
import { AppLink } from "@/ui/components/AppLink";
import type { CaseListRequest } from "@/ui/components/CaseListDrawer";
import { Money } from "@/ui/components/Money";
import { Surface } from "@/ui/components/Surface";
import { VerdictBadge } from "@/ui/components/badges";

export function RecoverySection({
  model,
  services,
  asOf,
  onShowCases,
}: {
  model: IncidentWorkspaceModel;
  services: AppServices;
  asOf: string;
  onShowCases: (request: CaseListRequest) => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<RecoveryGroupId[]>(["safe"]);
  const [confirming, setConfirming] = useState(false);
  const [runIds, setRunIds] = useState<string[]>([]);
  const plan = useMemo(() => recoveryPlan(services.repos, model.incident, selected, asOf), [services, model, selected, asOf]);
  const facts = useMemo(() => recoveryFacts(services.repos, model.incident, selected, asOf), [services, model, selected, asOf]);
  const { confidence, modeView } = model;
  const actionConfidence = useMemo(() => selectedActionConfidence(services.repos, model.incident, selected, asOf), [services, model, selected, asOf]);

  const runs = runIds.map((id) => services.repos.executions.get(id)).filter((e) => e !== undefined);
  const running = runs.some((e) => !isTerminal(e));
  const verified = runs.filter((e) => e.status === "resolved").length;

  const toggle = (id: RecoveryGroupId, checked: boolean) =>
    setSelected((current) => (checked ? [...new Set([...current, id])] : current.filter((g) => g !== id)));

  const approve = () => {
    setConfirming(false);
    const { executions } = approveBulk(services, plan.eligibleCaseIds, OPERATOR.name);
    const ids = executions.map((e) => e.id);
    setRunIds(ids);
    void runExecutions(services, ids).then((results) => {
      const resolved = results.filter((r) => r.status === "resolved").length;
      const failed = results.length - resolved;
      toast.show({
        color: failed === 0 ? "positive" : "notice",
        content:
          failed === 0
            ? `${resolved} cases resolved. Access restored and verified for ${resolved} learners.`
            : `${resolved} cases resolved; ${failed} escalated because the outcome could not be verified.`,
      });
    });
  };

  const disabledReason = running
    ? "Recovery is in progress."
    : plan.eligibleCaseIds.length === 0
      ? !model.groups.some((g) => g.bulkEligible)
        ? model.reviewRequired
          ? "You required individual review for this incident, so bulk recovery is off. Approve each case from its case page."
          : "No group can be recovered in bulk. The remaining cases need an individual decision."
        : plan.selectedGroups.length === 0
          ? "Select a group to preview its recovery."
          : "None of the selected cases can be recovered in bulk. Review them individually."
      : undefined;

  return (
    <Surface id="recovery" title="Recovery" description="Cases grouped by recommended treatment. Select groups to preview the impact before approving.">
      {model.groups.length === 0 ? (
        <Text size="small" color="surface.text.gray.muted">
          No open cases remain. Every affected customer&apos;s outcome has been confirmed or closed.
        </Text>
      ) : (
        <Box display="grid" gridTemplateColumns="minmax(0px, 1fr)" gap="spacing.6" alignItems="start">
          <MetaList
            minColumnWidth={200}
            items={[
              {
                label: "Incident diagnosis",
                value: confidence.investigation !== undefined ? `${Math.round(confidence.investigation * 100)}% confidence` : "Not yet validated",
                help: "Confidence in the likely cause",
              },
              {
                label: "Selected recovery actions",
                value: actionConfidence !== undefined ? `Minimum ${Math.round(actionConfidence * 100)}% confidence` : "No eligible cases selected",
                help: "Lowest confidence among the selected cases' actions",
              },
              {
                label: "Current mode",
                value: (
                  <Box display="flex" alignItems="center" gap="spacing.1" flexWrap="wrap">
                    <Text size="small" weight="medium" {...(modeView.blocked ? { color: "feedback.text.negative.intense" as const } : {})}>
                      {modeView.blocked ? "Blocked by policy" : `${modeView.mode} · ${modeView.consequence}`}
                    </Text>
                    <Tooltip content={modeView.tooltip} placement="top">
                      <IconButton icon={InfoIcon} size="small" accessibilityLabel="What automatic execution requires" onClick={() => undefined} />
                    </Tooltip>
                  </Box>
                ),
                ...(modeView.blocked ? { help: modeView.consequence.replace(/^Blocked by policy: /, "") } : {}),
              },
            ]}
          />
          <Box minWidth="0px" overflowX="auto">
            <Table data={{ nodes: model.groups }} rowDensity="normal" gridTemplateColumns="minmax(190px, 2fr) 64px 104px minmax(150px, 1.5fr) 190px">
              {(items) => (
                <>
                  <TableHeader>
                    <TableHeaderRow>
                      <TableHeaderCell>Group</TableHeaderCell>
                      <TableHeaderCell>Cases</TableHeaderCell>
                      <TableHeaderCell>Value</TableHeaderCell>
                      <TableHeaderCell>Recommendation</TableHeaderCell>
                      <TableHeaderCell>Policy</TableHeaderCell>
                    </TableHeaderRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((group) => (
                      <TableRow key={group.id} item={group}>
                        <TableCell>
                          <Box paddingY="spacing.2" display="flex" flexDirection="column" gap="spacing.1">
                            <Checkbox isChecked={selected.includes(group.id)} onChange={({ isChecked }) => toggle(group.id, isChecked)} isDisabled={running}>
                              {group.label}
                            </Checkbox>
                            <Button
                              variant="tertiary"
                              size="xsmall"
                              onClick={() => onShowCases({ title: group.label, explanation: `${group.recommendation}. Policy: ${group.policy}.`, caseIds: group.caseIds })}
                            >
                              View cases
                            </Button>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Text size="small">{group.caseIds.length}</Text>
                        </TableCell>
                        <TableCell>
                          <Money value={group.value} weight="semibold" />
                        </TableCell>
                        <TableCell>
                          <Text size="small">{group.recommendation}</Text>
                        </TableCell>
                        <TableCell>
                          <VerdictBadge
                            result={group.id === "blocked" ? "blocked" : group.id === "safe" && group.policy === "Allowed" ? "allowed" : "requires_approval"}
                            label={group.policy}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </>
              )}
            </Table>
          </Box>
          <Box borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" padding="spacing.5" backgroundColor="surface.background.gray.moderate">
            <Text size="medium" weight="semibold" marginBottom="spacing.3">Recovery plan</Text>
            <Box display="flex" flexDirection="column" gap="spacing.2">
              {facts.facts.map((fact) => (
                <Text key={fact} size="small">{fact}</Text>
              ))}
            </Box>
            <Box marginTop="spacing.3">
              <Collapsible>
                <CollapsibleLink size="small">What happens if recovery fails?</CollapsibleLink>
                <CollapsibleBody>
                  <List size="small">
                    {facts.ifItFails.map((line) => (
                      <ListItem key={line}>{line}</ListItem>
                    ))}
                  </List>
                </CollapsibleBody>
              </Collapsible>
            </Box>
            <Box marginTop="spacing.3" display="flex" gap="spacing.2" flexWrap="wrap" alignItems="center">
              <Text size="xsmall" color="surface.text.gray.muted">{facts.learning}</Text>
              <AppLink href={AUTOMATION_EVIDENCE_HREF} size="xsmall">View automation evidence</AppLink>
            </Box>
            <Divider marginY="spacing.4" />
            {runs.length > 0 ? (
              <Box marginBottom="spacing.4">
                <ProgressBar
                  label={running ? `Recovering ${runs.length} cases` : `Recovery finished for ${runs.length} cases`}
                  value={runs.length === 0 ? 0 : Math.round((runs.filter(isTerminal).length / runs.length) * 100)}
                  showPercentage={false}
                  color={running ? "information" : "positive"}
                />
                <Text size="xsmall" color="surface.text.gray.muted" marginTop="spacing.2">
                  {verified} of {runs.length} outcomes verified
                  {runs.length - verified - runs.filter((r) => !isTerminal(r)).length > 0
                    ? `; ${runs.length - verified - runs.filter((r) => !isTerminal(r)).length} escalated`
                    : ""}
                </Text>
              </Box>
            ) : null}
            <Button variant="primary" isFullWidth isDisabled={disabledReason !== undefined} onClick={() => setConfirming(true)}>
              {plan.eligibleCaseIds.length > 0
                ? `Approve recovery for ${plan.eligibleCaseIds.length} cases`
                : "Approve recovery"}
            </Button>
            {disabledReason ? (
              <Text size="xsmall" color="surface.text.gray.muted" marginTop="spacing.2">
                {disabledReason}
              </Text>
            ) : null}
          </Box>
        </Box>
      )}
      <Modal isOpen={confirming} onDismiss={() => setConfirming(false)} size="medium" accessibilityLabel="Confirm recovery">
        <ModalHeader title={`Approve recovery for ${plan.eligibleCaseIds.length} cases?`} subtitle={`${formatINR(plan.revenueAddressed)} across ${plan.customers} customers`} />
        <ModalBody>
          <Box display="flex" flexDirection="column" gap="spacing.3">
            <Text size="small">{plan.actions}.</Text>
            <Text size="small">
              Policy is re-checked for every case immediately before its request is sent. A case stops if its payment, outcome or
              policy changed since this approval.
            </Text>
            <Text size="small">{plan.escalation}</Text>
            {plan.excluded.length > 0 ? (
              <Text size="small" color="surface.text.gray.subtle">
                Not included: {plan.excluded.length} cases ({summariseExclusions(plan.excluded)}).
              </Text>
            ) : null}
          </Box>
        </ModalBody>
        <ModalFooter>
          <Box display="flex" justifyContent="flex-end" gap="spacing.3">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" onClick={approve}>Approve and start recovery</Button>
          </Box>
        </ModalFooter>
      </Modal>
    </Surface>
  );
}

function summariseExclusions(excluded: Array<{ reason: string }>): string {
  const counts = new Map<string, number>();
  for (const e of excluded) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${n} × ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`).join("; ");
}
