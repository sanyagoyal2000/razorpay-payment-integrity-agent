"use client";

import { Box, Button, EmptyState } from "@razorpay/blade/components";

export default function NotFoundPage() {
  return (
    <Box minHeight="100vh" display="flex" alignItems="center" justifyContent="center" padding="spacing.6">
      <EmptyState size="medium" title="Page not found" description="The address may be mistyped, or the page may have moved.">
        <Button variant="secondary" onClick={() => window.location.assign("/payment-integrity")}>
          Go to Payment Integrity
        </Button>
      </EmptyState>
    </Box>
  );
}
