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
import { formatIstShort } from "@/domain/time";
import type { HistoryEntry } from "@/services/views/incidents";
import { Money } from "@/ui/components/Money";
import { Surface } from "@/ui/components/Surface";

const dash = <Text size="small" color="surface.text.gray.muted">–</Text>;

export function HistorySection({ entries, now }: { entries: HistoryEntry[]; now: Date }) {
  return (
    <Surface title="Incident history" description="Case count, exposure, root-cause confidence, system health and decisions, newest first" padded={false}>
      <Table data={{ nodes: entries }} rowDensity="compact" gridTemplateColumns="120px minmax(280px, 3fr) 80px 120px 110px 110px minmax(120px, 1fr)">
        {(items) => (
          <>
            <TableHeader>
              <TableHeaderRow>
                <TableHeaderCell>Time</TableHeaderCell>
                <TableHeaderCell>Change</TableHeaderCell>
                <TableHeaderCell>Cases</TableHeaderCell>
                <TableHeaderCell>Exposure</TableHeaderCell>
                <TableHeaderCell>Confidence</TableHeaderCell>
                <TableHeaderCell>Health</TableHeaderCell>
                <TableHeaderCell>By</TableHeaderCell>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <TableRow key={entry.id} item={entry}>
                  <TableCell>
                    <Text size="small">{formatIstShort(entry.occurredAt, now)}</Text>
                  </TableCell>
                  <TableCell>
                    <Box paddingY="spacing.2">
                      <Text size="small">{entry.change}</Text>
                    </Box>
                  </TableCell>
                  <TableCell>{entry.caseCount !== undefined ? <Text size="small">{entry.caseCount}</Text> : dash}</TableCell>
                  <TableCell>{entry.exposure !== undefined ? <Money value={entry.exposure} /> : dash}</TableCell>
                  <TableCell>
                    {entry.rootCauseConfidence !== undefined ? <Text size="small">{Math.round(entry.rootCauseConfidence * 100)}%</Text> : dash}
                  </TableCell>
                  <TableCell>
                    {entry.systemHealth ? <Text size="small">{entry.systemHealth === "healthy" ? "Healthy" : entry.systemHealth === "down" ? "Failing" : "Degraded"}</Text> : dash}
                  </TableCell>
                  <TableCell>{entry.actor ? <Text size="small">{entry.actor}</Text> : dash}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </>
        )}
      </Table>
    </Surface>
  );
}
