"use client";

import {
  Box,
  Button,
  Code,
  FilterChipGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SearchInput,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
  useToast,
} from "@razorpay/blade/components";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CaseStatus, CaseType } from "@/domain/types";
import { formatINR } from "@/domain/money";
import { formatRelative } from "@/domain/time";
import { OPERATOR } from "@/fixtures/catalogue";
import { approveBulk, runExecutions } from "@/services/execution";
import {
  bulkSelection,
  caseRows,
  CASE_STATUS_LABELS,
  DEFAULT_CASE_FILTERS,
  describeCaseFilters,
  filterCases,
  type CaseFilters,
} from "@/services/views/cases";
import { AMOUNT_BANDS, type AmountBand } from "@/services/views/incidents";
import { CASE_TYPE_LABELS } from "@/services/views/overview";
import { AppLink } from "@/ui/components/AppLink";
import { CaseStatusBadge, VerdictBadge } from "@/ui/components/badges";
import { Money } from "@/ui/components/Money";
import { PageHeader } from "@/ui/components/PageHeader";
import { EmptyMessage, PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";
import { usePreference } from "@/ui/data/usePreference";
import { DateRangeFilterChip } from "@/ui/filters/DateRangeFilterChip";
import { SelectFilterChip } from "@/ui/filters/SelectFilterChip";
import { caseHref, incidentHref } from "@/ui/shell/nav";

const STATUS_OPTIONS = (Object.keys(CASE_STATUS_LABELS) as CaseStatus[]).map((value) => ({ value, label: CASE_STATUS_LABELS[value] }));
const TYPE_OPTIONS = (Object.keys(CASE_TYPE_LABELS) as CaseType[]).map((value) => ({ value, label: CASE_TYPE_LABELS[value] }));

export function CasesPage() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const [filters, setFilters, loaded] = usePreference<CaseFilters>("case-filters", DEFAULT_CASE_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [tableKey, setTableKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const state = useModel((services, asOf) => caseRows(services.repos, asOf));

  // A search from the top bar arrives as ?q=; it replaces the saved query once.
  const q = params.get("q");
  useEffect(() => {
    if (loaded && q !== null && q !== filters.query) setFilters({ ...filters, query: q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, q]);

  const visible = useMemo(() => (state.status === "ready" ? filterCases(state.model, filters) : []), [state, filters]);
  const selection = useMemo(
    () => (state.status === "ready" ? bulkSelection(state.services.repos, selected, state.asOf) : undefined),
    [state, selected],
  );

  const header = <PageHeader title="Cases" description="Every payment whose promised outcome is missing, late or in doubt. Search by payment ID, order ID, customer name, email or phone." />;
  if (state.status === "loading") return <>{header}<PageSkeleton rows={1} /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;

  const rows = state.model;
  const active = describeCaseFilters(filters);
  const update = (patch: Partial<CaseFilters>) => {
    setFilters({ ...filters, ...patch });
    setSelected([]);
    setTableKey((k) => k + 1);
  };
  const reset = () => {
    update(DEFAULT_CASE_FILTERS);
    if (q !== null) router.replace("/payment-integrity/cases");
  };

  const approve = () => {
    setConfirming(false);
    const { executions } = approveBulk(state.services, selected, OPERATOR.name);
    setSelected([]);
    setTableKey((k) => k + 1);
    void runExecutions(state.services, executions.map((e) => e.id)).then((results) => {
      const resolved = results.filter((r) => r.status === "resolved").length;
      toast.show({
        color: resolved === results.length ? "positive" : "notice",
        content: resolved === results.length ? `${resolved} cases resolved. Outcomes confirmed.` : `${resolved} of ${results.length} cases resolved; the rest were escalated.`,
      });
    });
  };

  return (
    <>
      {header}
      <Surface padded={false}>
        <Box
          paddingX="spacing.6"
          paddingY="spacing.4"
          display="flex"
          flexDirection="column"
          gap="spacing.3"
          borderBottomWidth="thin"
          borderBottomColor="surface.border.gray.muted"
        >
          <Box maxWidth="480px">
            <SearchInput
              accessibilityLabel="Search cases"
              placeholder="Payment ID, order ID, customer name, email or phone"
              value={filters.query}
              onChange={({ value }) => update({ query: value ?? "" })}
              onClearButtonClick={() => update({ query: "" })}
            />
          </Box>
          <FilterChipGroup showClearButton={active.length > 0} onClearButtonClick={reset}>
            <SelectFilterChip label="Status" multiple options={STATUS_OPTIONS} values={filters.statuses} onChange={(v) => update({ statuses: v as CaseStatus[] })} />
            <SelectFilterChip label="Case type" multiple options={TYPE_OPTIONS} values={filters.types} onChange={(v) => update({ types: v as CaseType[] })} />
            <DateRangeFilterChip
              label="Detected"
              {...(filters.from ? { from: filters.from } : {})}
              {...(filters.to ? { to: filters.to } : {})}
              onChange={({ from, to }) => {
                const next: CaseFilters = { ...filters };
                delete next.from;
                delete next.to;
                update({ ...next, ...(from ? { from } : {}), ...(to ? { to } : {}) });
              }}
            />
            <SelectFilterChip
              label="Amount"
              options={AMOUNT_BANDS.filter((b) => b.value !== "any" && b.value !== "none")}
              values={filters.amount === "any" ? [] : [filters.amount]}
              onChange={(v) => update({ amount: (v[0] as AmountBand | undefined) ?? "any" })}
            />
          </FilterChipGroup>
        </Box>
        {selected.length > 0 && selection ? (
          <Box
            paddingX="spacing.6"
            paddingY="spacing.3"
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            gap="spacing.4"
            backgroundColor="surface.background.gray.moderate"
            borderBottomWidth="thin"
            borderBottomColor="surface.border.gray.muted"
          >
            <Box>
              <Text size="small" weight="semibold">
                {selected.length} selected · {formatINR(rows.filter((r) => selected.includes(r.id)).reduce((n, r) => n + r.amount, 0))}
              </Text>
              <Text size="xsmall" color="surface.text.gray.muted">
                {selection.allowed ? "All selected cases share the same safe action and policy eligibility." : selection.reason}
              </Text>
            </Box>
            <Box display="flex" gap="spacing.3">
              <Button variant="tertiary" size="small" onClick={() => { setSelected([]); setTableKey((k) => k + 1); }}>
                Clear selection
              </Button>
              <Button variant="primary" size="small" isDisabled={!selection.allowed} onClick={() => setConfirming(true)}>
                {`Approve retry provisioning for ${selected.length}`}
              </Button>
            </Box>
          </Box>
        ) : null}
        {visible.length === 0 ? (
          <EmptyMessage
            title="No cases match these filters"
            description={`Active filters: ${active.join("; ")}.`}
            action={{ label: "Clear filters", onClick: reset }}
          />
        ) : (
          <Table
            key={tableKey}
            data={{ nodes: visible }}
            selectionType="multiple"
            onSelectionChange={({ selectedIds }) => setSelected(selectedIds.map(String))}
            rowDensity="normal"
            isHeaderSticky
            gridTemplateColumns="min-content 96px minmax(110px, 1fr) 168px 112px 84px 64px minmax(118px, 1fr) 172px 118px"
          >
            {(items) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Case</TableHeaderCell>
                    <TableHeaderCell>Customer</TableHeaderCell>
                    <TableHeaderCell>Payment and order</TableHeaderCell>
                    <TableHeaderCell>Case type</TableHeaderCell>
                    <TableHeaderCell>Amount</TableHeaderCell>
                    <TableHeaderCell>Age</TableHeaderCell>
                    <TableHeaderCell>Recommendation</TableHeaderCell>
                    <TableHeaderCell>Policy state</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id} item={row}>
                      <TableCell>
                        <Box display="flex" flexDirection="column" gap="spacing.1" paddingY="spacing.2">
                          <AppLink href={caseHref(row.id)}>{row.id}</AppLink>
                          {row.incidentId ? <AppLink href={incidentHref(row.incidentId)} size="xsmall">{row.incidentId}</AppLink> : null}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.customer}</Text>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" flexDirection="column" gap="spacing.1">
                          <Code size="small">{row.paymentId}</Code>
                          <Text size="xsmall" color="surface.text.gray.muted">{row.orderId}</Text>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.typeLabel}</Text>
                      </TableCell>
                      <TableCell>
                        <Money value={row.amount} />
                      </TableCell>
                      <TableCell>
                        <Text size="small">{formatRelative(row.detectedAt, state.now).replace(" ago", "")}</Text>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.recommendation}</Text>
                      </TableCell>
                      <TableCell>
                        {row.policyState === "not_applicable" ? (
                          <Text size="small" color="surface.text.gray.muted">–</Text>
                        ) : (
                          <VerdictBadge result={row.policyState} label={row.policyLabel} />
                        )}
                      </TableCell>
                      <TableCell>
                        <CaseStatusBadge status={row.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </Table>
        )}
      </Surface>
      <Text size="xsmall" color="surface.text.gray.muted" marginTop="spacing.3">
        Showing {visible.length} of {rows.length} cases, newest first. Filters are saved for your next visit.
      </Text>
      {selection ? (
        <Modal isOpen={confirming} onDismiss={() => setConfirming(false)} size="small" accessibilityLabel="Confirm bulk recovery">
          <ModalHeader title={`Approve retry provisioning for ${selection.plan.eligible.length} cases?`} subtitle={`${formatINR(selection.plan.value)} across ${selection.plan.eligible.length} customers`} />
          <ModalBody>
            <Text size="small">
              One idempotent enrolment request per payment. Policy is re-checked for each case before its request is sent, and each case resolves only
              when course access is confirmed.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Box display="flex" justifyContent="flex-end" gap="spacing.3">
              <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="primary" onClick={approve}>Approve and start recovery</Button>
            </Box>
          </ModalFooter>
        </Modal>
      ) : null}
    </>
  );
}
