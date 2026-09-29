import type { ActionMode, ActionType, OutcomeContract } from "@/domain/types";
import { formatINR } from "@/domain/money";
import type { Repositories } from "@/repositories";
import { agentLifecycle, type Lifecycle } from "@/services/lifecycle";
import { dailyPerformance, valueDelivered } from "@/services/metrics/overview";
import { authorityScopes, contextScopes, hasWriteAuthority } from "@/services/permissions";
import { ACTIONS, actionLabel, POLICY_ACTION_LABELS, requiredScope, serviceLabel, theService } from "@/services/policy/actions";

export const AGENT_NAME = "Payment Integrity Agent";
export const AGENT_PURPOSE =
  "A specialist Agent Studio worker that continuously protects the gap between a successful payment and the merchant's intended customer outcome.";
export const DISCOVERY_VS_EXECUTION =
  "Reads broadly within connected context; acts narrowly. Every action is checked by deterministic policy, limited by your settings, audited, and verified with an Outcome Receipt.";

// ---------------------------------------------------------------------------
// Context & authority
// ---------------------------------------------------------------------------

export type ContextItem = { id: string; label: string; source: string; available: boolean; detail: string };

export type Authority = "suggest_only" | "approval_required" | "automatic" | "not_permitted";

export const AUTHORITY_LABELS: Record<Authority, string> = {
  suggest_only: "Suggest only",
  approval_required: "Approval required",
  automatic: "Automatic within limits",
  not_permitted: "Not permitted",
};

export type ActionAuthority = { action: ActionType; label: string; authority: Authority; authorityLabel: string; detail: string };

const FULFILMENT_STATUS_SCOPES: Record<string, { scope: string; label: string } | undefined> = {
  "learning-access-service": { scope: "learning_access_status", label: "Learning access status" },
};

function integrationFor(repos: Repositories, scope: string): string {
  return repos.config.integrations().find((i) => i.scopes.read.includes(scope) || i.scopes.write.includes(scope))?.name ?? "No integration";
}

/**
 * What the agent can read for a contract (from connected integrations' read
 * scopes) and what it may do (from write authority plus Automations modes).
 * The two come from separate permission records: connecting a source grants
 * context, never authority.
 */
export function contextAndAuthority(repos: Repositories, contract: OutcomeContract) {
  const readable = new Set(contextScopes(repos));
  const item = (id: string, label: string, scopes: string[], detail: string): ContextItem => {
    const available = scopes.every((s) => readable.has(s));
    return { id, label, source: integrationFor(repos, scopes[0]!), available, detail: available ? detail : "Not available: the source is not connected." };
  };
  const fulfilment = FULFILMENT_STATUS_SCOPES[contract.fulfilmentService];
  const context: ContextItem[] = [
    item("payments", "Razorpay payment and order events", ["payment_status", "order_status"], "Orders, authorisations, captures and refunds."),
    item("webhooks", "Webhook delivery attempts", ["webhook_deliveries"], "Every order.paid attempt and its response code."),
    item("deployments", "Merchant deployment events", ["deploy_events"], "Deploys and service error logs from Platform Monitoring."),
    fulfilment
      ? item("fulfilment", fulfilment.label, [fulfilment.scope], `Whether ${contract.expectedOutcome} has happened.`)
      : {
          id: "fulfilment",
          label: `${serviceLabel(contract.fulfilmentService)} status`,
          source: "No integration",
          available: false,
          detail: `No connected source reports ${theService(contract.fulfilmentService)} status directly; only its outcome events are visible.`,
        },
    ...(contract.requiresInventoryCheck ? [item("inventory", "Inventory or capacity status", ["inventory_status"], "Seat inventory and capacity changes.")] : []),
    { id: "receipts", label: "Outcome Receipts", source: "Payment Integrity", available: true, detail: "Proof, per payment, that the intended outcome happened." },
  ];

  const writable = new Set(authorityScopes(repos));
  const modes = repos.config.actionModes();
  const controls = repos.config.globalControls();
  const recovery: ActionType[] = contract.safeRecoveryAction === "escalate" ? [] : [contract.safeRecoveryAction];
  const compatible: ActionType[] = [...new Set<ActionType>([...recovery, "replay_webhook", "capture", "prepare_refund", "refund_duplicate", "notify_customer", "escalate"])];
  const actions = compatible.map((action): ActionAuthority => {
    const definition = ACTIONS[action];
    const scope = requiredScope(action, contract);
    const mode: ActionMode | undefined = definition.policyAction ? modes[definition.policyAction] : undefined;
    const label = actionLabel(action, contract);
    const result = (authority: Authority, detail: string): ActionAuthority => ({ action, label, authority, authorityLabel: AUTHORITY_LABELS[authority], detail });
    if (scope && !writable.has(scope)) {
      const integration = repos.config.integrations().find((i) => i.scopes.write.includes(scope));
      return result(
        "not_permitted",
        integration && integration.status === "connected" && !hasWriteAuthority(integration)
          ? `Write access to ${integration.name} has not been granted.`
          : `Scope ${scope} is not granted to Payment Integrity.`,
      );
    }
    if (mode === "disabled") return result("not_permitted", "Disabled in Automations.");
    if (mode === "always_require_approval") return result("approval_required", "Every run needs your individual approval.");
    if (mode === "automatic_below_threshold") {
      const limit = Math.min(contract.maxAutomaticValue, controls.maxAutomaticValue);
      const confidence = Math.max(contract.minimumConfidence, controls.minimumConfidence);
      return result(
        "automatic",
        controls.automationPaused
          ? "Paused by the kill switch; nothing runs automatically."
          : definition.kind === "escalation"
            ? "Posts to your incident channel without approval; it changes no payment."
            : `Up to ${formatINR(limit)} at ${Math.round(confidence * 100)}% confidence or higher; anything else needs approval.`,
      );
    }
    return result("suggest_only", definition.kind === "refund_draft" ? "Drafts for your finance team; nothing is refunded." : "Proposed for your approval, individually or in a safe bulk group.");
  });
  return {
    contract: { id: contract.id, name: contract.name },
    context,
    actions,
    alwaysReview: contract.alwaysReviewCaseTypes,
    principle: DISCOVERY_VS_EXECUTION,
  };
}

export type ContextAndAuthority = ReturnType<typeof contextAndAuthority>;

// ---------------------------------------------------------------------------
// Agent details
// ---------------------------------------------------------------------------

export type AgentProfile = {
  name: string;
  purpose: string;
  lifecycle: Lifecycle;
  connected: Array<{ name: string; access: string }>;
  permissionMode: { label: string; detail: string };
  outcomeMetric: { label: string; value: string; detail: string };
  verifiedOutcomes: { label: string; value: string; detail: string; caseIds: string[] };
  contracts: Array<{ id: string; name: string }>;
};

/** The agent-details surface: what job the agent does and under what authority. */
export function agentProfile(repos: Repositories, asOf: string): AgentProfile {
  const connected = repos.config
    .integrations()
    .filter((i) => i.status === "connected")
    .map((i) => ({
      name: i.name,
      access: i.scopes.write.length === 0 ? "Read only" : hasWriteAuthority(i) ? "Read and scoped write" : "Read only; write access not granted",
    }));
  const policies = repos.config.actionPolicies();
  const automatic = policies.filter((p) => p.mode === "automatic_below_threshold");
  const reviewFirst = policies.filter((p) => p.mode === "suggest_only" || p.mode === "always_require_approval");
  const paused = repos.config.globalControls().automationPaused;
  const latest = dailyPerformance(repos, asOf).at(-1);
  const value = valueDelivered(repos, asOf);
  return {
    name: AGENT_NAME,
    purpose: AGENT_PURPOSE,
    lifecycle: agentLifecycle(repos, asOf),
    connected,
    permissionMode: {
      label: paused ? "Paused: nothing runs automatically" : automatic.length === 0 ? "Review-first" : `Review-first; ${automatic.length} automatic within limits`,
      detail: `${reviewFirst.length} actions wait for your approval or run only as suggestions${automatic.length > 0 ? `; automatic within limits: ${automatic.map((p) => POLICY_ACTION_LABELS[p.action]).join(", ")}` : ""}.`,
    },
    outcomeMetric: {
      label: "Payments reaching their promised outcome",
      value: latest === undefined ? "No data" : `${(latest.completionRate * 100).toFixed(1)}%`,
      detail: "Learning package purchases, today, including recovered cases.",
    },
    verifiedOutcomes: {
      label: "GMV resolved before refund or dispute (30 days)",
      value: `${value.gmvResolvedBeforeRefundOrDispute.caseIds.length} cases · ${formatINR(value.gmvResolvedBeforeRefundOrDispute.value)}`,
      detail: "Resolved with a confirmed Outcome Receipt before a refund or customer contact.",
      caseIds: value.gmvResolvedBeforeRefundOrDispute.caseIds,
    },
    contracts: repos.config.contracts().filter((c) => c.status === "active").map((c) => ({ id: c.id, name: c.name })),
  };
}
