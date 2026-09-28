/**
 * Captures investigator outputs for the offline validation benchmark.
 *
 * Sends each scenario's input to a running app's /api/agent/investigate-case,
 * which uses the production prompt, model and output schema. Nothing is
 * executed: the endpoint only returns an investigation. Results are committed
 * so the benchmark page is reproducible without model calls.
 *
 *   yarn start -p 3000            # in another shell, with the agent live
 *   yarn evaluation:capture       # BASE_URL=http://localhost:3000 by default
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EVALUATION_SCENARIOS } from "../src/fixtures/evaluation/scenarios";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const root = path.resolve(__dirname, "..");

type Captured = { status: "output"; raw: unknown; durationMs: number } | { status: "unavailable"; reason: string; durationMs: number };

async function capture(input: unknown): Promise<Captured> {
  const started = Date.now();
  const response = await fetch(`${BASE_URL}/api/agent/investigate-case`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).catch(
    (error: unknown) => ({ ok: false, status: 0, json: async () => ({ error: String(error) }) }) as const,
  );
  const durationMs = Date.now() - started;
  const body = (await response.json().catch(() => ({}))) as { output?: unknown; error?: string; detail?: string };
  // 422: the model answered but the output failed the schema. It is kept as output that
  // cannot be parsed, so the benchmark scores it through the same validation boundary.
  if (response.status === 422) return { status: "output", raw: null, durationMs };
  if (!response.ok) return { status: "unavailable", reason: body.error ?? `HTTP ${response.status}`, durationMs };
  return { status: "output", raw: body.output, durationMs };
}

async function main() {
  const status = (await (await fetch(`${BASE_URL}/api/agent/status`)).json()) as { live: boolean };
  if (!status.live) throw new Error(`The agent at ${BASE_URL} is not live; start the app with the Claude CLI or an API key.`);
  const agentSource = readFileSync(path.join(root, "src/server/agentTasks.ts"), "utf8");
  const model = /AGENT_MODEL = "([^"]+)"/.exec(readFileSync(path.join(root, "src/server/claude.ts"), "utf8"))?.[1] ?? "unknown";
  const provider = process.env.AGENT_PROVIDER === "api" ? "Anthropic API" : "Claude CLI";

  const outputs: Record<string, Captured> = {};
  const queue = [...EVALUATION_SCENARIOS];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      outputs[s.id] = await capture(s.input);
      console.log(`${s.id}: ${outputs[s.id]!.status} (${Math.round(outputs[s.id]!.durationMs / 1000)} s)`);
    }
  });
  await Promise.all(workers);

  const capturedAt = new Date().toISOString();
  const file = {
    version: `captured-${capturedAt.slice(0, 10)}`,
    capturedAt,
    provider,
    model,
    /** Hash of the task definitions (prompts and schemas) the outputs were produced with. */
    promptVersion: createHash("sha256").update(agentSource).digest("hex").slice(0, 12),
    scenarioCount: EVALUATION_SCENARIOS.length,
    outputs: Object.fromEntries(EVALUATION_SCENARIOS.map((s) => [s.id, outputs[s.id]])),
  };
  const target = path.join(root, "src/fixtures/evaluation/captured-outputs.json");
  writeFileSync(target, `${JSON.stringify(file, null, 1)}\n`);
  console.log(`Wrote ${target}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
