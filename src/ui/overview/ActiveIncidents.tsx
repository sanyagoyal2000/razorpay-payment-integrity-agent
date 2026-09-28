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
        <Table data={{ nodes: rows }} rowDensity="normal" gridTemplateColumns="minmax(260px, 3fr) 96px 130px 150px minmax(200px, 2fr)">
          {(items) => (
            <>
              <TableHeader>
                <TableHeaderRow>
                  <TableHeaderCell>Incident</TableHeaderCell>
                  <TableHeaderCell>Customers</TableHeaderCell>
                  <TableHeaderCell>Revenue at risk</TableHeaderCell>
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
                        <Text size="xsmall" color="surface.text.gray.subtle">Likely cause: {row.likelyCause}</Text>
                        <Box display="flex" alignItems="center" gap="spacing.2" flexWrap="wrap">
                          <AppLink href={`${BASE_PATH}/incidents/${row.id}`} size="xsmall" accessibilityLabel={`Open incident ${row.id}: ${row.title}`}>{row.id}</AppLink>
                          <Text size="xsmall" color="surface.text.gray.muted">
                            Started {formatIstShort(row.startedAt, now)} IST ({formatRelative(row.startedAt, now)})
                          </Text>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Text size="small">{row.affectedCustomers}</Text>
                    </TableCell>
                    <TableCell>
                      <Money value={row.revenueAtRisk} weight="semibold" />
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
