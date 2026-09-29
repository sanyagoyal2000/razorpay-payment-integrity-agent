"use client";

import { Box, CheckCircleIcon, CreditCardIcon, ShieldIcon, StorefrontIcon, Text, UserIcon, type IconComponent } from "@razorpay/blade/components";
import { Fragment } from "react";
import { istDate, istTime } from "@/domain/time";
import type { TimelineEntry, TimelineSource } from "@/services/views/cases";
import { Surface } from "@/ui/components/Surface";

const SOURCES: Record<TimelineSource, { label: string; icon: IconComponent }> = {
  razorpay: { label: "Razorpay", icon: CreditCardIcon },
  merchant: { label: "Marrow", icon: StorefrontIcon },
  agent: { label: "Payment Integrity", icon: ShieldIcon },
  human: { label: "You", icon: UserIcon },
};

/** Chronological payment-to-outcome timeline. Sources are told apart by icon and label, not colour. */
export function TimelinePanel({ entries }: { entries: TimelineEntry[] }) {
  let lastDate = "";
  return (
    <Surface title="Event timeline" description="Times in IST. Razorpay, Marrow, Payment Integrity and your actions in one sequence.">
      <Box display="flex" gap="spacing.4" flexWrap="wrap" marginBottom="spacing.4">
        {(Object.keys(SOURCES) as TimelineSource[]).map((key) => {
          const { label, icon: Icon } = SOURCES[key];
          return (
            <Box key={key} display="flex" alignItems="center" gap="spacing.2">
              <Icon size="small" color="surface.icon.gray.muted" />
              <Text size="xsmall" color="surface.text.gray.muted">{label}</Text>
            </Box>
          );
        })}
      </Box>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {entries.map((entry) => {
          const { label, icon: Icon } = SOURCES[entry.source];
          const date = istDate(entry.at);
          const showDate = date !== lastDate;
          lastDate = date;
          return (
            <Fragment key={entry.id}>
              {showDate ? (
                <li>
                  <Text size="xsmall" weight="semibold" color="surface.text.gray.subtle" marginTop="spacing.3" marginBottom="spacing.2">
                    {new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                  </Text>
                </li>
              ) : null}
              <li>
                <Box display="grid" gridTemplateColumns="72px 20px 1fr" columnGap="spacing.3" paddingY="spacing.2" borderBottomWidth="thin" borderBottomColor="surface.border.gray.muted">
                  <Text size="small" color="surface.text.gray.subtle">{istTime(entry.at)}</Text>
                  <Box paddingTop="spacing.1" aria-hidden="true">
                    <Icon size="small" color="surface.icon.gray.subtle" />
                  </Box>
                  <Box>
                    <Box display="flex" alignItems="center" gap="spacing.2">
                      <Text size="small" weight={entry.source === "human" ? "semibold" : "regular"}>{entry.title}</Text>
                      {entry.tone === "success" ? <CheckCircleIcon size="small" color="feedback.icon.positive.intense" /> : null}
                    </Box>
                    <Text size="xsmall" color="surface.text.gray.muted">
                      {label}
                      {entry.detail ? ` · ${entry.detail}` : ""}
                    </Text>
                  </Box>
                </Box>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </Surface>
  );
}
