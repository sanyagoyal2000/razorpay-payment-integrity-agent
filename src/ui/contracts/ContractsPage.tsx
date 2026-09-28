"use client";

import {
  Badge,
  Box,
  Button,
  PlusIcon,
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
import { useState } from "react";
import { formatDuration } from "@/domain/time";
import { contractRows } from "@/services/views/configuration";
import { AppLink } from "@/ui/components/AppLink";
import { CaseListDrawer, type CaseListRequest } from "@/ui/components/CaseListDrawer";
import { Money } from "@/ui/components/Money";
import { PageHeader } from "@/ui/components/PageHeader";
import { PageError, PageSkeleton } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { useModel } from "@/ui/data/useModel";
import { BASE_PATH } from "@/ui/shell/nav";

const STATUS = {
  active: { label: "Active", color: "positive" as const },
  paused: { label: "Paused", color: "neutral" as const },
  draft: { label: "Draft", color: "neutral" as const },
};

export function ContractsPage() {
  const router = useRouter();
  const state = useModel((services, asOf) => contractRows(services.repos, asOf));
  const [drawer, setDrawer] = useState<CaseListRequest | null>(null);
  const header = (
    <PageHeader
      title="Outcome Contracts"
      description="What each kind of successful payment must produce, how long to wait for it, and how to recover safely."
      actions={
        <Button variant="primary" icon={PlusIcon} onClick={() => router.push(`${BASE_PATH}/contracts/new`)}>
          New contract
        </Button>
      }
    />
  );
  if (state.status === "loading") return <>{header}<PageSkeleton rows={1} /></>;
  if (state.status === "error") return <>{header}<PageError message={state.message} /></>;

  return (
    <>
      {header}
      <Surface padded={false}>
        <Table data={{ nodes: state.model }} rowDensity="normal" gridTemplateColumns="minmax(200px, 1.6fr) 96px minmax(170px, 1.2fr) 88px 148px 116px 120px 96px">
          {(items) => (
            <>
              <TableHeader>
                <TableHeaderRow>
                  <TableHeaderCell>Contract</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Expected outcome</TableHeaderCell>
                  <TableHeaderCell>Deadline</TableHeaderCell>
                  <TableHeaderCell>Safe recovery</TableHeaderCell>
                  <TableHeaderCell>Automatic limit</TableHeaderCell>
                  <TableHeaderCell>Completion, 7 days</TableHeaderCell>
                  <TableHeaderCell>Open cases</TableHeaderCell>
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id} item={row} onClick={() => router.push(`${BASE_PATH}/contracts/${row.id}`)}>
                    <TableCell>
                      <Box paddingY="spacing.2" display="flex" flexDirection="column" gap="spacing.1">
                        <AppLink href={`${BASE_PATH}/contracts/${row.id}`} accessibilityLabel={`Edit ${row.name}`}>{row.name}</AppLink>
                        <Text size="xsmall" color="surface.text.gray.muted">{row.paymentType}</Text>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Badge color={STATUS[row.status].color} size="medium">{STATUS[row.status].label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Text size="small">{row.expectedOutcome}</Text>
                    </TableCell>
                    <TableCell>
                      <Text size="small">{formatDuration(row.deadlineSeconds)}</Text>
                    </TableCell>
                    <TableCell>
                      <Text size="small">{row.safeRecovery}</Text>
                    </TableCell>
                    <TableCell>
                      <Money value={row.maxAutomaticValue} />
                    </TableCell>
                    <TableCell>
                      {row.completionRate === null ? (
                        <Text size="small" color="surface.text.gray.muted">No payments</Text>
                      ) : (
                        <Box>
                          <Text size="small">{(row.completionRate * 100).toFixed(2)}%</Text>
                          <Text size="xsmall" color="surface.text.gray.muted">{row.paymentsLast7Days.toLocaleString("en-IN")} payments</Text>
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.openCases === 0 ? (
                        <Text size="small" color="surface.text.gray.muted">0</Text>
                      ) : (
                        <Button
                          variant="tertiary"
                          size="xsmall"
                          onClick={() => setDrawer({ title: `Open cases: ${row.name}`, explanation: "Cases under this contract whose outcome is still owed.", caseIds: row.openCaseIds })}
                        >
                          {String(row.openCases)}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </>
          )}
        </Table>
      </Surface>
      <CaseListDrawer request={drawer} onDismiss={() => setDrawer(null)} />
    </>
  );
}
