"use client";

import { Box, Breadcrumb, BreadcrumbItem, Heading, Text } from "@razorpay/blade/components";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  crumbs,
  meta,
  actions,
}: {
  title: string;
  description?: ReactNode;
  crumbs?: Crumb[];
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Box marginBottom="spacing.7">
      {crumbs && crumbs.length > 0 ? (
        <Box marginBottom="spacing.3">
          <Breadcrumb size="small" color="neutral">
            {crumbs.map((crumb, index) => (
              <BreadcrumbItem
                key={crumb.label}
                href={crumb.href ?? pathname}
                isCurrentPage={index === crumbs.length - 1}
                onClick={(event) => {
                  if (!crumb.href) return;
                  event.preventDefault();
                  router.push(crumb.href);
                }}
              >
                {crumb.label}
              </BreadcrumbItem>
            ))}
          </Breadcrumb>
        </Box>
      ) : null}
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap="spacing.6" flexWrap="wrap">
        <Box maxWidth="760px">
          <Heading as="h1" size="large" weight="semibold">
            {title}
          </Heading>
          {typeof description === "string" ? (
            <Text size="medium" color="surface.text.gray.subtle" marginTop="spacing.2">
              {description}
            </Text>
          ) : description ? (
            <Box marginTop="spacing.3">{description}</Box>
          ) : null}
        </Box>
        {actions ? <Box display="flex" gap="spacing.3" alignItems="center">{actions}</Box> : null}
      </Box>
      {meta ? <Box marginTop="spacing.5">{meta}</Box> : null}
    </Box>
  );
}
