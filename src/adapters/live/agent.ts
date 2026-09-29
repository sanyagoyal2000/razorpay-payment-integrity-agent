import type { AgentGateway, AgentTask } from "@/services/agent/contracts";

/**
 * Browser-side gateway to the live agent (/api/agent/*). It asks the server
 * once whether model credentials are configured; if not, every call is served
 * by `fallback`, so the product works offline. Failures of a configured agent
 * surface to the caller, which treats the agent as unavailable. Output that
 * failed validation on the server (HTTP 422) is returned as null and fails
 * validation here too.
 */
export function createLiveAgentGateway(fallback: AgentGateway, fetchImpl: typeof fetch = (...args) => fetch(...args)): AgentGateway {
  type Status = { live?: boolean; model?: string; provider?: string };
  let status: Promise<Status> | undefined;
  const getStatus = () => {
    status ??= fetchImpl("/api/agent/status")
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : { live: false }))
      .catch(() => ({ live: false }));
    return status;
  };
  const isLive = async () => (await getStatus()).live === true;
  const call = async <I>(task: AgentTask, input: I, fallbackCall: (input: I) => Promise<unknown>): Promise<unknown> => {
    if (!(await isLive())) return fallbackCall(input);
    const response = await fetchImpl(`/api/agent/${task}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (response.status === 422) return null;
    if (!response.ok) throw new Error(`Agent request failed (${response.status})`);
    const body = (await response.json()) as { output?: unknown };
    return body.output;
  };
  return {
    investigateCase: (input) => call("investigate-case", input, fallback.investigateCase),
    investigateIncident: (input) => call("investigate-incident", input, fallback.investigateIncident),
    draftMessage: (input) => call("draft-message", input, fallback.draftMessage),
    draftContract: (input) => call("draft-contract", input, fallback.draftContract),
    explainAutonomy: (input) => call("explain-autonomy", input, fallback.explainAutonomy),
    askIncident: (input) => call("ask-incident", input, fallback.askIncident),
    describe: async () => {
      const s = await getStatus();
      if (s.live === true) return `${s.model ?? "Claude"} via ${s.provider ?? "live agent"}`;
      return (await fallback.describe?.()) ?? "Deterministic fallback";
    },
  };
}
