"use client";

import {
  Avatar,
  Badge,
  Menu,
  MenuHeader,
  MenuItem,
  MenuOverlay,
  Box,
  Link,
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
import { useState, type ReactNode } from "react";
import { MERCHANT, OPERATOR } from "@/fixtures/catalogue";
import { BASE_PATH, isActive, NAV_ITEMS } from "./nav";
import { SystemStatusBanner } from "./SystemStatusBanner";
import { AgentDetailsDrawer } from "@/ui/agent/AgentDetailsDrawer";
import { RayIdentity } from "@/ui/ray/RayIdentity";
import { GlobalSearch } from "./GlobalSearch";
import { RouterLink } from "./RouterLink";

const TOP_NAV_HEIGHT = "56px";

export type OfficialLogo = { src: string; width: number; height: number };

const LOGO_HEIGHT = 22;

/**
 * Razorpay's official white wordmark, at its own aspect ratio. Until the
 * official file is present, the temporary text treatment is kept rather than
 * a recreated logo.
 */
function Wordmark({ logo }: { logo: OfficialLogo | null }) {
  if (!logo) {
    return (
      <Text size="large" weight="semibold" color="surface.text.staticWhite.normal">
        Razorpay
      </Text>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- a fixed-size static brand asset; next/image adds nothing here.
  return <img src={logo.src} alt="Razorpay" height={LOGO_HEIGHT} width={Math.round((LOGO_HEIGHT * logo.width) / logo.height)} style={{ display: "block", height: LOGO_HEIGHT, width: "auto" }} />;
}

export function AppShell({ children, logo = null }: { children: ReactNode; logo?: OfficialLogo | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [agentOpen, setAgentOpen] = useState(false);
  return (
    <Box display="flex" flexDirection="column" height="100vh" backgroundColor="surface.background.gray.subtle">
      {/* Raised above the top bar so the link is visible when focused. */}
      <div style={{ position: "relative", zIndex: 2000 }}>
        <SkipNavLink _hasBackground />
      </div>
      <TopNav>
        <TopNavBrand>
          <Box display="flex" alignItems="center" gap="spacing.4">
            <Wordmark logo={logo} />
            <RayIdentity name="RAY AI" tone="dark" />
          </Box>
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
            <Link variant="button" color="white" size="small" onClick={() => setAgentOpen(true)}>
              Agent details
            </Link>
          </Box>
        </TopNavContent>
        <TopNavActions>
          <Box display="flex" alignItems="center" gap="spacing.4">
            {/* Search needs more room than a phone's top bar has; the Cases page keeps full search. */}
            <Box display={{ base: "none", m: "block" }}>
              <GlobalSearch />
            </Box>
            <Box display={{ base: "none", m: "flex" }} alignItems="center" gap="spacing.4">
              <Text size="small" color="surface.text.staticWhite.normal">
                {MERCHANT.name}
              </Text>
              <Badge color="positive" size="small" emphasis="intense">
                Live
              </Badge>
            </Box>
            <Menu>
              <Avatar name={OPERATOR.name} size="small" color="primary" />
              <MenuOverlay>
                <MenuHeader title={OPERATOR.name} subtitle={OPERATOR.role} />
                <MenuItem title="Agent details" onClick={() => setAgentOpen(true)} />
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
          <AgentDetailsDrawer isOpen={agentOpen} onDismiss={() => setAgentOpen(false)} />
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
