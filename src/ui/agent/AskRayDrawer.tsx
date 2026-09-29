"use client";

import { Alert, Box, Button, Code, Drawer, DrawerBody, DrawerHeader, Spinner, Text, TextArea } from "@razorpay/blade/components";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { askRay, type AskResult } from "@/services/agent/ask";
import type { AppServices } from "@/services/container";
import { AppLink } from "@/ui/components/AppLink";
import { RayIdentity } from "@/ui/ray/RayIdentity";
import { RAY } from "@/ui/ray/theme";
import { caseHref, incidentSectionHref } from "@/ui/shell/nav";

const NEXT_STEPS: Record<AskResult["nextStep"], { label: string; section: string } | null> = {
  review_recovery: { label: "Review recovery", section: "recovery" },
  view_investigation: { label: "View investigation", section: "investigation" },
  view_evidence: { label: "View evidence", section: "evidence" },
  none: null,
};

function Answer({ result, incidentId, onNavigate }: { result: AskResult; incidentId: string; onNavigate: (href: string) => void }) {
  const next = NEXT_STEPS[result.nextStep];
  return (
    <Box display="flex" flexDirection="column" gap="spacing.3" paddingBottom="spacing.5" borderBottomWidth="thin" borderBottomColor="surface.border.gray.muted">
      <Box>
        <Text size="xsmall" color="surface.text.gray.muted">You asked</Text>
        <Text size="small" weight="semibold">{result.question}</Text>
      </Box>
      <Box backgroundColor={result.inScope ? RAY.surfaceSubtle : "surface.background.gray.moderate"} borderRadius="medium" padding="spacing.4" display="flex" flexDirection="column" gap="spacing.3">
        <RayIdentity label={result.inScope ? "Answer" : "Outside this incident"} size="xsmall" />
        <Text size="small">{result.answer}</Text>
        {result.unsupported ? (
          <Text size="xsmall" weight="semibold" color="feedback.text.notice.intense">No evidence was cited, so treat this answer as unverified.</Text>
        ) : null}
      </Box>
      {result.citations.length > 0 ? (
        <Box display="flex" flexDirection="column" gap="spacing.2">
          <Text size="xsmall" weight="semibold" color="surface.text.gray.subtle">Based on</Text>
          {result.citations.map((c) => (
            <Box key={c.id} display="grid" gridTemplateColumns="110px 1fr" columnGap="spacing.3">
              {c.kind === "case" ? (
                <AppLink href={caseHref(c.id)} size="xsmall">{c.id}</AppLink>
              ) : c.kind === "fact" ? (
                <Text size="xsmall" color="surface.text.gray.muted">Product fact</Text>
              ) : (
                <Code size="small">{c.id}</Code>
              )}
              <Text size="xsmall" color="surface.text.gray.subtle">{c.title}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {result.removedIds.length > 0 ? (
        <Text size="xsmall" color="surface.text.gray.muted">Removed {result.removedIds.length} cited {result.removedIds.length === 1 ? "ID" : "IDs"} that are not in this incident&apos;s evidence.</Text>
      ) : null}
      {next ? (
        <Box>
          <Button variant="secondary" size="small" onClick={() => onNavigate(incidentSectionHref(incidentId, next.section))}>{next.label}</Button>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Ask RAY: bounded questions about one incident. Answers come only from the
 * incident's permitted evidence and the product's own facts, cite what they
 * rest on, and can point to where to act. Nothing is executed from here.
 */
export function AskRayDrawer({
  isOpen,
  onDismiss,
  incidentId,
  suggestions,
  services,
}: {
  isOpen: boolean;
  onDismiss: () => void;
  incidentId: string;
  suggestions: string[];
  services: AppServices;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AskResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setAnswers([]);
    setQuestion("");
  }, [incidentId]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || asking) return;
    setAsking(q);
    setError(null);
    try {
      const result = await askRay(services, incidentId, q);
      setAnswers((current) => [result, ...current]);
      setQuestion("");
    } catch {
      setError("RAY could not answer. Nothing was changed; try again.");
    } finally {
      setAsking(null);
    }
  };
  const navigate = (href: string) => {
    const id = href.split("#")[1];
    onDismiss();
    // The tab lives in the URL, so a push switches it and keeps browser history.
    router.push(href, { scroll: false });
    if (!id) return;
    // The drawer returns focus to its trigger when it finishes closing, which scrolls back up.
    // Scroll only once it has left the page.
    const started = Date.now();
    const scrollWhenClosed = () => {
      const open = document.querySelector('[aria-label="Ask RAY about this incident"]');
      if (open && Date.now() - started < 3000) {
        window.setTimeout(scrollWhenClosed, 50);
        return;
      }
      window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    };
    window.setTimeout(scrollWhenClosed, 50);
  };

  return (
    <Drawer isOpen={isOpen} onDismiss={onDismiss} accessibilityLabel="Ask RAY about this incident">
      <DrawerHeader title="Ask RAY" subtitle={`About ${incidentId} only`} />
      <DrawerBody>
        <Box display="flex" flexDirection="column" gap="spacing.5">
          <Text size="small" color="surface.text.gray.subtle">
            Answers use only this incident&apos;s evidence from connected sources and the product&apos;s current policy facts, and cite what they rest on. RAY can explain
            and point you to where to act; it cannot approve or execute anything.
          </Text>
          {suggestions.length > 0 ? (
            <Box display="flex" flexDirection="column" gap="spacing.2" alignItems="flex-start">
              <Text size="xsmall" weight="semibold" color="surface.text.gray.subtle">Suggested questions</Text>
              {suggestions.map((s) => (
                <Button key={s} variant="tertiary" size="small" isDisabled={asking !== null} onClick={() => void ask(s)}>{s}</Button>
              ))}
            </Box>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
          >
            <Box display="flex" flexDirection="column" gap="spacing.3">
              <TextArea label="Your question" value={question} onChange={({ value }) => setQuestion(value ?? "")} maxCharacters={500} numberOfLines={2} placeholder="Ask about this incident's cases, evidence or recovery" />
              <Box>
                <Button type="submit" variant="secondary" size="small" isLoading={asking !== null} isDisabled={question.trim().length === 0 || asking !== null}>Ask</Button>
              </Box>
            </Box>
          </form>
          {error ? <Alert color="negative" title="No answer" description={error} isDismissible={false} isFullWidth /> : null}
          <div aria-live="polite">
            <Box display="flex" flexDirection="column" gap="spacing.5">
              {asking ? (
                <Box display="flex" alignItems="center" gap="spacing.3">
                  <Spinner accessibilityLabel="RAY is answering" size="medium" />
                  <Text size="small" color="surface.text.gray.subtle">Reading this incident&apos;s evidence to answer: {asking}</Text>
                </Box>
              ) : null}
              {answers.map((a) => (
                <Answer key={`${a.askedAt}-${a.question}`} result={a} incidentId={incidentId} onNavigate={navigate} />
              ))}
            </Box>
          </div>
        </Box>
      </DrawerBody>
    </Drawer>
  );
}
