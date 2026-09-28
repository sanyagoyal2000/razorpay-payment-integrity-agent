import type { ReactNode } from "react";
import { AppShell } from "@/ui/shell/AppShell";

export default function PaymentIntegrityLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
