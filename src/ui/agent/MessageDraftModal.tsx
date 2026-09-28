"use client";

import { Alert, Box, Button, Modal, ModalBody, ModalFooter, ModalHeader, Spinner, Text, TextArea } from "@razorpay/blade/components";
import { useEffect, useState } from "react";
import { checkCustomerMessage, type CheckedDraft } from "@/services/agent";

/**
 * Review a message the agent drafted before anything is sent. Edits are
 * re-checked for internal terms as you type; sending is blocked until clean.
 */
export function MessageDraftModal({
  isOpen,
  title,
  recipients,
  loadDraft,
  onSend,
  onDismiss,
  error,
}: {
  isOpen: boolean;
  title: string;
  recipients: string;
  loadDraft: () => Promise<CheckedDraft>;
  onSend: (message: string) => void;
  onDismiss: () => void;
  error?: string | null;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const draft = () => {
    setLoading(true);
    setLoadError(null);
    loadDraft()
      .then((d) => setText(d.body))
      .catch(() => setLoadError("The draft could not be prepared. Write the message yourself."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen) draft();
    else setText("");
    // Draft once each time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const flagged = checkCustomerMessage(text);
  return (
    <Modal isOpen={isOpen} onDismiss={onDismiss} size="medium" accessibilityLabel={title}>
      <ModalHeader title={title} subtitle={`To ${recipients}. Drafted by Payment Integrity Agent; review before sending.`} />
      <ModalBody>
        {loading ? (
          <Box display="flex" alignItems="center" gap="spacing.3" paddingY="spacing.6">
            <Spinner accessibilityLabel="Drafting message" size="medium" />
            <Text size="small" color="surface.text.gray.subtle">Drafting the message</Text>
          </Box>
        ) : (
          <Box display="flex" flexDirection="column" gap="spacing.4">
            <TextArea
              label="Message"
              value={text}
              onChange={({ value }) => setText(value ?? "")}
              numberOfLines={5}
              helpText="{first_name} is replaced with each customer's first name when sent."
            />
            {flagged.length > 0 ? (
              <Alert
                color="notice"
                title="Not customer-safe yet"
                description={`Remove ${flagged.join(", ")}. Customers must not see internal detail.`}
                isDismissible={false}
                isFullWidth
              />
            ) : (
              <Text size="xsmall" color="surface.text.gray.muted">
                Checked: no confidence scores, internal errors, webhook or system details, or policy thresholds.
              </Text>
            )}
            {loadError ? <Text size="small" color="feedback.text.notice.intense">{loadError}</Text> : null}
            {error ? <Text size="small" color="feedback.text.negative.intense">{error}</Text> : null}
          </Box>
        )}
      </ModalBody>
      <ModalFooter>
        <Box display="flex" justifyContent="space-between" gap="spacing.3">
          <Button variant="tertiary" onClick={draft} isDisabled={loading}>Draft again</Button>
          <Box display="flex" gap="spacing.3">
            <Button variant="secondary" onClick={onDismiss}>Cancel</Button>
            <Button variant="primary" isDisabled={loading || text.trim().length === 0 || flagged.length > 0} onClick={() => onSend(text.trim())}>
              Send
            </Button>
          </Box>
        </Box>
      </ModalFooter>
    </Modal>
  );
}
