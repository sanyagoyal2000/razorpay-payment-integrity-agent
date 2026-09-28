import { NextResponse } from "next/server";
import { AGENT_TASKS, type AgentTask } from "@/services/agent/contracts";
import { AgentOutputError, AgentUnavailableError, isLiveAgentConfigured } from "@/server/claude";
import { AGENT_TASK_HANDLERS } from "@/server/agentTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs one agent task against Claude. Returns 503 when no credentials are
 * configured, so the browser falls back to the deterministic adapter.
 */
export async function POST(request: Request, { params }: { params: { task: string } }) {
  const task = params.task as AgentTask;
  if (!AGENT_TASKS.includes(task)) return NextResponse.json({ error: "unknown_task" }, { status: 404 });
  if (!isLiveAgentConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const handler = AGENT_TASK_HANDLERS[task];
  const body: unknown = await request.json().catch(() => null);
  const parsed = handler.input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  try {
    const output = await handler.run(parsed.data as never);
    return NextResponse.json({ output });
  } catch (error) {
    if (error instanceof AgentUnavailableError) return NextResponse.json({ error: "unavailable", detail: error.message }, { status: 502 });
    if (error instanceof AgentOutputError) return NextResponse.json({ error: "invalid_output", detail: error.message }, { status: 422 });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
