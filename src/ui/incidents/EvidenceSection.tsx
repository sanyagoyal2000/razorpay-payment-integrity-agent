"use client";

import { Box, Code, Collapsible, CollapsibleBody, CollapsibleLink, Divider, Text } from "@razorpay/blade/components";
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
      description={`${count} key events cited by the investigation, grouped by what they show. Every item is a recorded event; nothing here is inferred.`}
    >
      {count === 0 ? (
        <Text size="small" color="surface.text.gray.muted">No evidence has been recorded for this incident.</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="spacing.5">
          {groups.map((group) => (
            <Collapsible key={group.label} defaultIsExpanded={group.items.length <= 3}>
              <CollapsibleLink size="small">{`${group.label} (${group.items.length})`}</CollapsibleLink>
              <CollapsibleBody width="100%">
              <Box borderWidth="thin" borderColor="surface.border.gray.muted" borderRadius="medium" marginTop="spacing.2">
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
              </CollapsibleBody>
            </Collapsible>
          ))}
        </Box>
      )}
    </Surface>
  );
}
