import { NextResponse } from "next/server";
import { AGENT_MODEL, agentProvider, isLiveAgentConfigured } from "@/server/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the live agent can be used. The browser checks this once before calling any task. */
export function GET() {
  const live = isLiveAgentConfigured();
  return NextResponse.json(live ? { live, model: AGENT_MODEL, provider: agentProvider() === "api" ? "Anthropic API" : "Claude CLI" } : { live });
}
