import {
  DashboardIcon,
  AlertTriangleIcon,
  type IconComponent,
} from "@razorpay/blade/components";

export const BASE_PATH = "/payment-integrity";

export type NavItem = { title: string; href: string; icon: IconComponent; exact?: boolean };

/** Payment Integrity navigation. Items are added as each surface is built. */
export const NAV_ITEMS: NavItem[] = [
  { title: "Overview", href: BASE_PATH, icon: DashboardIcon, exact: true },
  { title: "Incidents", href: `${BASE_PATH}/incidents`, icon: AlertTriangleIcon },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
