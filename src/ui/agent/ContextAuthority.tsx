"use client";

import { Box, CheckIcon, CloseIcon, Heading, Text } from "@razorpay/blade/components";
import type { Authority, ContextAndAuthority } from "@/services/views/agentProfile";
import { CASE_TYPE_LABELS } from "@/services/views/overview";
import { NoticeLabel } from "@/ui/components/badges";

const AUTHORITY_TONE: Record<Authority, "neutral" | "notice" | "information" | "negative"> = {
  suggest_only: "neutral",
  approval_required: "notice",
  automatic: "information",
  not_permitted: "negative",
};

function AuthorityLabel({ authority, label }: { authority: Authority; label: string }) {
  if (AUTHORITY_TONE[authority] === "notice") return <NoticeLabel>{label}</NoticeLabel>;
  return (
    <Text size="small" weight="semibold" color={authority === "not_permitted" ? "feedback.text.negative.intense" : "surface.text.gray.normal"}>
      {label}
    </Text>
  );
}

/**
 * Context the agent can read and the authority it has to act, kept apart:
 * connecting a source grants context, never the right to act through it.
 */
export function ContextAuthorityView({ model, headingLevel = "h3" }: { model: ContextAndAuthority; headingLevel?: "h2" | "h3" }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.5">
      <Text size="small" color="surface.text.gray.subtle">{model.principle}</Text>
      <Box display="grid" gridTemplateColumns={{ base: "1fr", l: "1fr 1fr" }} gap="spacing.6" alignItems="start">
        <Box display="flex" flexDirection="column" gap="spacing.3">
          <Heading as={headingLevel} size="small" weight="semibold">Context available (read-only)</Heading>
          {model.context.map((c) => (
            <Box key={c.id} display="grid" gridTemplateColumns="20px 1fr" columnGap="spacing.3">
              <Box paddingTop="spacing.1">
                {c.available ? <CheckIcon size="small" color="surface.icon.gray.normal" /> : <CloseIcon size="small" color="surface.icon.gray.muted" />}
              </Box>
              <Box>
                <Text size="small" weight="medium">{c.label}{c.available ? "" : " (unavailable)"}</Text>
                <Text size="xsmall" color="surface.text.gray.muted">{c.source} · {c.detail}</Text>
              </Box>
            </Box>
          ))}
        </Box>
        <Box display="flex" flexDirection="column" gap="spacing.3">
          <Heading as={headingLevel} size="small" weight="semibold">Actions allowed for {model.contract.name}</Heading>
          {model.actions.map((a) => (
            <Box key={a.action} display="flex" justifyContent="space-between" gap="spacing.4" paddingBottom="spacing.2" borderBottomWidth="thin" borderBottomColor="surface.border.gray.muted">
              <Box>
                <Text size="small" weight="medium">{a.label}</Text>
                <Text size="xsmall" color="surface.text.gray.muted">{a.detail}</Text>
              </Box>
              <Box flexShrink={0}>
                <AuthorityLabel authority={a.authority} label={a.authorityLabel} />
              </Box>
            </Box>
          ))}
          {model.alwaysReview.length > 0 ? (
            <Text size="xsmall" color="surface.text.gray.muted">
              Always reviewed by you, whatever the mode: {model.alwaysReview.map((t) => CASE_TYPE_LABELS[t]).join(", ")}.
            </Text>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
