"use client";

import {
  Avatar,
  Badge,
  Menu,
  MenuHeader,
  MenuItem,
  MenuOverlay,
  Box,
  ChevronDownIcon,
  SideNav,
  SideNavBody,
  SideNavLink,
  SideNavSection,
  SkipNavContent,
  SkipNavLink,
  Text,
  TabNav,
  TabNavItem,
  TabNavItems,
  TopNav,
  TopNavActions,
  TopNavBrand,
  TopNavContent,
} from "@razorpay/blade/components";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { MERCHANT, OPERATOR } from "@/fixtures/catalogue";
import { activeProductTab, BASE_PATH, isActive, NAV_ITEMS, PRODUCT_TABS } from "./nav";
import { SystemStatusBanner } from "./SystemStatusBanner";
import { RayIdentity } from "@/ui/ray/RayIdentity";
import { GlobalSearch } from "./GlobalSearch";
import { RouterLink } from "./RouterLink";

const TOP_NAV_HEIGHT = "56px";

export type OfficialLogo = { src: string; width: number; height: number };

const LOGO_HEIGHT = 22;

/**
 * Razorpay's official wordmark, reversed for the black bar, at its own aspect ratio. Until the
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
  return (
    <Box display="flex" flexDirection="column" height="100vh" backgroundColor="surface.background.gray.subtle">
      {/* Raised above the top bar so the link is visible when focused. */}
      <div style={{ position: "relative", zIndex: 2000 }}>
        <SkipNavLink _hasBackground />
      </div>
      {/* One spacing step less side padding at tablet widths, so both product tabs fit without "More". */}
      <TopNav paddingX={{ base: "spacing.4", m: "spacing.2", xl: "spacing.3" }}>
        <TopNavBrand>
          <Box display="flex" alignItems="center" gap="spacing.4">
            <Wordmark logo={logo} />
            <RayIdentity name="RAY AI" tone="dark" />
          </Box>
        </TopNavBrand>
        <TopNavContent>
          {/* Below tablet width the tabs move into the account menu, with their labels. */}
          <Box display={{ base: "none", m: "flex" }} flex="1" width="100%" minWidth="0px">
          <TabNav items={PRODUCT_TABS.map((tab) => ({ ...tab, isActive: activeProductTab(pathname) === tab.href }))}>
            {({ items, overflowingItems }) => (
              <>
                <TabNavItems>
                  {items.map((item) => (
                    // Selection comes from the current route on every render, not from TabNav's stored items.
                    <TabNavItem key={item.title} title={item.title} href={item.href} icon={item.icon} isActive={activeProductTab(pathname) === item.href} as={RouterLink} />
                  ))}
                </TabNavItems>
                {overflowingItems.length > 0 ? (
                  <Menu openInteraction="click">
                    <TabNavItem title="More" accessibilityLabel="More product tabs" trailing={<ChevronDownIcon size="medium" />} />
                    <MenuOverlay>
                      {overflowingItems.map((item) => {
                        const Icon = PRODUCT_TABS.find((tab) => tab.href === item.href)?.icon;
                        return (
                          <MenuItem
                            key={item.title}
                            title={item.title}
                            {...(Icon ? { leading: <Icon size="medium" /> } : {})}
                            onClick={() => item.href && router.push(item.href)}
                          />
                        );
                      })}
                    </MenuOverlay>
                  </Menu>
                ) : null}
              </>
            )}
          </TabNav>
          </Box>
        </TopNavContent>
        <TopNavActions>
          <Box display="flex" alignItems="center" gap="spacing.4">
            {/* Search collapses before the product tabs do; "Search cases" in the account menu replaces it. */}
            <Box display={{ base: "none", xl: "block" }}>
              <GlobalSearch />
            </Box>
            <Box display={{ base: "none", l: "flex" }} alignItems="center" gap="spacing.4">
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
                <MenuHeader title={OPERATOR.name} subtitle={`${OPERATOR.role} · ${MERCHANT.name} (Live)`} />
                {PRODUCT_TABS.map((tab) => (
                  <MenuItem
                    key={tab.href}
                    title={tab.title}
                    leading={<tab.icon size="medium" />}
                    {...(activeProductTab(pathname) === tab.href ? { description: "Current page" } : {})}
                    onClick={() => router.push(tab.href)}
                  />
                ))}
                <MenuItem title="Search cases" onClick={() => router.push(`${BASE_PATH}/cases`)} />
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
              Concept prototype using simulated Marrow data. No real incident, system or customer data is represented.
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
