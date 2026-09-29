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
