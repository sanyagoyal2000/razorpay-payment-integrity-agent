import "@razorpay/blade/fonts.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "@/ui/providers/AppProviders";
import { StyledComponentsRegistry } from "./registry";

export const metadata: Metadata = {
  title: "Payment Integrity · Razorpay Agent Studio",
  description: "Monitor and recover successful payments that have not completed their promised outcome.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <StyledComponentsRegistry>
          <AppProviders>{children}</AppProviders>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
