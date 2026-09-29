"use client";

import { Box, Code, Divider, Text } from "@razorpay/blade/components";
import { Fragment } from "react";
import { formatIstShort } from "@/domain/time";
import type { IncidentWorkspaceModel } from "@/services/views/incidents";
import { Surface } from "@/ui/components/Surface";

export function EvidenceSection({ groups, now }: { groups: IncidentWorkspaceModel["evidence"]; now: Date }) {
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <Surface
      id="evidence"
      title="Evidence"
      description={`${count} events from Razorpay, LearnLoop and LearnLoop Observability. Every item is a recorded event; nothing here is inferred.`}
    >
      {count === 0 ? (
        <Text size="small" color="surface.text.gray.muted">No evidence has been recorded for this incident.</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="spacing.5">
          {groups.map((group) => (
            <Box key={group.label}>
              <Text size="small" weight="semibold" marginBottom="spacing.2">
                {group.label}
              </Text>
              <Box borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium">
                {group.items.map((item, index) => (
                  <Fragment key={item.id}>
                    {index > 0 ? <Divider /> : null}
                    <Box display="grid" gridTemplateColumns={{ base: "1fr", m: "120px 1fr 170px" }} gap="spacing.4" paddingX="spacing.4" paddingY="spacing.3" alignItems="center">
                      <Text size="xsmall" color="surface.text.gray.subtle">{formatIstShort(item.occurredAt, now)}</Text>
                      <Box>
                        <Text size="small">{item.title}</Text>
                        <Text size="xsmall" color="surface.text.gray.muted">
                          {item.source}
                          {item.detail ? ` · ${item.detail}` : ""}
                        </Text>
                      </Box>
                      <Code size="small">{item.id}</Code>
                    </Box>
                  </Fragment>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Surface>
  );
}
