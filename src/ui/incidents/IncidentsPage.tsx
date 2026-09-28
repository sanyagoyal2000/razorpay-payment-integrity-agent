"use client";

import {
  Box,
  FilterChipGroup,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
} from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { Severity } from "@/domain/types";
import { formatINR } from "@/domain/money";
import { formatIstShort, formatRelative } from "@/domain/time";
import {
  AMOUNT_BANDS,
  DEFAULT_INCIDENT_FILTERS,
  describeIncidentFilters,
  filterIncidents,
  incidentRows,
  type AmountBand,
  type IncidentFilters,
} from "@/services/views/incidents";
import { AppLink } from "@/ui/components/AppLink";
import { IncidentStatusBadge, SeverityLabel } from "@/ui/components/badges";
import { Money } from "@/ui/components/Money";
import { PageHeader } from "@/ui/components/PageHeader";
import { EmptyMessage, PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";
import { usePreference } from "@/ui/data/usePreference";
import { DateRangeFilterChip } from "@/ui/filters/DateRangeFilterChip";
import { SelectFilterChip } from "@/ui/filters/SelectFilterChip";
import { BASE_PATH } from "@/ui/shell/nav";

const SEVERITIES: Array<{ value: Severity; label: string }> = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export function IncidentsPage() {
  const router = useRouter();
  const [filters, setFilters] = usePreference<IncidentFilters>("incident-filters", DEFAULT_INCIDENT_FILTERS);
  const state = useModel((services) => ({
    rows: incidentRows(services.repos),
    contracts: services.repos.config.contracts().map((c) => ({ value: c.id, label: c.name })),
  }));
  const visible = useMemo(() => (state.status === "ready" ? filterIncidents(state.model.rows, filters) : []), [state, filters]);

  const header = <PageHeader title="Incidents" description="Groups of cases that share one cause. Open an incident to see the evidence and recover affected customers." />;
  if (state.status === "loading") return <>{header}<PageSkeleton rows={1} /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;

  const { rows, contracts } = state.model;
  const contractName = (id: string) => contracts.find((c) => c.value === id)?.label ?? id;
  const active = describeIncidentFilters(filters, contractName);
  const update = (patch: Partial<IncidentFilters>) => setFilters({ ...filters, ...patch });

  return (
    <>
      {header}
      <Surface padded={false}>
        <Box paddingX="spacing.6" paddingY="spacing.4" borderBottomWidth="thin" borderBottomColor="surface.border.gray.muted">
          <FilterChipGroup showClearButton={active.length > 0} onClearButtonClick={() => setFilters(DEFAULT_INCIDENT_FILTERS)}>
            <SelectFilterChip
              label="Status"
              options={[
                { value: "open", label: "Open" },
                { value: "resolved", label: "Resolved" },
              ]}
              values={filters.state === "all" ? [] : [filters.state]}
              onChange={(values) => update({ state: (values[0] as IncidentFilters["state"] | undefined) ?? "all" })}
            />
            <SelectFilterChip
              label="Severity"
              multiple
              options={SEVERITIES}
              values={filters.severities}
              onChange={(values) => update({ severities: values as Severity[] })}
            />
            <SelectFilterChip label="Outcome Contract" multiple options={contracts} values={filters.contractIds} onChange={(values) => update({ contractIds: values })} />
            <DateRangeFilterChip
              label="Started"
              {...(filters.from ? { from: filters.from } : {})}
              {...(filters.to ? { to: filters.to } : {})}
              onChange={({ from, to }) => {
                const next: IncidentFilters = { ...filters };
                delete next.from;
                delete next.to;
                setFilters({ ...next, ...(from ? { from } : {}), ...(to ? { to } : {}) });
              }}
            />
            <SelectFilterChip
              label="Revenue at risk"
              options={AMOUNT_BANDS.filter((b) => b.value !== "any")}
              values={filters.amount === "any" ? [] : [filters.amount]}
              onChange={(values) => update({ amount: (values[0] as AmountBand | undefined) ?? "any" })}
            />
          </FilterChipGroup>
        </Box>
        {visible.length === 0 ? (
          <EmptyMessage
            title={rows.length === 0 ? "No incidents yet" : "No incidents match these filters"}
            description={rows.length === 0 ? "Incidents appear when several cases share one cause." : `Active filters: ${active.join("; ")}.`}
            {...(rows.length > 0 ? { action: { label: "Clear filters", onClick: () => setFilters(DEFAULT_INCIDENT_FILTERS) } } : {})}
          />
        ) : (
          <Table
            data={{ nodes: visible }}
            rowDensity="normal"
            isHeaderSticky
            gridTemplateColumns="minmax(200px, 2fr) 136px 96px 116px 60px 88px 116px minmax(160px, 1.6fr) 104px"
          >
            {(items) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Incident</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Severity</TableHeaderCell>
                    <TableHeaderCell>Started</TableHeaderCell>
                    <TableHeaderCell>Cases</TableHeaderCell>
                    <TableHeaderCell>Customers</TableHeaderCell>
                    <TableHeaderCell>Revenue at risk</TableHeaderCell>
                    <TableHeaderCell>Likely cause</TableHeaderCell>
                    <TableHeaderCell>Owner</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id} item={row} onClick={() => router.push(`${BASE_PATH}/incidents/${row.id}`)}>
                      <TableCell>
                        <Box display="flex" flexDirection="column" gap="spacing.1" paddingY="spacing.2">
                          <Text size="small" weight="semibold">{row.title}</Text>
                          <AppLink href={`${BASE_PATH}/incidents/${row.id}`} size="xsmall" accessibilityLabel={`Open incident ${row.id}: ${row.title}`}>
                            {row.id}
                          </AppLink>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <IncidentStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>
                        <SeverityLabel severity={row.severity} />
                      </TableCell>
                      <TableCell>
                        <Box display="flex" flexDirection="column" gap="spacing.1">
                          <Text size="small">{formatIstShort(row.startedAt, state.now)}</Text>
                          <Text size="xsmall" color="surface.text.gray.muted">{formatRelative(row.startedAt, state.now)}</Text>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.caseCount}</Text>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.customers}</Text>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" flexDirection="column" gap="spacing.1">
                          <Money value={row.revenueAtRisk} weight="semibold" />
                          {row.revenueAtRisk !== row.initialAmountAtRisk ? (
                            <Text size="xsmall" color="surface.text.gray.muted">of {formatINR(row.initialAmountAtRisk)}</Text>
                          ) : null}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.likelyCause}</Text>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.owner}</Text>
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
        Showing {visible.length} of {rows.length} incidents. Filters are saved for your next visit.
      </Text>
    </>
  );
}

