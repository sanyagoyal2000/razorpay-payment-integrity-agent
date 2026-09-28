"use client";

import {
  Avatar,
  Badge,
  Menu,
  MenuHeader,
  MenuItem,
  MenuOverlay,
  Box,
  SideNav,
  SideNavBody,
  SideNavLink,
  SideNavSection,
  SkipNavContent,
  SkipNavLink,
  Text,
  TopNav,
  TopNavActions,
  TopNavBrand,
  TopNavContent,
} from "@razorpay/blade/components";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { MERCHANT, OPERATOR } from "@/fixtures/catalogue";
import { BASE_PATH, isActive, NAV_ITEMS } from "./nav";
import { SystemStatusBanner } from "./SystemStatusBanner";
import { GlobalSearch } from "./GlobalSearch";
import { RouterLink } from "./RouterLink";

const TOP_NAV_HEIGHT = "56px";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <Box display="flex" flexDirection="column" height="100vh" backgroundColor="surface.background.gray.subtle">
      {/* Raised above the top bar so the link is visible when focused. */}
      <div style={{ position: "relative", zIndex: 2000 }}>
        <SkipNavLink _hasBackground />
      </div>
      <TopNav>
        <TopNavBrand>
          <Text size="large" weight="semibold" color="surface.text.staticWhite.normal">
            Razorpay
          </Text>
        </TopNavBrand>
        <TopNavContent>
          <Box display={{ base: "none", l: "flex" }} alignItems="center" gap="spacing.3">
            <Text size="small" color="surface.text.staticWhite.muted">
              Agent Studio
            </Text>
            <Text size="small" color="surface.text.staticWhite.muted" aria-hidden>
              /
            </Text>
            <Text size="small" weight="semibold" color="surface.text.staticWhite.normal">
              Payment Integrity
            </Text>
          </Box>
        </TopNavContent>
        <TopNavActions>
          <Box display="flex" alignItems="center" gap="spacing.4">
            <GlobalSearch />
            <Text size="small" color="surface.text.staticWhite.normal">
              {MERCHANT.name}
            </Text>
            <Badge color="positive" size="small" emphasis="intense">
              Live
            </Badge>
            <Menu>
              <Avatar name={OPERATOR.name} size="small" color="primary" />
              <MenuOverlay>
                <MenuHeader title={OPERATOR.name} subtitle={OPERATOR.role} />
                <MenuItem title="Developer settings" onClick={() => router.push(`${BASE_PATH}/developer`)} />
              </MenuOverlay>
            </Menu>
          </Box>
        </TopNavActions>
      </TopNav>
      <Box position="relative" flex="1" display="flex" overflow="hidden">
        <SideNav position="absolute" top="spacing.0" left="spacing.0" bottom="spacing.0" isExpanded>
          <SideNavBody>
            <SideNavSection title="Payment Integrity">
              {NAV_ITEMS.map((item) => (
                <SideNavLink
                  key={item.href}
                  as={RouterLink}
                  href={item.href}
                  title={item.title}
                  icon={item.icon}
                  isActive={isActive(item, pathname)}
                />
              ))}
            </SideNavSection>
          </SideNavBody>
        </SideNav>
        <Box
          flex="1"
          overflowY="auto"
          marginLeft={{ base: "spacing.0", m: "240px" }}
          display="flex"
          flexDirection="column"
          minHeight={`calc(100vh - ${TOP_NAV_HEIGHT})`}
        >
          <SkipNavContent />
          <Box as="main" flex="1" width="100%" maxWidth="1440px" marginX="auto" paddingX="spacing.8" paddingY="spacing.7">
            <SystemStatusBanner />
            {children}
          </Box>
          <Box as="footer" paddingX="spacing.8" paddingY="spacing.4" borderTopWidth="thin" borderTopColor="surface.border.gray.muted">
            <Text size="xsmall" color="surface.text.gray.muted">
              Concept prototype built on simulated data. Not an official Razorpay product.
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
