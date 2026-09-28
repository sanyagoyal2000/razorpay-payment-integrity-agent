import "server-only";
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod/v4";

/**
 * Runs one structured-output request through the local `claude` CLI (Claude
 * Code), signed in with the user's Claude account, so no API key is needed.
 * The CLI runs headless with no tools, no MCP servers and no saved session,
 * from a temporary directory so no project instructions are loaded.
 */

const CLI_TIMEOUT_MS = 180_000;

export class CliUnavailableError extends Error {}
export class CliOutputError extends Error {}

export function cliPath(): string {
  return process.env["CLAUDE_CLI_PATH"] || "claude";
}

/** True when the configured CLI binary can be found and executed. */
export function isCliAvailable(): boolean {
  const bin = cliPath();
  const candidates = bin.includes(path.sep) ? [bin] : (process.env["PATH"] ?? "").split(path.delimiter).map((dir) => path.join(dir, bin));
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

/** JSON Schema for the CLI's structured output; constraints it cannot enforce are checked by Zod afterwards. */
export function toCliJsonSchema(schema: z.ZodType): unknown {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key)).map(([key, inner]) => [key, strip(inner)]));
    }
    return value;
  };
  return strip(z.toJSONSchema(schema, { target: "draft-7" }));
}

type CliResult = { is_error?: boolean; subtype?: string; structured_output?: unknown; result?: string };

export async function cliStructuredCall<Schema extends z.ZodType>(options: {
  schema: Schema;
  system: string;
  prompt: string;
  model: string;
}): Promise<z.infer<Schema>> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(toCliJsonSchema(options.schema)),
    "--system-prompt",
    options.system,
    "--model",
    options.model,
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    let child;
    try {
      child = spawn(cliPath(), args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"], env: process.env });
    } catch (error) {
      reject(new CliUnavailableError(error instanceof Error ? error.message : "Claude CLI could not start"));
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new CliUnavailableError("Claude CLI timed out"));
    }, CLI_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new CliUnavailableError(`Claude CLI could not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || out.trim().startsWith("{")) resolve(out);
      else reject(new CliUnavailableError(`Claude CLI exited with code ${code}: ${err.trim().slice(0, 200)}`));
    });
    child.stdin.end(options.prompt);
  });

  let parsed: CliResult;
  try {
    parsed = JSON.parse(stdout) as CliResult;
  } catch {
    throw new CliOutputError("Claude CLI returned output that is not JSON");
  }
  if (parsed.is_error) throw new CliUnavailableError(`Claude CLI reported an error (${parsed.subtype ?? "unknown"})`);
  const candidate = parsed.structured_output ?? safeJson(parsed.result);
  const validated = options.schema.safeParse(candidate);
  if (!validated.success) throw new CliOutputError("Claude CLI output did not match the schema");
  return validated.data as z.infer<Schema>;
}

function safeJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
