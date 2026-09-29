import type { Repositories } from "@/repositories";

/** Payment Integrity sends through the merchant's customer-communications integration, by email. */
export const MESSAGE_CHANNEL = "Email (Marrow learner communications)";
export const MESSAGE_CONSENT = "Transactional: about the customer's own purchase. No marketing content.";

export type CommunicationSummary = {
  channel: string;
  consent: string;
  /** Customers who will receive the message. */
  recipients: number;
  recipientLabel: string;
  /** Customers excluded because they opted out of email. */
  optedOut: number;
  format: "template" | "free_form";
  formatLabel: string;
  reviewRequired: boolean;
  reviewLabel: string;
};

const normalise = (text: string) => text.replace(/\s+/g, " ").trim();

/** Customers of the given cases who may receive email, and those who opted out. */
export function messageAudience(repos: Repositories, customerIds: readonly string[]) {
  const unique = [...new Set(customerIds)];
  const optedOut = unique.filter((id) => repos.payments.customer(id)?.emailOptOut === true);
  return { recipients: unique.filter((id) => !optedOut.includes(id)), optedOut };
}

/**
 * What a merchant needs to know before sending: channel, consent basis,
 * opt-outs, how many people receive it, whether it is the contract template
 * or free-form text, and whether approval is required.
 */
export function communicationSummary(repos: Repositories, customerIds: readonly string[], text: string, template?: string): CommunicationSummary {
  const { recipients, optedOut } = messageAudience(repos, customerIds);
  const single = recipients.length === 1 ? repos.payments.customer(recipients[0]!)?.name : undefined;
  const isTemplate = template !== undefined && normalise(text) === normalise(template);
  const reviewRequired = repos.config.globalControls().requireApprovalForCustomerCommunication;
  return {
    channel: MESSAGE_CHANNEL,
    consent: MESSAGE_CONSENT,
    recipients: recipients.length,
    recipientLabel: single ?? `${recipients.length} ${recipients.length === 1 ? "customer" : "customers"}`,
    optedOut: optedOut.length,
    format: isTemplate ? "template" : "free_form",
    formatLabel: isTemplate ? "Outcome Contract template" : "Free-form; checked for internal detail before sending",
    reviewRequired,
    reviewLabel: reviewRequired ? "Required: nothing is sent until you press Send" : "Not required by global controls",
  };
}
