"use client";

import { Link } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

type AppLinkProps = { href: string; children: string } & Pick<ComponentProps<typeof Link>, "size" | "color" | "accessibilityLabel">;

/** Blade Link with client-side navigation. */
export function AppLink({ href, children, size = "small", ...rest }: AppLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={href}
      size={size}
      {...rest}
      onClick={(event) => {
        const native = event.nativeEvent as MouseEvent;
        if (native.metaKey || native.ctrlKey || native.shiftKey) return;
        event.preventDefault();
        router.push(href);
      }}
    >
      {children}
    </Link>
  );
}
