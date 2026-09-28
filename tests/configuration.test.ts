import { describe, expect, it } from "vitest";
import { ACTORS } from "@/domain/types";
import { approveAndStart, advanceExecution } from "@/services/execution";
import {
  ConfigurationError,
  contractLogic,
  contractToForm,
  EMPTY_CONTRACT_FORM,
  saveContract,
  saveGlobalControls,
  setActionMode,
  setAutomationPaused,
  setContractStatus,
  setIntegrationConnected,
  validateContract,
} from "@/services/configuration";
import { evaluateCase } from "@/services/policy/currentState";
import { actionPolicyRows, contractRows, integrationHealth, integrationRows, permissionModel } from "@/services/views/configuration";
import { NOW, setup } from "./helpers";

describe("Automations", () => {
  it("changes a mode only when a person asks, and audits it", () => {
    const env = setup();
    setActionMode(env.repos, "retry_provisioning", "automatic_below_threshold", ACTORS.operator, NOW);
    expect(env.repos.config.actionModes().retry_provisioning).toBe("automatic_below_threshold");
    expect(env.repos.audit.list().at(-1)).toMatchObject({ action: "Changed action policy", result: "Retry provisioning: Suggest only → Automatic below value and confidence thresholds" });
    expect(evaluateCase(env.repos, env.safeCases[0]!, env.safeCases[0]!.recommendation!, NOW).result).toBe("allowed");
  });

  it("validates global controls and records what changed", () => {
    const env = setup();
    const current = env.repos.config.globalControls();
    expect(() => saveGlobalControls(env.repos, { ...current, minimumConfidence: 0.2 }, ACTORS.operator, NOW)).toThrow(ConfigurationError);
    saveGlobalControls(env.repos, { ...current, maxAutomaticValue: 3000 }, ACTORS.operator, NOW);
    expect(env.repos.audit.list().at(-1)!.result).toBe("Maximum automatic value ₹3,000");
    expect(evaluateCase(env.repos, env.safeCases.find((c) => c.amountAtRisk === 4999)!, env.safeCases.find((c) => c.amountAtRisk === 4999)!.recommendation!, NOW).approvalScope).toBe("individual");
  });

  it("kill switch stops queued executions at their re-check but keeps them visible, and keeps monitoring", () => {
    const env = setup();
    const execution = approveAndStart(env, { caseId: env.safeCases[0]!.id, action: "retry_provisioning", actor: ACTORS.operator, approvalSource: "merchant" });
    setAutomationPaused(env.repos, true, ACTORS.operator, NOW);
    expect(env.repos.audit.list().at(-1)!.result).toMatch(/1 queued actions stay visible/);
    const stopped = advanceExecution(env, execution.id);
    expect(stopped.status).toBe("stopped");
    expect(env.repos.executions.get(execution.id)).toBeDefined();
    expect(actionPolicyRows(env.repos).length).toBe(7);
    setAutomationPaused(env.repos, false, ACTORS.operator, NOW);
    expect(env.repos.config.globalControls().automationPaused).toBe(false);
  });
});

describe("Outcome Contracts", () => {
  it("lists contracts with completion rate and open cases from data", () => {
    const env = setup();
    const rows = contractRows(env.repos, NOW);
    const course = rows.find((r) => r.id === "ctr_course_purchase")!;
    expect(course.openCases).toBe(44);
    expect(course.completionRate).toBeGreaterThan(0.99);
    expect(course.completionRate).toBeLessThan(1);
    expect(rows.map((r) => r.status)).toEqual(["active", "active", "active", "paused", "draft"]);
  });

  it("validates fields, global limits, overlaps and inventory rules", () => {
    const env = setup();
    const errors = validateContract(env.repos, { ...EMPTY_CONTRACT_FORM, status: "active", maxAutomaticValue: 90_000, productScope: ["prd_sql_analysis"], expectedOutcome: "booking_confirmed" });
    expect(Object.keys(errors).sort()).toEqual(["customerNotificationTemplate", "maxAutomaticValue", "name", "paymentType", "productScope", "requiresInventoryCheck", "verificationMethod"].sort());
  });

  it("creates, edits, pauses and resumes contracts with audit events", () => {
    const env = setup();
    const created = saveContract(
      env.repos,
      {
        ...EMPTY_CONTRACT_FORM,
        name: "Teams upgrade",
        paymentType: "Team plan upgrades",
        productScope: ["prd_teams_upgrade"],
        expectedOutcome: "plan_upgraded",
        fulfilmentService: "billing-service",
        verificationMethod: "plan_upgraded event matched on merchant_order_id",
        customerNotificationTemplate: "Your upgrade for {product} is being completed.",
        status: "draft",
      },
      ACTORS.operator,
      NOW,
    );
    expect(created.id).toBe("ctr_teams_upgrade");
    saveContract(env.repos, { ...contractToForm(created), deadlineSeconds: 600 }, ACTORS.operator, NOW, created.id);
    expect(env.repos.audit.list().at(-1)!.result).toBe("Teams upgrade: changed deadlineSeconds");
    setContractStatus(env.repos, "ctr_wallet_credit", "active", ACTORS.operator, NOW);
    setContractStatus(env.repos, "ctr_wallet_credit", "paused", ACTORS.operator, NOW);
    expect(env.repos.audit.list().slice(-2).map((e) => e.action)).toEqual(["Resumed contract", "Paused contract"]);
  });

  it("previews the resulting logic in plain language", () => {
    const env = setup();
    const lines = contractLogic(contractToForm(env.repos.config.contract("ctr_event_booking")!), (id) => env.repos.payments.product(id)?.name ?? id, 5000);
    expect(lines[0]).toBe("When a payment for System Design Live Workshop, Bengaluru is captured, expect booking_confirmed from enrolment-service, matched on merchant_order_id, within 5 min.");
    expect(lines).toContain("Never fulfil if the purchased inventory changed after payment.");
  });
});

describe("Integrations", () => {
  it("shows scopes, actions and health from data", () => {
    const env = setup();
    const rows = integrationRows(env.repos, NOW);
    expect(rows.find((r) => r.id === "learnloop_enrolment")!.actionsAllowed).toEqual(["Retry provisioning"]);
    expect(rows.find((r) => r.id === "razorpay_payments")!.errorSummary).toMatch(/% errors/);
    expect(rows.every((r) => r.lastSuccessfulEventAt === undefined || r.lastSuccessfulEventAt <= NOW)).toBe(true);
    const health = integrationHealth(env.repos, NOW);
    expect(health.webhookSuccess.value).toBeGreaterThan(0.99);
    expect(health.schemaErrors.value).toBe(1);
    expect(permissionModel(env.repos)).toMatchObject({ write: ["capture_payment", "replay_webhook", "grant_course_access", "send_customer_message", "create_incident", "post_message"] });
  });

  it("revoking an integration makes its actions impossible until reconnected", () => {
    const env = setup();
    const c = env.safeCases[0]!;
    setIntegrationConnected(env.repos, "learnloop_enrolment", false, ACTORS.operator, NOW);
    expect(evaluateCase(env.repos, c, c.recommendation!, NOW).result).toBe("blocked");
    expect(permissionModel(env.repos).notGranted).toContain("grant_course_access");
    expect(actionPolicyRows(env.repos).find((r) => r.action === "retry_provisioning")!.permissionMissing).toBe("grant_course_access");
    setIntegrationConnected(env.repos, "learnloop_enrolment", true, ACTORS.operator, NOW);
    expect(evaluateCase(env.repos, c, c.recommendation!, NOW).result).toBe("requires_approval");
    expect(env.repos.audit.list().slice(-2).map((e) => e.action)).toEqual(["Revoked integration", "Reconnected integration"]);
  });
});
