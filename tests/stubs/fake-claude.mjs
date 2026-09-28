#!/usr/bin/env node
// Test double for the Claude CLI: records its arguments and prompt, then
// prints the result JSON given in FAKE_CLAUDE_RESULT.
import { writeFileSync } from "node:fs";
let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
  if (process.env.FAKE_CLAUDE_LOG) writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), prompt, cwd: process.cwd() }));
  process.stdout.write(process.env.FAKE_CLAUDE_RESULT ?? "{}");
  process.exit(Number(process.env.FAKE_CLAUDE_EXIT ?? 0));
});
