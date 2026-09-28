"use client";

import {
  Box,
  Code,
  FilterChipGroup,
  SearchInput,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TablePagination,
  TableRow,
  Text,
  Tooltip,
  TooltipInteractiveWrapper,
} from "@razorpay/blade/components";
import { useMemo } from "react";
import { formatIstShort } from "@/domain/time";
import {
  APPROVAL_SOURCE_LABELS,
  AUDIT_ACTORS,
  AUDIT_CATEGORIES,
  AUDIT_OUTCOMES,
  auditRows,
  DEFAULT_AUDIT_FILTERS,
  describeAuditFilters,
  filterAudit,
  type AuditCategory,
  type AuditFilters,
  type AuditOutcome,
  type AuditRow,
} from "@/services/views/audit";
import { AppLink } from "@/ui/components/AppLink";
import { VerdictBadge } from "@/ui/components/badges";
import { PageHeader } from "@/ui/components/PageHeader";
import { EmptyMessage, PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";
import { usePreference } from "@/ui/data/usePreference";
import { DateRangeFilterChip } from "@/ui/filters/DateRangeFilterChip";
import { SelectFilterChip } from "@/ui/filters/SelectFilterChip";
import { caseHref, incidentHref } from "@/ui/shell/nav";

function Target({ row }: { row: AuditRow }) {
  if (row.targetType === "case") return <AppLink href={caseHref(row.targetId)}>{row.targetId}</AppLink>;
  if (row.targetType === "incident") return <AppLink href={incidentHref(row.targetId)}>{row.targetId}</AppLink>;
  return (
    <Box>
      <Text size="small">{row.targetId}</Text>
      <Text size="xsmall" color="surface.text.gray.muted">{row.targetType}</Text>
    </Box>
  );
}

function Evidence({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <Text size="small" color="surface.text.gray.muted">–</Text>;
  const [first = "", ...rest] = ids;
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1">
      <Code size="small">{first}</Code>
      {rest.length > 0 ? (
        <Tooltip content={rest.join(", ")} placement="top">
          <TooltipInteractiveWrapper>
            <Text size="xsmall" color="surface.text.gray.subtle">+{rest.length} more</Text>
          </TooltipInteractiveWrapper>
        </Tooltip>
      ) : null}
    </Box>
  );
}

export function AuditLogPage() {
  const [filters, setFilters] = usePreference<AuditFilters>("audit-filters", DEFAULT_AUDIT_FILTERS);
  const state = useModel((services, asOf) => ({
    rows: auditRows(services.repos, asOf),
    incidents: services.repos.incidents.list().map((i) => ({ value: i.id, label: `${i.id}: ${i.title}` })),
  }));
  const visible = useMemo(() => (state.status === "ready" ? filterAudit(state.model.rows, filters) : []), [state, filters]);

  const header = (
    <PageHeader
      title="Audit Log"
      description="Every detection, recommendation, policy evaluation, decision, action and verification, newest first. Entries cannot be edited or deleted."
    />
  );
  if (state.status === "loading") return <>{header}<PageSkeleton rows={1} /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;

  const active = describeAuditFilters(filters);
  const update = (patch: Partial<AuditFilters>) => setFilters({ ...filters, ...patch });

  return (
    <>
      {header}
      <Surface padded={false}>
        <Box paddingX="spacing.6" paddingY="spacing.4" display="flex" flexDirection="column" gap="spacing.3" borderBottomWidth="thin" borderBottomColor="surface.border.gray.muted">
          <Box maxWidth="360px">
            <SearchInput
              accessibilityLabel="Filter by case ID"
              placeholder="Case ID, e.g. CS-10485"
              value={filters.caseQuery}
              onChange={({ value }) => update({ caseQuery: value ?? "" })}
              onClearButtonClick={() => update({ caseQuery: "" })}
            />
          </Box>
          <FilterChipGroup showClearButton={active.length > 0} onClearButtonClick={() => setFilters(DEFAULT_AUDIT_FILTERS)}>
            <SelectFilterChip label="Actor" multiple options={AUDIT_ACTORS.map((a) => ({ value: a, label: a }))} values={filters.actors} onChange={(v) => update({ actors: v })} />
            <SelectFilterChip
              label="Action type"
              multiple
              options={AUDIT_CATEGORIES.map((c) => ({ value: c, label: c }))}
              values={filters.categories}
              onChange={(v) => update({ categories: v as AuditCategory[] })}
            />
            <SelectFilterChip label="Incident" multiple options={state.model.incidents} values={filters.incidentIds} onChange={(v) => update({ incidentIds: v })} />
            <SelectFilterChip label="Outcome" multiple options={AUDIT_OUTCOMES} values={filters.outcomes} onChange={(v) => update({ outcomes: v as AuditOutcome[] })} />
            <DateRangeFilterChip
              label="Date"
              {...(filters.from ? { from: filters.from } : {})}
              {...(filters.to ? { to: filters.to } : {})}
              onChange={({ from, to }) => {
                const next: AuditFilters = { ...filters };
                delete next.from;
                delete next.to;
                setFilters({ ...next, ...(from ? { from } : {}), ...(to ? { to } : {}) });
              }}
            />
          </FilterChipGroup>
        </Box>
        {visible.length === 0 ? (
          <EmptyMessage title="No audit entries match these filters" description={`Active filters: ${active.join("; ")}.`} action={{ label: "Clear filters", onClick: () => setFilters(DEFAULT_AUDIT_FILTERS) }} />
        ) : (
          <Table
            data={{ nodes: visible }}
            rowDensity="compact"
            isHeaderSticky
            gridTemplateColumns="118px 132px minmax(150px, 1.2fr) 92px 150px 154px 100px minmax(180px, 2fr)"
            pagination={<TablePagination defaultPageSize={50} showPageSizePicker showPageNumberSelector />}
          >
            {(items) => (
              <>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHeaderCell>Timestamp (IST)</TableHeaderCell>
                    <TableHeaderCell>Actor</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                    <TableHeaderCell>Target</TableHeaderCell>
                    <TableHeaderCell>Evidence</TableHeaderCell>
                    <TableHeaderCell>Policy result</TableHeaderCell>
                    <TableHeaderCell>Approval source</TableHeaderCell>
                    <TableHeaderCell>Outcome</TableHeaderCell>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id} item={row}>
                      <TableCell>
                        <Text size="small">{formatIstShort(row.occurredAt, state.now)}</Text>
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.actor}</Text>
                      </TableCell>
                      <TableCell>
                        <Box paddingY="spacing.2">
                          <Text size="small">{row.action}</Text>
                          <Text size="xsmall" color="surface.text.gray.muted">{row.category}</Text>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Target row={row} />
                      </TableCell>
                      <TableCell>
                        <Evidence ids={row.evidenceIds ?? []} />
                      </TableCell>
                      <TableCell>
                        {row.policyResult ? <VerdictBadge result={row.policyResult} /> : <Text size="small" color="surface.text.gray.muted">–</Text>}
                      </TableCell>
                      <TableCell>
                        <Text size="small">{row.approvalSource ? APPROVAL_SOURCE_LABELS[row.approvalSource] : "–"}</Text>
                      </TableCell>
                      <TableCell>
                        <Box paddingY="spacing.2">
                          <Text size="small">{row.result}</Text>
                        </Box>
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
        {visible.length} of {state.model.rows.length} entries. The log is append-only.
      </Text>
    </>
  );
}
