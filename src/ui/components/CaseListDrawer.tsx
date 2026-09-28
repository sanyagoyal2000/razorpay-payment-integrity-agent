"use client";

import {
  Box,
  Drawer,
  DrawerBody,
  DrawerHeader,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
} from "@razorpay/blade/components";
import { useMemo } from "react";
import { formatINR, sum } from "@/domain/money";
import { caseListRows } from "@/services/views/caseList";
import { useDataState } from "@/ui/providers/DataProvider";
import { CaseStatusBadge } from "./badges";
import { Money } from "./Money";

export type CaseListRequest = { title: string; explanation: string; caseIds: string[] };

/** Supporting detail: the cases behind a figure. */
export function CaseListDrawer({ request, onDismiss }: { request: CaseListRequest | null; onDismiss: () => void }) {
  const state = useDataState();
  const rows = useMemo(
    () => (state.status === "ready" && request ? caseListRows(state.services.repos, request.caseIds) : []),
    [state, request],
  );
  const total = sum(rows.map((r) => r.amount));
  return (
    <Drawer isOpen={request !== null} onDismiss={onDismiss} accessibilityLabel={request?.title ?? "Cases"}>
      <DrawerHeader title={request?.title ?? ""} subtitle={`${rows.length} ${rows.length === 1 ? "case" : "cases"} · ${formatINR(total)}`} />
      <DrawerBody>
        <Text size="small" color="surface.text.gray.subtle" marginBottom="spacing.5">
          {request?.explanation}
        </Text>
        {rows.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">
            No cases contribute to this figure.
          </Text>
        ) : (
          <Box>
            <Table data={{ nodes: rows }} rowDensity="compact" isHeaderSticky>
              {(items) => (
                <>
                  <TableHeader>
                    <TableHeaderRow>
                      <TableHeaderCell>Case</TableHeaderCell>
                      <TableHeaderCell>Customer</TableHeaderCell>
                      <TableHeaderCell>Amount</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                    </TableHeaderRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((row) => (
                      <TableRow key={row.id} item={row}>
                        <TableCell>
                          <Text size="small" weight="semibold">{row.id}</Text>
                          <Text size="xsmall" color="surface.text.gray.muted">{row.type}</Text>
                        </TableCell>
                        <TableCell>
                          <Text size="small">{row.customer}</Text>
                        </TableCell>
                        <TableCell>
                          <Money value={row.amount} />
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
          </Box>
        )}
      </DrawerBody>
    </Drawer>
  );
}
