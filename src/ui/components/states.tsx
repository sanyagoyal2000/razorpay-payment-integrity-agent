"use client";

import { Alert, Box, Button, EmptyState, Skeleton, Text } from "@razorpay/blade/components";
import type { ReactNode } from "react";

/** Skeleton for a page whose data is loading. Rendered on the server and on first client paint. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Box aria-busy="true" aria-live="polite">
      <Text size="small" color="surface.text.gray.muted" marginBottom="spacing.4">
        Loading payment and outcome data
      </Text>
      <Skeleton height="36px" width="320px" borderRadius="medium" marginBottom="spacing.3" />
      <Skeleton height="20px" width="560px" borderRadius="medium" marginBottom="spacing.7" />
      <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap="spacing.4" marginBottom="spacing.7">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height="96px" borderRadius="medium" />
        ))}
      </Box>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height="180px" borderRadius="medium" marginBottom="spacing.5" />
      ))}
    </Box>
  );
}

export function PageError({ message }: { message: string }) {
  return (
    <Alert
      color="negative"
      title="Data could not be loaded"
      description={`${message}. Reload the page to try again.`}
      isDismissible={false}
      isFullWidth
    />
  );
}

export function EmptyMessage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Box paddingY="spacing.8">
      <EmptyState size="small" title={title} description={description}>
        {action ? (
          <Button variant="secondary" size="small" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
      </EmptyState>
    </Box>
  );
}

export function NotFound({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Box paddingY="spacing.10">
      <EmptyState size="medium" title={title} description={description}>
        {action}
      </EmptyState>
    </Box>
  );
}
