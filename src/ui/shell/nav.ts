import {
  AgentStudioIcon,
  AlertTriangleIcon,
  ClipboardIcon,
  DashboardIcon,
  FileTextIcon,
  HistoryIcon,
  LayersIcon,
  ShieldIcon,
  SlidersIcon,
  type IconComponent,
} from "@razorpay/blade/components";

import { incidentSectionHref } from "@/services/views/incidentDecision";

export const BASE_PATH = "/payment-integrity";

export type NavItem = { title: string; href: string; icon: IconComponent; exact?: boolean };

/** Payment Integrity navigation. */
export const NAV_ITEMS: NavItem[] = [
  { title: "Overview", href: BASE_PATH, icon: DashboardIcon, exact: true },
  { title: "Incidents", href: `${BASE_PATH}/incidents`, icon: AlertTriangleIcon },
  { title: "Cases", href: `${BASE_PATH}/cases`, icon: FileTextIcon },
  { title: "Outcome Contracts", href: `${BASE_PATH}/contracts`, icon: ClipboardIcon },
  { title: "Automations", href: `${BASE_PATH}/automations`, icon: SlidersIcon },
  { title: "Integrations", href: `${BASE_PATH}/integrations`, icon: LayersIcon },
  { title: "Audit Log", href: `${BASE_PATH}/audit-log`, icon: HistoryIcon },
];

export const AGENT_PATH = `${BASE_PATH}/agent`;

export type ProductTab = { title: string; href: string; icon: IconComponent };

/** Product tabs in the top bar, in the Razorpay product-navigation pattern. */
export const PRODUCT_TABS: ProductTab[] = [
  { title: "Payment Integrity", href: BASE_PATH, icon: ShieldIcon },
  { title: "Agent details", href: AGENT_PATH, icon: AgentStudioIcon },
];

/** The selected product tab, derived from the route so it survives refresh and history navigation. */
export function activeProductTab(pathname: string): ProductTab["href"] | undefined {
  if (pathname === AGENT_PATH || pathname.startsWith(`${AGENT_PATH}/`)) return AGENT_PATH;
  if (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`)) return BASE_PATH;
  return undefined;
}

export const caseHref = (caseId: string) => `${BASE_PATH}/cases/${caseId}`;
export const incidentHref = (incidentId: string) => `${BASE_PATH}/incidents/${incidentId}`;

export { incidentSectionHref };

export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
