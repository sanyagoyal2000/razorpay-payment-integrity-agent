"use client";

import { Box, Divider, Text } from "@razorpay/blade/components";
import { Fragment } from "react";
import { formatIstShort, formatRelative } from "@/domain/time";
import type { ActivityEntry } from "@/services/views/overview";
import { AppLink } from "@/ui/components/AppLink";
import { EmptyMessage } from "@/ui/components/states";
import { Surface } from "@/ui/components/Surface";
import { BASE_PATH } from "@/ui/shell/nav";

export function IntegrityActivity({ entries, now }: { entries: ActivityEntry[]; now: Date }) {
  return (
    <Surface title="Integrity activity" description="Verified outcomes, resolutions, policy changes, blocked actions and new incidents">
      {entries.length === 0 ? (
        <EmptyMessage title="No recent activity" description="Nothing has been verified, resolved, blocked or changed recently." />
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((entry, index) => (
            <Fragment key={entry.id}>
              <li>
              {index > 0 ? <Divider /> : null}
              <Box display="grid" gridTemplateColumns="96px 1fr" gap="spacing.4" paddingY="spacing.3">
                <Box>
                  <Text size="xsmall" color="surface.text.gray.subtle">{formatIstShort(entry.occurredAt, now)}</Text>
                  <Text size="xsmall" color="surface.text.gray.muted">{formatRelative(entry.occurredAt, now)}</Text>
                </Box>
                <Box>
                  <Text size="xsmall" weight="semibold" color="surface.text.gray.subtle">{entry.category}</Text>
                  <Text size="small">{entry.summary}</Text>
                  {entry.incidentId ? (
                    <AppLink href={`${BASE_PATH}/incidents/${entry.incidentId}`} size="xsmall">{entry.incidentId}</AppLink>
                  ) : null}
                </Box>
              </Box>
              </li>
            </Fragment>
          ))}
        </ol>
      )}
    </Surface>
  );
}
