"use client";

import {
  Box,
  Button,
  CheckCircleIcon,
  ClockIcon,
  Heading,
  InfoIcon,
  RefreshIcon,
  SearchIcon,
  Spinner,
  Text,
  TextInput,
  type IconComponent,
} from "@razorpay/blade/components";
import { useRef, useState, type FormEvent } from "react";
import { lookupPayment, validateLookup, type LookupResult } from "@/services/customerLookup";
import { useDataState } from "@/ui/providers/DataProvider";

const RESULT_UI: Record<LookupResult["status"], { title: string; icon: IconComponent; iconColor: "feedback.icon.positive.intense" | "surface.icon.gray.normal" }> = {
  resolved: { title: "Payment successful", icon: CheckCircleIcon, iconColor: "feedback.icon.positive.intense" },
  recovery_in_progress: { title: "Recovery in progress", icon: RefreshIcon, iconColor: "surface.icon.gray.normal" },
  under_review: { title: "Under review", icon: ClockIcon, iconColor: "surface.icon.gray.normal" },
  refunded: { title: "Payment refunded", icon: InfoIcon, iconColor: "surface.icon.gray.normal" },
  not_found: { title: "No matching payment", icon: SearchIcon, iconColor: "surface.icon.gray.normal" },
};

/** Customer-facing page. No admin chrome and no internal detail. */
export function CheckPaymentPage() {
  const data = useDataState();
  const [phone, setPhone] = useState("");
  const [orderId, setOrderId] = useState("");
  const [errors, setErrors] = useState<{ phone?: string; orderId?: string }>({});
  const [result, setResult] = useState<LookupResult | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateLookup(phone, orderId);
    setErrors(found);
    if (Object.keys(found).length > 0 || data.status !== "ready") return;
    setResult(lookupPayment(data.services.repos, { phone, orderId }, new Date().toISOString()));
    requestAnimationFrame(() => resultRef.current?.focus());
  };

  const ui = result ? RESULT_UI[result.status] : undefined;
  return (
    <Box minHeight="100vh" backgroundColor="surface.background.gray.subtle">
      <Box as="header" backgroundColor="surface.background.gray.intense" borderBottomWidth="thin" borderBottomColor="surface.border.gray.muted" paddingX="spacing.5" paddingY="spacing.4">
        <Box maxWidth="480px" marginX="auto">
          <Text size="large" weight="semibold">Marrow</Text>
        </Box>
      </Box>
      <Box as="main" maxWidth="480px" marginX="auto" paddingX="spacing.5" paddingY="spacing.8">
        <Heading as="h1" size="large" weight="semibold">Check my payment</Heading>
        <Text size="medium" color="surface.text.gray.subtle" marginTop="spacing.2" marginBottom="spacing.6">
          Enter the phone number you paid with and your order ID. You can find the order ID in your confirmation email.
        </Text>
        <form onSubmit={submit} noValidate>
          <Box display="flex" flexDirection="column" gap="spacing.5" padding="spacing.6" backgroundColor="surface.background.gray.intense" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium">
            <TextInput
              label="Phone number"
              type="telephone"
              name="phone"
              autoCompleteSuggestionType="telephone"
              value={phone}
              onChange={({ value }) => setPhone(value ?? "")}
              placeholder="98765 43210"
              isRequired
              necessityIndicator="none"
              {...(errors.phone ? { validationState: "error" as const, errorText: errors.phone } : {})}
            />
            <TextInput
              label="Order ID"
              name="orderId"
              value={orderId}
              onChange={({ value }) => setOrderId(value ?? "")}
              placeholder="MR-4301232"
              isRequired
              necessityIndicator="none"
              {...(errors.orderId ? { validationState: "error" as const, errorText: errors.orderId } : {})}
            />
            <Button type="submit" variant="primary" isFullWidth isDisabled={data.status !== "ready"}>
              Check payment
            </Button>
            {data.status === "loading" ? (
              <Box display="flex" alignItems="center" gap="spacing.2">
                <Spinner accessibilityLabel="Loading" size="medium" />
                <Text size="xsmall" color="surface.text.gray.muted">Getting ready</Text>
              </Box>
            ) : data.status === "error" ? (
              <Text size="small" color="feedback.text.negative.intense">This page could not load. Please refresh and try again.</Text>
            ) : null}
          </Box>
        </form>

        <div ref={resultRef} tabIndex={-1} aria-live="polite" style={{ outline: "none" }}>
          {result && ui ? (
            <Box marginTop="spacing.6" padding="spacing.6" backgroundColor="surface.background.gray.intense" borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" display="flex" gap="spacing.4">
              <Box paddingTop="spacing.1">
                <ui.icon size="large" color={ui.iconColor} />
              </Box>
              <Box>
                <Heading as="h2" size="small" weight="semibold">{ui.title}</Heading>
                {result.status !== "not_found" ? (
                  <Text size="small" color="surface.text.gray.muted" marginTop="spacing.1">{result.productName}</Text>
                ) : null}
                <Text size="medium" marginTop="spacing.3">{result.message}</Text>
              </Box>
            </Box>
          ) : null}
        </div>
      </Box>
    </Box>
  );
}
