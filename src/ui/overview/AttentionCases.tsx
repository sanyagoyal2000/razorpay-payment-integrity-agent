"use client";

import {
  Badge,
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
import { formatRelative } from "@/domain/time";
import type { AttentionRow } from "@/services/views/overview";
import { AppLink } from "@/ui/components/AppLink";
import { NoticeLabel } from "@/ui/components/badges";
import { Money } from "@/ui/components/Money";
import { EmptyMessage } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { BASE_PATH, caseHref } from "@/ui/shell/nav";

export function AttentionCases({ rows, now }: { rows: AttentionRow[]; now: Date }) {
  const needed = rows.filter((r) => r.attentionRequired).length;
  return (
    <Surface
      title="Cases requiring attention"
      description={`${needed} ${needed === 1 ? "case needs" : "cases need"} an individual decision. Cases in an incident's safe group are handled on the incident.`}
      padded={rows.length === 0}
    >
      {rows.length === 0 ? (
        <EmptyMessage title="Nothing needs an individual decision" description="Every open case is covered by an incident's recovery plan." />
      ) : (
        <Table data={{ nodes: rows.map((r) => ({ ...r, id: r.caseId })) }} rowDensity="normal" gridTemplateColumns="120px minmax(150px, 1fr) 150px 100px 150px minmax(270px, 3fr)">
          {(items) => (
            <>
              <TableHeader>
                <TableHeaderRow>
                  <TableHeaderCell>Case</TableHeaderCell>
                  <TableHeaderCell>Customer</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Amount</TableHeaderCell>
                  <TableHeaderCell>Attention</TableHeaderCell>
                  <TableHeaderCell>Why</TableHeaderCell>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id} item={row}>
                    <TableCell>
                      <Box display="flex" flexDirection="column" gap="spacing.1" paddingY="spacing.2">
                        <AppLink href={caseHref(row.caseId)}>{row.caseId}</AppLink>
                        {row.incidentId ? (
                          <AppLink href={`${BASE_PATH}/incidents/${row.incidentId}`} size="xsmall">{row.incidentId}</AppLink>
                        ) : null}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Text size="small">{row.customer}</Text>
                    </TableCell>
                    <TableCell>
                      <Text size="small">{row.type}</Text>
                    </TableCell>
                    <TableCell>
                      <Money value={row.amount} />
                    </TableCell>
                    <TableCell>
                      {row.attentionRequired ? (
                        <NoticeLabel>Decision needed</NoticeLabel>
                      ) : (
                        <Badge color="neutral" size="medium">No action</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box display="flex" flexDirection="column" gap="spacing.1" paddingY="spacing.2">
                        <Text size="small">{row.reason}</Text>
                        {row.deadline ? (
                          <Text size="xsmall" color="feedback.text.notice.intense" weight="semibold">
                            Refunded automatically {formatRelative(row.deadline, now)} if not captured
                          </Text>
                        ) : null}
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
  );
}
