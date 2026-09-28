import { formatIstDateTime } from "@/domain/time";
import type { Repositories } from "@/repositories";
import { isDataFresh } from "@/services/policy/currentState";

export type StatusNotice = {
  id: "stale" | "outcome_verification" | "investigation" | "policy_service" | "automation_paused";
  severity: "negative" | "notice" | "information";
  title: string;
  description: string;
};

/**
 * Degraded-dependency states that change what the product can do. Wording
 * follows the specification exactly where it gives one.
 */
export function systemStatus(repos: Repositories, asOf: string): StatusNotice[] {
  const flags = repos.config.flags();
  const notices: StatusNotice[] = [];
  if (!isDataFresh(repos, asOf)) {
    notices.push({
      id: "stale",
      severity: "notice",
      title: "Data is out of date",
      description: `Last successful update ${formatIstDateTime(repos.config.lastSyncedAt())}. Actions that change payments or outcomes are paused until the data is refreshed.`,
    });
  }
  const enrolment = repos.config.integration("learnloop_enrolment");
  if (!flags.outcomeVerificationAvailable || enrolment?.status !== "connected") {
    notices.push({
      id: "outcome_verification",
      severity: "notice",
      title: "Outcome verification unavailable",
      description: "Merchant outcome verification is temporarily unavailable. No recovery actions will be executed until the connection is restored.",
    });
  }
  if (!flags.policyServiceAvailable) {
    notices.push({
      id: "policy_service",
      severity: "negative",
      title: "Policy service unavailable",
      description: "Every execution is blocked until the policy service recovers. Monitoring continues.",
    });
  }
  if (!flags.investigationAvailable) {
    notices.push({
      id: "investigation",
      severity: "information",
      title: "Automated investigation unavailable",
      description: "Automated investigation unavailable. Deterministic detection remains active. New findings default to: Escalate for review.",
    });
  }
  if (repos.config.globalControls().automationPaused) {
    notices.push({
      id: "automation_paused",
      severity: "notice",
      title: "All automated actions are paused",
      description: "No action will execute until automation is resumed on the Automations page. Monitoring and investigation continue.",
    });
  }
  return notices;
}

/** Policy checks that fail for every case at once because of a system condition, not the case itself. */
export const SYSTEMIC_CHECKS = new Set(["data_fresh", "kill_switch", "outcome_verification_available", "policy_service_available"]);

/** Why nothing can be executed right now, if a system condition blocks all actions. */
export function systemicBlocker(repos: Repositories, asOf: string): string | undefined {
  const notices = systemStatus(repos, asOf).map((n) => n.id);
  if (notices.includes("policy_service")) return "None until the policy service recovers";
  if (notices.includes("stale")) return "None until the data is refreshed";
  if (notices.includes("outcome_verification")) return "None until outcome verification is restored";
  if (notices.includes("automation_paused")) return "None while automated actions are paused";
  return undefined;
}
