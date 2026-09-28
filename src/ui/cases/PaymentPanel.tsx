"use client";

import { Badge, Box, Button, Code, Divider, Text } from "@razorpay/blade/components";
import { useEffect, useState, type ReactNode } from "react";
import { formatINR } from "@/domain/money";
import { formatIstShort } from "@/domain/time";
import { OPERATOR } from "@/fixtures/catalogue";
import type { AppServices } from "@/services/container";
import { revealCustomerContact } from "@/services/privacy";
import type { CaseDetailModel } from "@/services/views/cases";
import { AppLink } from "@/ui/components/AppLink";
import { NoticeLabel } from "@/ui/components/badges";
import { Money } from "@/ui/components/Money";
import { Surface } from "@/ui/components/Surface";
import { incidentHref } from "@/ui/shell/nav";

const PAYMENT_STATE: Record<string, { label: string; color: "positive" | "notice" | "neutral" | "information" }> = {
  captured: { label: "Captured", color: "neutral" },
  authorized: { label: "Authorised, not captured", color: "notice" },
  refunded: { label: "Refunded", color: "neutral" },
  created: { label: "Created", color: "neutral" },
  failed: { label: "Failed", color: "neutral" },
};

const CONTACT_LABEL = {
  none: "Not contacted",
  notified: "Notified by LearnLoop",
  customer_initiated: "Customer contacted LearnLoop",
} as const;

const METHOD_LABEL = { upi: "UPI", card: "Card", netbanking: "Netbanking" } as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.1" paddingY="spacing.3">
      <Text size="xsmall" color="surface.text.gray.muted">{label}</Text>
      {children}
    </Box>
  );
}

export function PaymentPanel({ model, now, services }: { model: CaseDetailModel; now: Date; services: AppServices }) {
  const { payment, customer, contract, related, otherAttempts, customerView, caseData } = model;
  const [revealed, setRevealed] = useState<{ email: string; phone: string } | null>(null);
  useEffect(() => setRevealed(null), [caseData.id]);
  const reveal = () => setRevealed(revealCustomerContact(services.repos, caseData.id, OPERATOR, new Date().toISOString()));
  const state = PAYMENT_STATE[payment.status] ?? { label: payment.status, color: "neutral" as const };
  return (
    <Surface title="Payment and customer">
      <Field label="Customer">
        <Text size="small" weight="semibold">{customer.name}</Text>
        <Text size="xsmall" color="surface.text.gray.subtle">{revealed?.email ?? customer.email}</Text>
        <Text size="xsmall" color="surface.text.gray.subtle">{revealed?.phone ?? customer.phone}</Text>
        {customer.emailOptOut ? <Text size="xsmall" color="surface.text.gray.muted">Opted out of email</Text> : null}
        {revealed ? (
          <Text size="xsmall" color="surface.text.gray.muted">Shown in full; recorded in the audit log.</Text>
        ) : (
          <Box>
            <Button variant="tertiary" size="xsmall" accessibilityLabel={`Show full contact details for ${customer.name}`} onClick={reveal}>
              Show contact details
            </Button>
          </Box>
        )}
      </Field>
      <Divider />
      <Field label="Payment">
        <Box display="flex" alignItems="center" gap="spacing.2">
          <Money value={payment.amount} size="medium" weight="semibold" />
          <Text size="small" color="surface.text.gray.subtle">· {METHOD_LABEL[payment.method]}</Text>
        </Box>
        {model.product ? <Text size="xsmall" color="surface.text.gray.subtle">{model.product.name}</Text> : null}
      </Field>
      <Field label="Payment ID">
        <Code size="small">{payment.id}</Code>
      </Field>
      <Field label="Order ID">
        <Text size="small">{payment.merchantOrderId}</Text>
        <Code size="small">{payment.orderId}</Code>
      </Field>
      <Field label="Payment state">
        <Box display="flex">
          {state.color === "notice" ? <NoticeLabel>{state.label}</NoticeLabel> : <Badge color={state.color} size="medium">{state.label}</Badge>}
        </Box>
        {payment.captureDeadline && payment.status === "authorized" ? (
          <Text size="xsmall" color="feedback.text.notice.intense">
            Refunded automatically after {formatIstShort(payment.captureDeadline, now)} if not captured
          </Text>
        ) : null}
      </Field>
      <Divider />
      <Field label="Outcome Contract">
        <Text size="small">{contract.name}</Text>
        <Text size="xsmall" color="surface.text.gray.subtle">
          {contract.expectedOutcome} within {contract.deadlineSeconds >= 60 ? `${contract.deadlineSeconds / 60} min` : `${contract.deadlineSeconds} s`}
        </Text>
      </Field>
      {model.incident ? (
        <Field label="Incident">
          <AppLink href={incidentHref(model.incident.id)}>{model.incident.id}</AppLink>
          <Text size="xsmall" color="surface.text.gray.subtle">{model.incident.title}</Text>
        </Field>
      ) : null}
      <Divider />
      <Field label="Customer contact">
        <Text size="small">{CONTACT_LABEL[caseData.customerContact]}</Text>
        <Text size="xsmall" color="surface.text.gray.subtle">Customer sees: “{customerView.message}”</Text>
      </Field>
      <Field label="Related attempts">
        {related.length === 0 && otherAttempts.length === 0 ? (
          <Text size="small" color="surface.text.gray.muted">None</Text>
        ) : (
          <Box display="flex" flexDirection="column" gap="spacing.2">
            {related.map((p) => (
              <Box key={p.id}>
                <Code size="small">{p.id}</Code>
                <Text size="xsmall" color="surface.text.gray.subtle">
                  Second payment · {formatINR(p.amount)} · {p.status} · {formatIstShort(p.capturedAt ?? p.createdAt, now)}
                </Text>
              </Box>
            ))}
            {otherAttempts.map((p) => (
              <Box key={p.id}>
                <Code size="small">{p.id}</Code>
                <Text size="xsmall" color="surface.text.gray.subtle">
                  Other purchase · {p.status} · {formatIstShort(p.createdAt, now)}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Field>
    </Surface>
  );
}
