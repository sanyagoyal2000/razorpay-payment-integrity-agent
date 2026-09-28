"use client";

import NextLink from "next/link";
import { forwardRef, type AnchorHTMLAttributes } from "react";

type RouterLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to?: string; href?: string };

/**
 * Adapts Next.js Link to Blade's `as` prop. Blade navigation components pass
 * the destination as `to` (the react-router convention).
 */
export const RouterLink = forwardRef<HTMLAnchorElement, RouterLinkProps>(function RouterLink({ to, href, ...rest }, ref) {
  return <NextLink ref={ref} href={to ?? href ?? "#"} {...rest} />;
});
