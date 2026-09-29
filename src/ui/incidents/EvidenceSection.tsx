"use client";

import { Box, Button, Code, Collapsible, CollapsibleBody, CollapsibleLink, Divider, Text } from "@razorpay/blade/components";
import { Fragment, useEffect, useState } from "react";
import { formatIstShort } from "@/domain/time";
import { collapseAll, expandAll, initialExpansion, setGroupExpanded, type EvidenceExpansion } from "@/services/views/evidence";
import type { IncidentWorkspaceModel } from "@/services/views/incidents";
import { Surface } from "@/ui/components/Surface";

export function EvidenceSection({ groups, now }: { groups: IncidentWorkspaceModel["evidence"]; now: Date }) {
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  // Groups open by importance (cause and recovery evidence); collapsing hides items, never removes them.
  const [expanded, setExpanded] = useState<EvidenceExpansion>(() => initialExpansion(groups));
  const groupKeys = groups.map((g) => g.key).join("|");
  useEffect(() => setExpanded(initialExpansion(groups)), [groupKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Surface
      id="evidence"
      title="Evidence"
      description={`${count} key events cited by the investigation, grouped by what they show. Every item is a recorded event; nothing here is inferred.`}
      {...(groups.length > 1
        ? {
            actions: (
              <Box display="flex" gap="spacing.2">
                <Button variant="tertiary" size="small" onClick={() => setExpanded(expandAll(groups))}>Expand all</Button>
                <Button variant="tertiary" size="small" onClick={() => setExpanded(collapseAll(groups))}>Collapse all</Button>
              </Box>
            ),
          }
        : {})}
    >
      {count === 0 ? (
        <Text size="small" color="surface.text.gray.muted">No evidence has been recorded for this incident.</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap="spacing.5">
          {groups.map((group) => (
            <Collapsible
              key={group.key}
              isExpanded={expanded[group.key] ?? group.defaultExpanded}
              onExpandChange={({ isExpanded }) => setExpanded((current) => setGroupExpanded(current, group.key, isExpanded))}
            >
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
