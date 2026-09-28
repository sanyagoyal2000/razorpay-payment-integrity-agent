/**
 * Versions recorded with audit events. Bump when agent task definitions or
 * policy rules change, so an audit entry can be traced to the logic that
 * produced it.
 */
export const AGENT_VERSION = "payment-integrity-agent 2026.09.28";
export const POLICY_VERSION = "policy-engine 2026.09.28";

/** 32-bit FNV-1a of a value's JSON, as 8 hex characters. Identifies content without storing it. */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
