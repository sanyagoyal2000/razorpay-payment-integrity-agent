"use client";

import {
  Box,
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
import { formatIstDateTime, formatIstShort, formatRelative } from "@/domain/time";
import type { ActiveIncidentRow } from "@/services/views/overview";
import { AppLink } from "@/ui/components/AppLink";
import { IncidentStatusBadge } from "@/ui/components/badges";
import { Money } from "@/ui/components/Money";
import { EmptyMessage } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { BASE_PATH } from "@/ui/shell/nav";

export function ActiveIncidents({ rows, lastRefresh, now }: { rows: ActiveIncidentRow[]; lastRefresh: string; now: Date }) {
  const router = useRouter();
  return (
    <Surface title="Active incidents" description="Groups of cases that share one cause" padded={rows.length === 0}>
      {rows.length === 0 ? (
        <EmptyMessage
          title="No active integrity incidents"
          description={`Payment and outcome flows are operating normally. Last monitored ${formatIstDateTime(lastRefresh)}.`}
          action={{ label: "View resolved incidents", onClick: () => router.push(`${BASE_PATH}/incidents`) }}
        />
      ) : (
        <Table data={{ nodes: rows }} rowDensity="normal" gridTemplateColumns="minmax(240px, 2.2fr) 130px 96px 130px minmax(200px, 2fr) 150px minmax(220px, 2fr)">
          {(items) => (
            <>
              <TableHeader>
                <TableHeaderRow>
                  <TableHeaderCell>Incident</TableHeaderCell>
                  <TableHeaderCell>Started</TableHeaderCell>
                  <TableHeaderCell>Customers</TableHeaderCell>
                  <TableHeaderCell>Revenue at risk</TableHeaderCell>
                  <TableHeaderCell>Likely cause</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Required decision</TableHeaderCell>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id} item={row} onClick={() => router.push(`${BASE_PATH}/incidents/${row.id}`)}>
                    <TableCell>
                      <Box display="flex" flexDirection="column" gap="spacing.1" paddingY="spacing.2">
                        <Text size="small" weight="semibold">{row.title}</Text>
                        <AppLink href={`${BASE_PATH}/incidents/${row.id}`} size="xsmall" accessibilityLabel={`Open incident ${row.id}: ${row.title}`}>{row.id}</AppLink>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box display="flex" flexDirection="column" gap="spacing.1">
                        <Text size="small">{formatIstShort(row.startedAt, now)}</Text>
                        <Text size="xsmall" color="surface.text.gray.muted">{formatRelative(row.startedAt, now)}</Text>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Text size="small">{row.affectedCustomers}</Text>
                    </TableCell>
                    <TableCell>
                      <Money value={row.revenueAtRisk} weight="semibold" />
                    </TableCell>
                    <TableCell>
                      <Text size="small">{row.likelyCause}</Text>
                    </TableCell>
                    <TableCell>
                      <IncidentStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <Text size="small">{row.requiredDecision}</Text>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </>
          )}
        </Table>
      )}
    </Surface>
  );
}
