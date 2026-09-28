"use client";

import { BladeProvider, ToastContainer } from "@razorpay/blade/components";
import { bladeTheme } from "@razorpay/blade/tokens";
import { setState as setI18nState } from "@razorpay/i18nify-js/core";
import { LazyMotion } from "framer-motion";
import type { ReactNode } from "react";
import { DataProvider } from "./DataProvider";

// Amounts use Indian digit grouping (₹1,82,457) regardless of the browser's locale.
setI18nState({ locale: "en-IN" });

const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <BladeProvider themeTokens={bladeTheme} colorScheme="light">
      <LazyMotion strict features={loadFeatures}>
        <DataProvider>{children}</DataProvider>
        <ToastContainer />
      </LazyMotion>
    </BladeProvider>
  );
}
