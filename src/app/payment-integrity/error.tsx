"use client";

import { Box, Button, EmptyState } from "@razorpay/blade/components";

/** Shown if a page fails to render. Other pages and saved data are unaffected. */
export default function PaymentIntegrityError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Box paddingY="spacing.10">
      <EmptyState
        size="medium"
        title="This page could not be displayed"
        description="Your data is safe and nothing was changed. Try again, or open another page from the navigation."
      >
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </EmptyState>
    </Box>
  );
}
