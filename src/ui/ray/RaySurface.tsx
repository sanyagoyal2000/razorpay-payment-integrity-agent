"use client";

import { Box, Heading, Text } from "@razorpay/blade/components";
import type { ReactNode } from "react";
import { RayIdentity } from "./RayIdentity";
import { RAY_VALUES } from "./theme";

/**
 * Restrained container for AI-assisted content: a mint hairline border and,
 * optionally, a static green-to-blue wash behind the header only. Body content
 * stays on a neutral white surface.
 */
export function RaySurface({
  id,
  title,
  identity,
  identityName,
  description,
  actions,
  ambient = false,
  titleSize = "small",
  children,
}: {
  id?: string;
  title?: ReactNode;
  /** Label after "RAY ·", e.g. "Proactive briefing". */
  identity?: string;
  /** A complete identity instead, e.g. "RAY investigation". */
  identityName?: string;
  description?: ReactNode;
  actions?: ReactNode;
  ambient?: boolean;
  titleSize?: "small" | "large";
  children: ReactNode;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section {...(id ? { id, "aria-labelledby": headingId } : {})} style={{ scrollMarginTop: 16 }}>
      <div
        style={{
          border: `1px solid ${RAY_VALUES.borderSubtle}`,
          borderRadius: 8,
          background: "white",
          overflow: "hidden",
        }}
      >
        {title || identity || identityName ? (
          <div style={ambient ? { background: `linear-gradient(100deg, ${RAY_VALUES.glowStart} 0%, ${RAY_VALUES.glowEnd} 100%)` } : undefined}>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap="spacing.4" paddingX="spacing.6" paddingTop="spacing.5" paddingBottom={ambient ? "spacing.4" : "spacing.0"}>
              <Box display="flex" flexDirection="column" gap="spacing.1">
                {identityName ? <RayIdentity name={identityName} /> : identity ? <RayIdentity label={identity} /> : null}
                {title ? (
                  <div {...(headingId ? { id: headingId } : {})}>
                    <Heading as="h2" size={titleSize} weight="semibold">
                      {title}
                    </Heading>
                  </div>
                ) : null}
                {description ? (
                  <Text size="small" color="surface.text.gray.muted">
                    {description}
                  </Text>
                ) : null}
              </Box>
              {actions ? <Box flexShrink={0}>{actions}</Box> : null}
            </Box>
          </div>
        ) : null}
        <Box padding="spacing.6" overflowX="auto">
          {children}
        </Box>
      </div>
    </section>
  );
}
