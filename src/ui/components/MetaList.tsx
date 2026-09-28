"use client";

import { Text } from "@razorpay/blade/components";
import type { ReactNode } from "react";

export type MetaItem = { label: string; value: ReactNode; help?: string };

/**
 * Key-value summary rendered as a valid description list, styled with Blade
 * Text. Used instead of Blade InfoGroup, whose markup nests dt/dd two levels
 * deep inside dl and fails the description-list accessibility rules.
 */
export function MetaList({ items, minColumnWidth = 150 }: { items: MetaItem[]; minColumnWidth?: number }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${minColumnWidth}px, 1fr))`, gap: "16px 24px", margin: 0 }}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>
            <Text size="small" color="surface.text.gray.muted">{item.label}</Text>
          </dt>
          <dd style={{ margin: "4px 0 0" }}>
            {typeof item.value === "string" ? <Text size="small" weight="medium">{item.value}</Text> : item.value}
            {item.help ? <Text size="xsmall" color="surface.text.gray.muted">{item.help}</Text> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
