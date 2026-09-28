import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod/v4";
import { CliOutputError, CliUnavailableError, cliStructuredCall, isCliAvailable } from "./claudeCli";

/** Model used for every agent task. */
export const AGENT_MODEL = "claude-opus-5";

/**
 * Where agent requests go:
 * - "claude-cli" (default): the local Claude CLI, signed in with the user's Claude account; no API key needed.
 * - "api": the Anthropic API with ANTHROPIC_API_KEY.
 */
export type AgentProvider = "claude-cli" | "api";

export function agentProvider(): AgentProvider {
  return process.env["AGENT_PROVIDER"] === "api" ? "api" : "claude-cli";
}

/** Wall-clock limit for one agent call, so the UI can fall back promptly. */
const REQUEST_TIMEOUT_MS = 60_000;

export class AgentUnavailableError extends Error {}
export class AgentOutputError extends Error {}

/** True when the selected provider can serve live agent requests. */
export function isLiveAgentConfigured(): boolean {
  if (agentProvider() === "claude-cli") return isCliAvailable();
  return Boolean(process.env["ANTHROPIC_API_KEY"] || process.env["ANTHROPIC_AUTH_TOKEN"]);
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  return client;
}

/**
 * One structured-output call through the selected provider. Output is parsed
 * against `schema`; refusals, truncation and unparseable output raise
 * AgentOutputError. On the API path, server-side refusal fallback is enabled
 * so a declined request is retried on the fallback model inside the same call.
 */
export async function structuredCall<Schema extends z.ZodType>(options: {
  schema: Schema;
  system: string;
  prompt: string;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<Schema>> {
  if (!isLiveAgentConfigured()) throw new AgentUnavailableError("No live agent configured");
  if (agentProvider() === "claude-cli") {
    try {
      return await cliStructuredCall({ schema: options.schema, system: options.system, prompt: options.prompt, model: AGENT_MODEL });
    } catch (error) {
      if (error instanceof CliOutputError) throw new AgentOutputError(error.message);
      if (error instanceof CliUnavailableError) throw new AgentUnavailableError(error.message);
      throw error;
    }
  }
  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: AGENT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: options.system,
      messages: [{ role: "user", content: options.prompt }],
      output_config: { format: betaZodOutputFormat(options.schema), effort: options.effort ?? "medium" },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new AgentUnavailableError("Anthropic credentials were rejected");
    }
    if (error instanceof Anthropic.RateLimitError) throw new AgentUnavailableError("Rate limited");
    if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionError) {
      throw new AgentUnavailableError("Anthropic API not reachable");
    }
    if (error instanceof Anthropic.APIError) throw new AgentUnavailableError(`Anthropic API error ${error.status ?? ""}`.trim());
    throw error;
  }
  if (response.stop_reason === "refusal") throw new AgentOutputError("The model declined the request");
  if (response.stop_reason === "max_tokens") throw new AgentOutputError("Output was truncated");
  if (response.parsed_output === null || response.parsed_output === undefined) throw new AgentOutputError("Output did not match the schema");
  return response.parsed_output as z.infer<Schema>;
}
