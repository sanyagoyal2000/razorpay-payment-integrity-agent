"use client";

import { Box, Button, Text } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { caseDetail } from "@/services/views/cases";
import { CaseStatusBadge } from "@/ui/components/badges";
import { Money } from "@/ui/components/Money";
import { PageHeader } from "@/ui/components/PageHeader";
import { NotFound, PageError, PageSkeleton } from "@/ui/components/states";
import { useModel } from "@/ui/data/useModel";
import { BASE_PATH } from "@/ui/shell/nav";
import { DecisionPanel } from "./DecisionPanel";
import { PaymentPanel } from "./PaymentPanel";
import { TimelinePanel } from "./TimelinePanel";

export function CaseDetailPage({ caseId }: { caseId: string }) {
  const router = useRouter();
  const state = useModel((services, asOf) => caseDetail(services.repos, caseId, asOf) ?? null, [caseId]);
  const crumbs = [{ label: "Cases", href: `${BASE_PATH}/cases` }, { label: caseId }];

  if (state.status === "loading") return <><PageHeader title={`Case ${caseId}`} crumbs={crumbs} /><PageSkeleton rows={2} /></>;
  if (state.status === "error") return <><PageHeader title={`Case ${caseId}`} crumbs={crumbs} /><PageError message={state.message} /></>;
  if (state.model === null) {
    return (
      <>
        <PageHeader title="Case not found" crumbs={crumbs} />
        <NotFound
          title={`No case ${caseId}`}
          description="Search by payment ID, order ID or customer on the Cases page."
          action={<Button variant="secondary" onClick={() => router.push(`${BASE_PATH}/cases`)}>View cases</Button>}
        />
      </>
    );
  }
  const model = state.model;
  return (
    <>
      <PageHeader
        title={`${model.typeLabel}: ${model.customer.name}`}
        crumbs={crumbs}
        description={
          <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
            <CaseStatusBadge status={model.caseData.status} />
            <Money value={model.caseData.amountAtRisk} size="medium" weight="semibold" />
            {model.caseData.refundExposure > 0 ? (
              <Box display="flex" alignItems="center" gap="spacing.2">
                <Money value={model.caseData.refundExposure} />
                <Text size="small" color="surface.text.gray.subtle">second charge to review</Text>
              </Box>
            ) : null}
          </Box>
        }
      />
      <Box display="grid" gridTemplateColumns={{ base: "1fr", l: "280px minmax(0, 1fr) 400px" }} gap="spacing.5" alignItems="start">
        <PaymentPanel model={model} now={state.now} />
        <TimelinePanel entries={model.timeline} />
        <DecisionPanel model={model} services={state.services} />
      </Box>
    </>
  );
}
