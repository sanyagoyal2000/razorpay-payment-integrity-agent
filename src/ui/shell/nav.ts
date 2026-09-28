import {
  AlertTriangleIcon,
  ClipboardIcon,
  DashboardIcon,
  FileTextIcon,
  HistoryIcon,
  LayersIcon,
  SlidersIcon,
  type IconComponent,
} from "@razorpay/blade/components";

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

export const caseHref = (caseId: string) => `${BASE_PATH}/cases/${caseId}`;
export const incidentHref = (incidentId: string) => `${BASE_PATH}/incidents/${incidentId}`;

export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
