import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { AppShell, type OfficialLogo } from "@/ui/shell/AppShell";

const LOGO_FILE = "brand/razorpay-wordmark-white.png";

/**
 * Razorpay's official white wordmark, if it has been placed in /public/brand.
 * Its size is read from the PNG header so the aspect ratio is preserved.
 */
function officialLogo(): OfficialLogo | null {
  const file = path.join(process.cwd(), "public", LOGO_FILE);
  if (!existsSync(file)) return null;
  const png = readFileSync(file);
  if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") return null;
  return { src: `/${LOGO_FILE}`, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export default function PaymentIntegrityLayout({ children }: { children: ReactNode }) {
  return <AppShell logo={officialLogo()}>{children}</AppShell>;
}
