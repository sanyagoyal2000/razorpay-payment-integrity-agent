import { NextResponse } from "next/server";
import { isLiveAgentConfigured } from "@/server/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the live agent can be used. The browser checks this once before calling any task. */
export function GET() {
  return NextResponse.json({ live: isLiveAgentConfigured() });
}
