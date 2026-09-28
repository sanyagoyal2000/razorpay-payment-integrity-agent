"use client";

import { Amount } from "@razorpay/blade/components";
import type { ComponentProps } from "react";

type Size = "small" | "medium" | "large";

/** Whole-rupee amount in INR using Blade's Amount component. */
export function Money({ value, size = "small", weight }: { value: number; size?: Size; weight?: "regular" | "semibold" }) {
  const props = { value, currency: "INR", suffix: "none", type: "body", size, ...(weight ? { weight } : {}) } as ComponentProps<typeof Amount>;
  return <Amount {...props} />;
}

export function MoneyHeading({ value }: { value: number }) {
  const props = { value, currency: "INR", suffix: "none", type: "heading", size: "xlarge", weight: "semibold" } as ComponentProps<typeof Amount>;
  return <Amount {...props} />;
}
