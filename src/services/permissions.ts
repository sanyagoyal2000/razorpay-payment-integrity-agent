import type { Integration } from "@/domain/types";
import type { Repositories } from "@/repositories";

const connected = (repos: Repositories) => repos.config.integrations().filter((i) => i.status === "connected");

export const hasWriteAuthority = (i: Integration) => i.status === "connected" && i.writeAuthority !== "not_granted";

/** Scopes the agent may read: its context. Granted by connecting an integration. */
export function contextScopes(repos: Repositories): string[] {
  return [...new Set(connected(repos).flatMap((i) => i.scopes.read))];
}

/** Scopes the agent may use to act: its authority. Needs a connection and an explicit write grant. */
export function authorityScopes(repos: Repositories): string[] {
  return [...new Set(repos.config.integrations().filter(hasWriteAuthority).flatMap((i) => i.scopes.write))];
}

/** Every scope policy may treat as granted. */
export function grantedScopes(repos: Repositories): string[] {
  return [...new Set([...contextScopes(repos), ...authorityScopes(repos)])];
}

/** Read scopes that let the agent see each evidence source. Payment Integrity's own records are always visible. */
const SOURCE_SCOPES: Record<string, string[] | undefined> = {
  razorpay: ["payment_status", "order_status"],
  "razorpay:webhook": ["webhook_deliveries"],
  merchant: ["learning_access_status", "order_status", "inventory_status"],
  platform_monitoring: ["deploy_events", "service_error_logs"],
};

/**
 * Filters evidence to sources the agent may currently read. Used for every
 * investigator and Ask RAY input, so both see exactly the same context.
 */
export function permittedEvidence<T extends { source: string; type: string }>(repos: Repositories, items: readonly T[]): T[] {
  const readable = new Set(contextScopes(repos));
  return items.filter((item) => {
    const key = item.source === "razorpay" && item.type.startsWith("webhook.") ? "razorpay:webhook" : item.source;
    const scopes = SOURCE_SCOPES[key];
    return scopes === undefined || scopes.some((s) => readable.has(s));
  });
}
