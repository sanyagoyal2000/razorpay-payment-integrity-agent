import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { AppShell, type OfficialLogo } from "@/ui/shell/AppShell";

/**
 * Razorpay's official wordmark in its reversed (white text) form for the black
 * top bar: public/brand/razorpay.svg with only the navy text recoloured white.
 */
const LOGO_FILE = "brand/razorpay-wordmark-white.svg";

/** The wordmark and its intrinsic size from the SVG viewBox, so the aspect ratio is preserved. */
function officialLogo(): OfficialLogo | null {
  const file = path.join(process.cwd(), "public", LOGO_FILE);
  if (!existsSync(file)) return null;
  const viewBox = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(readFileSync(file, "utf8"));
  if (!viewBox) return null;
  return { src: `/${LOGO_FILE}`, width: Number(viewBox[1]), height: Number(viewBox[2]) };
}

export default function PaymentIntegrityLayout({ children }: { children: ReactNode }) {
  return <AppShell logo={officialLogo()}>{children}</AppShell>;
}
