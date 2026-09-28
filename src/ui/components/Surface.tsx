"use client";

import { Box, Heading, Text } from "@razorpay/blade/components";
import type { ReactNode } from "react";

/** White bordered surface with an optional section header. Used instead of stacked cards. */
export function Surface({
  title,
  description,
  actions,
  children,
  padded = true,
  id,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  id?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <Box
      as="section"
      backgroundColor="surface.background.gray.intense"
      borderWidth="thin"
      borderColor="surface.border.gray.muted"
      borderRadius="medium"
      {...(headingId ? { "aria-labelledby": headingId } : {})}
    >
      {title ? (
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="flex-start"
          gap="spacing.4"
          paddingX="spacing.6"
          paddingTop="spacing.5"
          paddingBottom={padded ? "spacing.0" : "spacing.4"}
        >
          <Box>
            <Heading as="h2" size="small" weight="semibold" {...(headingId ? { id: headingId } : {})}>
              {title}
            </Heading>
            {description ? (
              <Text size="small" color="surface.text.gray.muted" marginTop="spacing.1">
                {description}
              </Text>
            ) : null}
          </Box>
          {actions ? <Box flexShrink={0}>{actions}</Box> : null}
        </Box>
      ) : null}
      {/* Wide tables scroll inside their section; the page itself never scrolls sideways. */}
      <Box padding={padded ? "spacing.6" : "spacing.0"} overflowX="auto">{children}</Box>
    </Box>
  );
}
