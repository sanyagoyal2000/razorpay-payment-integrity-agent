/**
 * Deterministic fixture builder. Run through `npm run fixtures`, which writes
 * src/fixtures/dataset.json. The app only ever reads that JSON file; nothing
 * here runs in the browser.
 */
import type {
  ActionType,
  AuditEvent,
  CaseDecision,
  CaseStatus,
  CaseType,
  ConnectorLog,
  Customer,
  CustomerContactState,
  DailyOutcomeStat,
  DefaultOutcome,
  Execution,
  ExecutionStep,
  IncidentRecord,
  IncidentUpdate,
  IntegrityCase,
  IntegrityEvent,
  Hypothesis,
  Investigation,
  MerchantOrder,
  MerchantOutcomeEvent,
  ObservabilityEvent,
  OutcomeContract,
  OutcomeReceipt,
  Payment,
  PaymentEvent,
  PaymentMethod,
  PolicyVerdict,
  Product,
  WebhookDelivery,
} from "@/domain/types";
import { fulfilmentVocabulary } from "@/domain/fulfilment";
import { ACTORS } from "@/domain/types";
import { formatINR } from "@/domain/money";
import { addDaysToDate, addSeconds, istDate, istTime, istToIso } from "@/domain/time";
import { toRecommendation } from "@/services/investigation/recommendation";
import { actionLabel } from "@/services/policy/actions";
import {
  buildActionPolicies,
  buildContracts,
  buildGlobalControls,
  buildIntegrations,
  CONTRACT_IDS,
  MERCHANT,
  OPERATOR,
  PRODUCTS,
  productById,
  WEBHOOK_ENDPOINT,
} from "./catalogue";
import type { Dataset } from "./dataset-types";
import { createRandom } from "./random";

export const FIXTURE_SEED = 20260615;
export const FIXTURE_ANCHOR_DATE = "2026-06-15";

const FIRST_NAMES = [
  "Aarav", "Ananya", "Vihaan", "Diya", "Arjun", "Ishita", "Kabir", "Meera", "Rohan", "Sneha",
  "Aditya", "Kavya", "Siddharth", "Pooja", "Nikhil", "Riya", "Karthik", "Nandini", "Varun", "Tanvi",
  "Rahul", "Aishwarya", "Harsh", "Shreya", "Manish", "Divya", "Pranav", "Lakshmi", "Yash", "Neha",
  "Abhishek", "Swati", "Gaurav", "Priyanka", "Akash", "Deepika", "Suresh", "Anjali", "Vikram", "Bhavna",
  "Farhan", "Zoya", "Imran", "Sana", "Joseph", "Maria", "Gurpreet", "Harleen", "Tenzin", "Arpita",
];
const LAST_NAMES = [
  "Iyer", "Reddy", "Nair", "Menon", "Kulkarni", "Deshpande", "Joshi", "Patel", "Shah", "Mehta",
  "Gupta", "Agarwal", "Singh", "Chauhan", "Verma", "Mishra", "Pandey", "Banerjee", "Chatterjee", "Das",
  "Bose", "Sen", "Rao", "Naidu", "Pillai", "Krishnan", "Subramanian", "Hegde", "Shetty", "Kamath",
  "Khan", "Qureshi", "Fernandes", "D'Souza", "Gill", "Sandhu", "Bhatia", "Malhotra", "Kapoor", "Saxena",
];
const EMAIL_DOMAINS = ["gmail.com", "outlook.com", "yahoo.co.in", "rediffmail.com"];

type Chain = {
  order: MerchantOrder;
  payment: Payment;
  orderCreated: PaymentEvent;
  authorized?: PaymentEvent;
  captured?: PaymentEvent;
  orderPaid?: PaymentEvent;
  deliveries: WebhookDelivery[];
  outcomeEvents: MerchantOutcomeEvent[];
  receipt?: OutcomeReceipt;
};

type OutcomePlan =
  | { kind: "confirmed"; afterSeconds: number }
  | { kind: "failed"; afterSeconds: number; responseCode: number }
  | { kind: "pending" }
  | { kind: "none" };

type ChainInput = {
  customer: Customer;
  product: Product;
  orderCreatedAt: string;
  method?: PaymentMethod;
  /** Seconds from order creation to authorisation. Default 6. */
  authorizeAfter?: number;
  capture?: boolean;
  /** Failed delivery attempts before the successful one: [responseCode, secondsAfterPrevious]. */
  webhookFailures?: Array<{ responseCode: number; afterSeconds: number }>;
  /** When true, all attempts fail and no successful delivery is recorded. */
  webhookNeverDelivered?: boolean;
  outcome: OutcomePlan;
  orderStatus?: MerchantOrder["status"];
};

export function buildDataset(): Dataset {
  const rng = createRandom(FIXTURE_SEED);
  const at = (daysBefore: number, time: string): string =>
    istToIso(addDaysToDate(FIXTURE_ANCHOR_DATE, -daysBefore), time);
  const usedIds = new Set<string>();
  const uid = (prefix: string, length = 14): string => {
    let id: string;
    do id = `${prefix}_${rng.token(length)}`;
    while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };

  const contracts = buildContracts(at);
  const contractById = (id: string): OutcomeContract => {
    const contract = contracts.find((c) => c.id === id);
    if (!contract) throw new Error(`Unknown contract ${id}`);
    return contract;
  };

  const customers: Customer[] = [];
  const orders: MerchantOrder[] = [];
  const payments: Payment[] = [];
  const paymentEvents: PaymentEvent[] = [];
  const webhookDeliveries: WebhookDelivery[] = [];
  const outcomeEvents: MerchantOutcomeEvent[] = [];
  const observabilityEvents: ObservabilityEvent[] = [];
  const integrityEvents: IntegrityEvent[] = [];
  const outcomeReceipts: OutcomeReceipt[] = [];
  const cases: IntegrityCase[] = [];
  const incidents: IncidentRecord[] = [];
  const incidentUpdates: IncidentUpdate[] = [];
  const executions: Execution[] = [];
  const auditEvents: AuditEvent[] = [];
  const connectorLogs: ConnectorLog[] = [];
  const investigationResponses: Record<string, unknown> = {};

  // -------------------------------------------------------------------------
  // Customers and orders
  // -------------------------------------------------------------------------
  const usedNames = new Set<string>();
  const newCustomer = (): Customer => {
    let first: string;
    let last: string;
    do {
      first = rng.pick(FIRST_NAMES);
      last = rng.pick(LAST_NAMES);
    } while (usedNames.has(`${first} ${last}`));
    usedNames.add(`${first} ${last}`);
    const handle = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
    const customer: Customer = {
      id: uid("cust"),
      name: `${first} ${last}`,
      email: `${handle}${rng.int(10, 99)}@${rng.pick(EMAIL_DOMAINS)}`,
      phone: `+91 ${rng.pick(["9", "8", "7"])}${rng.int(1000, 9999)} ${rng.int(10000, 99999)}`,
    };
    customers.push(customer);
    return customer;
  };

  const usedOrderNumbers = new Set<number>();
  const merchantOrderId = (iso: string): string => {
    const dayIndex = Math.round(
      (Date.parse(`${istDate(iso)}T00:00:00Z`) - Date.parse(`${FIXTURE_ANCHOR_DATE}T00:00:00Z`)) / 86_400_000,
    );
    const [h, m, s] = istTime(iso).split(":").map(Number) as [number, number, number];
    let n = 4_300_000 + dayIndex * 2100 + Math.floor(((h * 3600 + m * 60 + s) * 2100) / 86_400);
    while (usedOrderNumbers.has(n)) n += 1;
    usedOrderNumbers.add(n);
    return `LL-${n}`;
  };

  // -------------------------------------------------------------------------
  // Payment-to-outcome chains
  // -------------------------------------------------------------------------
  const buildChain = (input: ChainInput): Chain => {
    const { customer, product, orderCreatedAt: t0 } = input;
    const contract = contractById(product.contractId);
    const authorizeAfter = input.authorizeAfter ?? 6;
    const capture = input.capture ?? true;
    const order: MerchantOrder = {
      id: merchantOrderId(t0),
      customerId: customer.id,
      productId: product.id,
      amount: product.price,
      createdAt: t0,
      status: input.orderStatus ?? "paid",
    };
    orders.push(order);
    const razorpayOrderId = uid("order");
    const payment: Payment = {
      id: uid("pay"),
      orderId: razorpayOrderId,
      merchantOrderId: order.id,
      customerId: customer.id,
      amount: product.price,
      currency: "INR",
      method: input.method ?? rng.pick<PaymentMethod>(["upi", "upi", "upi", "card", "card", "netbanking"]),
      status: capture ? "captured" : "authorized",
      createdAt: addSeconds(t0, Math.min(3, authorizeAfter - 1)),
    };
    payments.push(payment);

    const event = (type: PaymentEvent["type"], occurredAt: string, metadata?: Record<string, unknown>) => {
      const e: PaymentEvent = { id: uid("evt"), paymentId: payment.id, source: "razorpay", type, occurredAt };
      if (metadata) e.metadata = metadata;
      paymentEvents.push(e);
      return e;
    };
    const orderCreated = event("order.created", t0, { amount: product.price, receipt: order.id });
    const authorized = event("payment.authorized", addSeconds(t0, authorizeAfter), { method: payment.method });
    const chain: Chain = { order, payment, orderCreated, authorized, deliveries: [], outcomeEvents: [] };
    if (!capture) return chain;

    const capturedAt = addSeconds(t0, authorizeAfter + 1);
    payment.capturedAt = capturedAt;
    chain.captured = event("payment.captured", capturedAt, { amount: product.price });
    const orderPaid = event("order.paid", addSeconds(t0, authorizeAfter + 2));
    chain.orderPaid = orderPaid;

    let deliveryAt = orderPaid.occurredAt;
    let attempt = 1;
    for (const failure of input.webhookFailures ?? []) {
      deliveryAt = attempt === 1 ? deliveryAt : addSeconds(deliveryAt, failure.afterSeconds);
      const delivery: WebhookDelivery = {
        id: uid("whd"),
        eventId: orderPaid.id,
        endpoint: WEBHOOK_ENDPOINT,
        attempt,
        responseCode: failure.responseCode,
        latencyMs: failure.responseCode === 504 ? 10_000 : rng.int(180, 900),
        status: "failed",
        occurredAt: deliveryAt,
      };
      webhookDeliveries.push(delivery);
      chain.deliveries.push(delivery);
      attempt += 1;
    }
    let outcomeBase = orderPaid.occurredAt;
    if (!input.webhookNeverDelivered) {
      const lastFailure = input.webhookFailures?.at(-1);
      if (lastFailure) deliveryAt = addSeconds(deliveryAt, lastFailure.afterSeconds);
      const delivery: WebhookDelivery = {
        id: uid("whd"),
        eventId: orderPaid.id,
        endpoint: WEBHOOK_ENDPOINT,
        attempt,
        responseCode: 200,
        latencyMs: rng.int(210, 640),
        status: "delivered",
        occurredAt: deliveryAt,
      };
      webhookDeliveries.push(delivery);
      chain.deliveries.push(delivery);
      outcomeBase = deliveryAt;
    }

    const outcome = (
      type: MerchantOutcomeEvent["type"],
      status: MerchantOutcomeEvent["status"],
      occurredAt: string,
      responseCode?: number,
      metadata?: Record<string, unknown>,
    ) => {
      const e: MerchantOutcomeEvent = { id: uid("ll_evt", 12), merchantOrderId: order.id, source: "learnloop", type, status, occurredAt };
      if (responseCode !== undefined) e.responseCode = responseCode;
      if (metadata) e.metadata = metadata;
      outcomeEvents.push(e);
      chain.outcomeEvents.push(e);
      return e;
    };
    // Course and seat purchases record the fulfilment request itself; other services report only results.
    const fulfil = fulfilmentVocabulary(contract.fulfilmentService);
    const logsRequest = contract.fulfilmentService === "enrolment-service" || contract.fulfilmentService === "booking-service";
    const plan = input.outcome;
    if (plan.kind !== "none" && logsRequest && !input.webhookNeverDelivered) {
      outcome(fulfil.requested, "pending", addSeconds(outcomeBase, 1), undefined, { endpoint: fulfil.endpoint });
    }
    if (plan.kind === "confirmed") {
      outcome(contract.expectedOutcome, "completed", addSeconds(capturedAt, plan.afterSeconds), 200);
    } else if (plan.kind === "failed") {
      outcome(fulfil.failed, "failed", addSeconds(capturedAt, plan.afterSeconds), plan.responseCode, { endpoint: fulfil.endpoint });
    } else if (plan.kind === "pending") {
      outcome(contract.expectedOutcome, "pending", addSeconds(outcomeBase, 1));
    }

    const expectedBy = addSeconds(capturedAt, contract.deadlineSeconds);
    const granted = chain.outcomeEvents.find((e) => e.type === contract.expectedOutcome && e.status === "completed");
    const receipt: OutcomeReceipt = {
      id: uid("rcpt", 12),
      paymentId: payment.id,
      merchantOrderId: order.id,
      contractId: contract.id,
      status: granted ? "confirmed" : "missing",
      expectedBy,
    };
    if (granted) {
      receipt.outcomeEventId = granted.id;
      receipt.confirmedAt = granted.occurredAt;
    }
    outcomeReceipts.push(receipt);
    chain.receipt = receipt;
    if (granted) order.status = "fulfilled";
    else if (plan.kind === "failed") order.status = "fulfilment_failed";
    return chain;
  };

  // -------------------------------------------------------------------------
  // Audit and integrity events
  // -------------------------------------------------------------------------
  const audit = (e: Omit<AuditEvent, "id">): AuditEvent => {
    const event: AuditEvent = { id: uid("aud", 12), ...e };
    auditEvents.push(event);
    return event;
  };
  const integrity = (e: Omit<IntegrityEvent, "id" | "source">): IntegrityEvent => {
    const event: IntegrityEvent = { id: uid("pie", 12), source: "payment_integrity", ...e };
    integrityEvents.push(event);
    return event;
  };
  const observability = (e: Omit<ObservabilityEvent, "id" | "source">): ObservabilityEvent => {
    const event: ObservabilityEvent = { id: uid("obs", 12), source: "learnloop_observability", ...e };
    observabilityEvents.push(event);
    return event;
  };

  // -------------------------------------------------------------------------
  // Cases
  // -------------------------------------------------------------------------
  let caseSeq = 10_401;
  type CaseInput = {
    type: CaseType;
    chain: Chain;
    detectedAt: string;
    status: CaseStatus;
    investigation?: Investigation;
    defaultOutcome: DefaultOutcome;
    customerContact?: CustomerContactState;
    incidentId?: string;
    related?: Chain[];
    observation?: IntegrityCase["observation"];
    deadline?: string;
    missedDeadline?: boolean;
  };
  const openCase = (input: CaseInput): IntegrityCase => {
    const { chain } = input;
    const id = `CS-${caseSeq}`;
    caseSeq += 1;
    const related = input.related ?? [];
    const c: IntegrityCase = {
      id,
      paymentId: chain.payment.id,
      outcomeContractId: productById(chain.order.productId).contractId,
      type: input.type,
      status: input.status,
      amountAtRisk: chain.payment.amount,
      detectedAt: input.detectedAt,
      customerId: chain.payment.customerId,
      relatedPaymentIds: related.map((r) => r.payment.id),
      refundExposure: related.reduce((total, r) => total + r.payment.amount, 0),
      defaultOutcome: input.defaultOutcome,
      customerContact: input.customerContact ?? "none",
      decisions: [],
      version: 1,
      updatedAt: input.detectedAt,
    };
    if (input.incidentId) c.incidentId = input.incidentId;
    const deadline = input.deadline ?? chain.receipt?.expectedBy;
    if (deadline) c.deadline = deadline;
    if (input.observation) c.observation = input.observation;
    if (input.missedDeadline !== false && chain.receipt) {
      integrity({ type: "outcome.deadline_missed", caseId: id, occurredAt: chain.receipt.expectedBy, metadata: { receiptId: chain.receipt.id } });
    }
    integrity({ type: input.status === "observing" ? "case.observing" : "case.opened", caseId: id, occurredAt: input.detectedAt });
    audit({
      occurredAt: input.detectedAt,
      actor: ACTORS.agent,
      action: input.status === "observing" ? "Started observing payment" : "Opened case",
      targetType: "case",
      targetId: id,
      caseId: id,
      result: caseOpenedResult(input.type),
      evidenceIds: chain.receipt ? [chain.receipt.id] : [chain.authorized?.id ?? chain.orderCreated.id],
      approvalSource: "not_required",
      ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    });
    if (input.investigation) {
      const recommendedAt = addSeconds(input.detectedAt, 4);
      investigationResponses[id] = input.investigation;
      c.investigation = input.investigation;
      c.recommendation = toRecommendation(input.investigation, input.type, recommendedAt);
      audit({
        occurredAt: recommendedAt,
        actor: ACTORS.agent,
        action: "Recommended action",
        targetType: "case",
        targetId: id,
        caseId: id,
        result: `${actionLabel(c.recommendation.action, contractById(c.outcomeContractId))} (confidence ${Math.round(input.investigation.confidence * 100)}%)`,
        evidenceIds: input.investigation.evidenceIds,
        approvalSource: "not_required",
        ...(input.incidentId ? { incidentId: input.incidentId } : {}),
      });
    }
    c.updatedAt = c.recommendation?.createdAt ?? input.detectedAt;
    cases.push(c);
    return c;
  };

  const recordPolicyEvaluation = (c: IntegrityCase, occurredAt: string, result: PolicyVerdict["result"], summary: string) => {
    audit({
      occurredAt,
      actor: ACTORS.policy,
      action: "Evaluated policy",
      targetType: "case",
      targetId: c.id,
      caseId: c.id,
      result: summary,
      policyResult: result,
      approvalSource: "not_required",
      ...(c.incidentId ? { incidentId: c.incidentId } : {}),
    });
  };

  /** Records a completed recovery: approval, execution steps, outcome, verification. */
  const resolveByAction = (
    c: IntegrityCase,
    chain: Chain,
    opts: {
      action: ActionType;
      approvedAt: string;
      approvalSource: Execution["approvalSource"];
      edited?: boolean;
      bulk?: boolean;
      outcomeLatencySeconds: number;
      replayDelivery?: boolean;
    },
  ): Execution => {
    const approver = opts.approvalSource === "merchant" ? OPERATOR.name : ACTORS.policy;
    const t = opts.approvedAt;
    const decision: CaseDecision = { decidedAt: t, actor: approver, kind: "approved", action: opts.action };
    if (opts.edited) decision.edited = true;
    if (opts.bulk) decision.bulk = true;
    c.decisions.push(decision);
    audit({
      occurredAt: t,
      actor: approver,
      action: opts.approvalSource === "merchant" ? (opts.bulk ? "Approved recovery (bulk)" : "Approved recovery") : "Approved automatically",
      targetType: "case",
      targetId: c.id,
      caseId: c.id,
      result: actionLabel(opts.action, contractById(c.outcomeContractId)),
      policyResult: opts.approvalSource === "merchant" ? "requires_approval" : "allowed",
      approvalSource: opts.approvalSource,
      evidenceIds: c.recommendation?.evidenceIds ?? [],
      ...(c.incidentId ? { incidentId: c.incidentId } : {}),
    });

    const actionEventIds: string[] = [];
    const started = addSeconds(t, 2);
    if (opts.replayDelivery && chain.orderPaid) {
      const replay: WebhookDelivery = {
        id: uid("whd"),
        eventId: chain.orderPaid.id,
        endpoint: WEBHOOK_ENDPOINT,
        attempt: chain.deliveries.length + 1,
        responseCode: 200,
        latencyMs: rng.int(220, 520),
        status: "delivered",
        occurredAt: started,
      };
      webhookDeliveries.push(replay);
      chain.deliveries.push(replay);
      actionEventIds.push(replay.id);
    } else {
      const fulfil = fulfilmentVocabulary(contractById(c.outcomeContractId).fulfilmentService);
      const request: MerchantOutcomeEvent = {
        id: uid("ll_evt", 12),
        merchantOrderId: chain.order.id,
        source: "learnloop",
        type: fulfil.requested,
        status: "pending",
        occurredAt: started,
        metadata: { endpoint: fulfil.endpoint, initiatedBy: "payment_integrity" },
      };
      outcomeEvents.push(request);
      actionEventIds.push(request.id);
    }
    const contract = contractById(c.outcomeContractId);
    const outcomeAt = addSeconds(started, opts.outcomeLatencySeconds);
    const granted: MerchantOutcomeEvent = {
      id: uid("ll_evt", 12),
      merchantOrderId: chain.order.id,
      source: "learnloop",
      type: contract.expectedOutcome,
      status: "completed",
      responseCode: 200,
      occurredAt: outcomeAt,
    };
    outcomeEvents.push(granted);
    chain.order.status = "fulfilled";
    const verifiedAt = addSeconds(outcomeAt, 1);
    if (chain.receipt) {
      chain.receipt.status = "confirmed";
      chain.receipt.outcomeEventId = granted.id;
      chain.receipt.confirmedAt = verifiedAt;
    }
    integrity({ type: "outcome.verified", caseId: c.id, occurredAt: verifiedAt, metadata: { outcomeEventId: granted.id } });

    const steps: ExecutionStep[] = [
      { state: "approval_recorded", at: t, detail: `Approved by ${approver}` },
      { state: "policy_rechecking", at: addSeconds(t, 1), detail: "Payment, outcome and policy re-fetched; verdict unchanged" },
      { state: "idempotency_reserved", at: addSeconds(t, 1), detail: `Key ${chain.payment.id}:${opts.action}` },
      { state: "action_started", at: started, detail: opts.replayDelivery ? "order.paid webhook replayed" : "Enrolment request sent" },
      { state: "awaiting_outcome", at: addSeconds(started, 1), detail: `Waiting for ${contract.expectedOutcome}` },
      { state: "outcome_verified", at: verifiedAt, detail: `${contract.expectedOutcome} received` },
      { state: "resolved", at: verifiedAt, detail: "Payment and merchant outcome are consistent" },
    ];
    const execution: Execution = {
      id: uid("exe", 12),
      caseId: c.id,
      action: opts.action,
      idempotencyKey: `${chain.payment.id}:${opts.action}`,
      status: "resolved",
      approvalSource: opts.approvalSource,
      approvedBy: approver,
      approvedCaseVersion: c.version,
      priorCaseStatus: c.status,
      steps,
      actionEventIds,
      startedAt: t,
      finishedAt: verifiedAt,
    };
    if (chain.receipt) execution.receiptId = chain.receipt.id;
    executions.push(execution);

    const base = { targetType: "case" as const, targetId: c.id, caseId: c.id, ...(c.incidentId ? { incidentId: c.incidentId } : {}) };
    audit({ ...base, occurredAt: addSeconds(t, 1), actor: ACTORS.policy, action: "Re-checked policy before execution", result: "Verdict unchanged", policyResult: opts.approvalSource === "merchant" ? "requires_approval" : "allowed", approvalSource: opts.approvalSource });
    audit({ ...base, occurredAt: started, actor: ACTORS.connector, action: opts.replayDelivery ? "Replayed webhook" : "Sent enrolment request", result: "Accepted", evidenceIds: actionEventIds, approvalSource: opts.approvalSource });
    audit({ ...base, occurredAt: verifiedAt, actor: ACTORS.agent, action: "Verified outcome", result: `${contract.expectedOutcome} confirmed`, evidenceIds: [granted.id, ...(chain.receipt ? [chain.receipt.id] : [])], approvalSource: opts.approvalSource });
    audit({ ...base, occurredAt: verifiedAt, actor: ACTORS.agent, action: "Resolved case", result: "Outcome confirmed", evidenceIds: chain.receipt ? [chain.receipt.id] : [], approvalSource: opts.approvalSource });

    c.status = "resolved";
    c.resolution = {
      resolvedAt: verifiedAt,
      method: opts.approvalSource === "merchant" ? "approved_recovery" : "automatic_recovery",
      action: opts.action,
      actor: ACTORS.agent,
      ...(chain.receipt ? { receiptId: chain.receipt.id } : {}),
    };
    c.version += 2;
    c.updatedAt = verifiedAt;
    return execution;
  };

  const resolveByArrival = (c: IntegrityCase, chain: Chain, arrivedAt: string) => {
    const contract = contractById(c.outcomeContractId);
    const arrived: MerchantOutcomeEvent = {
      id: uid("ll_evt", 12),
      merchantOrderId: chain.order.id,
      source: "learnloop",
      type: contract.expectedOutcome,
      status: "completed",
      responseCode: 200,
      occurredAt: arrivedAt,
    };
    outcomeEvents.push(arrived);
    chain.order.status = "fulfilled";
    const verifiedAt = addSeconds(arrivedAt, 1);
    if (chain.receipt) {
      chain.receipt.status = "confirmed";
      chain.receipt.outcomeEventId = arrived.id;
      chain.receipt.confirmedAt = verifiedAt;
    }
    integrity({ type: "outcome.arrived_late", caseId: c.id, occurredAt: verifiedAt, metadata: { outcomeEventId: arrived.id } });
    audit({
      occurredAt: verifiedAt,
      actor: ACTORS.agent,
      action: "Closed case",
      targetType: "case",
      targetId: c.id,
      caseId: c.id,
      result: `${contract.expectedOutcome} arrived without intervention`,
      evidenceIds: [arrived.id],
      approvalSource: "not_required",
      ...(c.incidentId ? { incidentId: c.incidentId } : {}),
    });
    c.status = "resolved";
    c.resolution = {
      resolvedAt: verifiedAt,
      method: "outcome_arrived",
      actor: ACTORS.agent,
      ...(chain.receipt ? { receiptId: chain.receipt.id } : {}),
    };
    c.version += 1;
    c.updatedAt = verifiedAt;
  };

  const reject = (c: IntegrityCase, rejectedAt: string, reason: string) => {
    c.decisions.push({ decidedAt: rejectedAt, actor: OPERATOR.name, kind: "rejected", ...(c.recommendation ? { action: c.recommendation.action } : {}), reason });
    audit({
      occurredAt: rejectedAt,
      actor: OPERATOR.name,
      action: "Rejected recommendation",
      targetType: "case",
      targetId: c.id,
      caseId: c.id,
      result: reason,
      approvalSource: "merchant",
      evidenceIds: c.recommendation?.evidenceIds ?? [],
    });
    c.status = "rejected";
    c.version += 1;
    c.updatedAt = rejectedAt;
  };

  // -------------------------------------------------------------------------
  // Investigation templates
  // -------------------------------------------------------------------------
  const missingOutcomeEvidence = (chain: Chain, extra: string[] = []): string[] =>
    [
      chain.captured?.id,
      chain.deliveries.find((d) => d.status === "delivered")?.id,
      chain.outcomeEvents.find((e) => e.status === "failed")?.id,
      chain.receipt?.id,
      ...extra,
    ].filter((id): id is string => Boolean(id));

  const hyp = (cause: string, verdict: Hypothesis["verdict"], evidenceIds: Array<string | undefined>, reasoning: string): Hypothesis => ({
    cause,
    verdict,
    evidenceIds: evidenceIds.filter((id): id is string => Boolean(id)),
    reasoning,
  });
  const delivered = (chain: Chain) => chain.deliveries.find((d) => d.status === "delivered")?.id;
  const failedOutcome = (chain: Chain) => chain.outcomeEvents.find((e) => e.status === "failed")?.id;

  const courseMessage = (product: Product) =>
    `Your ${formatINR(product.price)} payment for ${product.name} was successful. We are restoring your course access now, and you will not be charged again.`;

  // -------------------------------------------------------------------------
  // Observability history
  // -------------------------------------------------------------------------
  for (const [daysBefore, version] of [[27, "v2.0"], [19, "v2.1"], [8, "v2.2"]] as const) {
    observability({
      type: "deploy.completed",
      service: "enrolment-service",
      occurredAt: at(daysBefore, "11:32:00"),
      metadata: { version, environment: "production", deployedBy: "ci-pipeline" },
    });
  }

  // =========================================================================
  // HISTORY: automatic retries (days 28-15), before retry was set to suggest-only
  // =========================================================================
  const courseProducts = PRODUCTS.filter((p) => p.contractId === CONTRACT_IDS.course && p.price <= 4999);
  const businessTime = (): string => {
    const hour = rng.pick([10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22]);
    return `${String(hour).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}`;
  };

  const sporadicMissingOutcome = (daysBefore: number, product: Product, time = businessTime(), responseCode = rng.pick([500, 502, 504])) => {
    const chain = buildChain({
      customer: newCustomer(),
      product,
      orderCreatedAt: at(daysBefore, time),
      outcome: { kind: "failed", afterSeconds: 2, responseCode },
    });
    const detectedAt = addSeconds(chain.receipt!.expectedBy, 1);
    const investigation: Investigation = {
      summary: `order.paid was acknowledged with HTTP 200, but the /enroll call returned HTTP ${responseCode} and no course_access_granted arrived within 2 minutes.`,
      likelyCause: `Single enrolment request failure (HTTP ${responseCode}); no other failures in the surrounding window.`,
      evidenceIds: missingOutcomeEvidence(chain),
      uncertainties: [],
      hypotheses: [
        hyp("order.paid not delivered to LearnLoop", "ruled_out", [delivered(chain)], "LearnLoop acknowledged order.paid with HTTP 200."),
        hyp("Enrolment request failed", "supported", [failedOutcome(chain)], `/enroll returned HTTP ${responseCode} and no access grant followed.`),
        hyp("Wider enrolment outage", "ruled_out", [chain.receipt?.id], "No other purchases in the surrounding window missed their outcome."),
      ],
      recommendedAction: "retry_provisioning",
      confidence: rng.pick([0.96, 0.97, 0.98]),
      customerImpact: `Customer paid ${formatINR(product.price)} for ${product.name} and does not have course access.`,
      consequenceOfInaction: "The customer is likely to contact LearnLoop support or request a refund.",
      customerMessageDraft: courseMessage(product),
    };
    return { chain, detectedAt, investigation };
  };

  const historyChains = new Map<string, Chain>();
  const autoDays = [28, 27, 27, 26, 24, 23, 22, 21, 19, 18, 17, 16];
  let wrongActionCaseId: string | undefined;
  autoDays.forEach((daysBefore, index) => {
    const { chain, detectedAt, investigation } = sporadicMissingOutcome(daysBefore, rng.pick(courseProducts));
    const c = openCase({ type: "missing_outcome", chain, detectedAt, status: "open", investigation, defaultOutcome: "customer_contact" });
    historyChains.set(c.id, chain);
    recordPolicyEvaluation(c, addSeconds(detectedAt, 5), "allowed", "All checks passed; retry provisioning is automatic below ₹5,000");
    resolveByAction(c, chain, {
      action: "retry_provisioning",
      approvedAt: addSeconds(detectedAt, 6),
      approvalSource: "policy_automatic",
      outcomeLatencySeconds: rng.int(3, 8),
    });
    if (index === autoDays.length - 1) wrongActionCaseId = c.id;
  });

  // The last automatic retry granted access to a customer whose cancellation
  // was already with LearnLoop support. LearnLoop revoked access and refunded.
  const wrongCase = cases.find((c) => c.id === wrongActionCaseId)!;
  const wrongChain = historyChains.get(wrongCase.id)!;
  {
    const revokedAt = addSeconds(wrongCase.resolution!.resolvedAt, 2 * 3600 + 14 * 60);
    const revoked: MerchantOutcomeEvent = {
      id: uid("ll_evt", 12),
      merchantOrderId: wrongChain.order.id,
      source: "learnloop",
      type: "course_access_revoked",
      status: "completed",
      responseCode: 200,
      occurredAt: revokedAt,
      metadata: { reason: "Customer cancellation raised with LearnLoop support before access was granted" },
    };
    outcomeEvents.push(revoked);
    const refunded: PaymentEvent = { id: uid("evt"), paymentId: wrongChain.payment.id, source: "razorpay", type: "payment.refunded", occurredAt: addSeconds(revokedAt, 300), metadata: { amount: wrongChain.payment.amount, initiatedBy: "LearnLoop finance" } };
    paymentEvents.push(refunded);
    wrongChain.payment.status = "refunded";
    wrongCase.wrongAction = { detectedAt: revokedAt, reason: "Access granted to a customer who had already asked LearnLoop support to cancel; LearnLoop revoked access and refunded." };
    wrongCase.customerContact = "customer_initiated";
    audit({ occurredAt: addSeconds(revokedAt, 5), actor: ACTORS.connector, action: "Reported access revoked", targetType: "case", targetId: wrongCase.id, caseId: wrongCase.id, result: "Automatic retry marked as a wrong action", evidenceIds: [revoked.id, refunded.id], approvalSource: "not_required" });
    audit({ occurredAt: at(14, "10:12:00"), actor: OPERATOR.name, action: "Changed action policy", targetType: "policy", targetId: "retry_provisioning", result: "Retry provisioning: Automatic below thresholds → Suggest only", evidenceIds: [wrongCase.id], approvalSource: "merchant" });
  }

  // =========================================================================
  // HISTORY: 50 merchant-reviewed retries (days 14-1): 48 approved unedited, 2 edited
  // =========================================================================
  const reviewedDays = [14, 14, 13, 13, 13, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 6, 6, 6, 6, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1];
  // The two edited decisions are the oldest after the switch to Suggest only (10:12 on day 14).
  const editedIndexes = new Set([0, 1]);
  const day14Times = ["15:22:10", "18:47:31"];
  const customerContactIndexes = new Set([5, 22, 29, 41]);
  reviewedDays.forEach((daysBefore, index) => {
    const { chain, detectedAt, investigation } = sporadicMissingOutcome(daysBefore, rng.pick(courseProducts), day14Times[index]);
    const c = openCase({
      type: "missing_outcome",
      chain,
      detectedAt,
      status: "open",
      investigation,
      defaultOutcome: "customer_contact",
      customerContact: customerContactIndexes.has(index) ? "customer_initiated" : "none",
    });
    recordPolicyEvaluation(c, addSeconds(detectedAt, 5), "requires_approval", "All checks passed; retry provisioning is set to Suggest only");
    const decisionAt = addSeconds(detectedAt, rng.int(4, 55) * 60);
    if (editedIndexes.has(index)) {
      // Merchant edited the action to wait; the outcome then arrived on its own.
      c.decisions.push({ decidedAt: decisionAt, actor: OPERATOR.name, kind: "edited", action: "wait", edited: true, reason: "LearnLoop engineering confirmed a queued enrolment retry" });
      audit({ occurredAt: decisionAt, actor: OPERATOR.name, action: "Edited recommendation", targetType: "case", targetId: c.id, caseId: c.id, result: "Retry enrolment → Wait and re-check", approvalSource: "merchant", evidenceIds: investigation.evidenceIds });
      resolveByArrival(c, chain, addSeconds(decisionAt, rng.int(3, 9) * 60));
    } else {
      resolveByAction(c, chain, { action: "retry_provisioning", approvedAt: decisionAt, approvalSource: "merchant", outcomeLatencySeconds: rng.int(3, 8) });
    }
  });

  // =========================================================================
  // HISTORY: resolved incident INC-0011, membership activations delayed (day 25)
  // =========================================================================
  {
    const incidentId = "INC-0011";
    const membership = productById("prd_plus_membership");
    const errors = observability({ type: "service.errors_detected", service: "membership-service", occurredAt: at(25, "18:02:10"), metadata: { signal: "p95 activation latency 212 s", normalP95Seconds: 96 } });
    const recovered = observability({ type: "service.recovered", service: "membership-service", occurredAt: at(25, "18:21:30"), metadata: { signal: "p95 activation latency 41 s" } });
    const caseIds: string[] = [];
    for (const time of ["18:04:12", "18:07:48", "18:11:05"]) {
      const chain = buildChain({ customer: newCustomer(), product: membership, orderCreatedAt: at(25, time), outcome: { kind: "pending" } });
      const detectedAt = addSeconds(chain.payment.capturedAt!, 100);
      const c = openCase({
        type: "delayed_processing",
        chain,
        detectedAt,
        status: "observing",
        defaultOutcome: "none",
        incidentId,
        missedDeadline: false,
        observation: { observedDelaySeconds: 100, normalRangeSeconds: { p50: 18, p95: 96 } },
      });
      caseIds.push(c.id);
      resolveByArrival(c, chain, addSeconds(chain.payment.capturedAt!, rng.int(170, 260)));
    }
    const first = cases.find((c) => c.id === caseIds[0])!;
    const last = cases.find((c) => c.id === caseIds[2])!;
    incidents.push({
      id: incidentId,
      title: "Membership activations slower than normal",
      status: "resolved",
      severity: "low",
      caseIds,
      startedAt: errors.occurredAt,
      detectedAt: addSeconds(first.detectedAt, 200),
      resolvedAt: last.resolution!.resolvedAt,
      likelyCause: "membership-service activation latency rose above its normal range for 19 minutes",
      outcomeContractId: CONTRACT_IDS.membership,
      owner: OPERATOR.name,
      affectedService: "membership-service",
      summary: "Membership payments succeeded, but activations took up to four minutes. All activations completed without intervention.",
    });
    integrity({ type: "incident.created", incidentId, occurredAt: addSeconds(first.detectedAt, 200) });
    audit({ occurredAt: addSeconds(first.detectedAt, 200), actor: ACTORS.agent, action: "Created incident", targetType: "incident", targetId: incidentId, incidentId, result: "3 delayed membership activations clustered", evidenceIds: [errors.id, ...caseIds], approvalSource: "not_required" });
    audit({ occurredAt: last.resolution!.resolvedAt, actor: ACTORS.agent, action: "Resolved incident", targetType: "incident", targetId: incidentId, incidentId, result: "All outcomes arrived", evidenceIds: [recovered.id], approvalSource: "not_required" });
  }

  // =========================================================================
  // HISTORY: resolved incident INC-0014, webhooks rejected with HTTP 503 (day 12)
  // =========================================================================
  {
    const incidentId = "INC-0014";
    const errors = observability({ type: "service.errors_detected", service: "learnloop-webhooks", occurredAt: at(12, "19:40:05"), metadata: { endpoint: "/webhooks/razorpay", statusCode: 503, message: "upstream connect error: no healthy upstream" } });
    const recovered = observability({ type: "service.recovered", service: "learnloop-webhooks", occurredAt: at(12, "19:58:40"), metadata: { endpoint: "/webhooks/razorpay", healthCheck: "passing" } });
    const times = ["19:41:10", "19:43:52", "19:46:31", "19:49:02", "19:52:47", "19:55:20"];
    const caseIds: string[] = [];
    const chains: Chain[] = [];
    for (const time of times) {
      const product = rng.pick(courseProducts);
      const chain = buildChain({
        customer: newCustomer(),
        product,
        orderCreatedAt: at(12, time),
        webhookFailures: [
          { responseCode: 503, afterSeconds: 0 },
          { responseCode: 503, afterSeconds: 30 },
          { responseCode: 503, afterSeconds: 60 },
        ],
        webhookNeverDelivered: true,
        outcome: { kind: "none" },
        orderStatus: "pending_payment",
      });
      const detectedAt = addSeconds(chain.receipt!.expectedBy, 1);
      const investigation: Investigation = {
        summary: "Payment captured, but every order.paid delivery to LearnLoop's webhook endpoint returned HTTP 503, so LearnLoop never started enrolment.",
        likelyCause: "LearnLoop webhook endpoint unavailable (HTTP 503: no healthy upstream).",
        evidenceIds: [chain.captured!.id, ...chain.deliveries.map((d) => d.id), chain.receipt!.id, errors.id],
        uncertainties: [],
        hypotheses: [
          hyp("LearnLoop webhook endpoint unavailable", "supported", [...chain.deliveries.map((d) => d.id), errors.id], "Every order.paid delivery returned HTTP 503 while the endpoint reported no healthy upstream."),
          hyp("Enrolment service failure", "ruled_out", [chain.receipt!.id], "No enrolment request was made, so enrolment could not have failed; LearnLoop never learned of the payment."),
        ],
        recommendedAction: "replay_webhook",
        confidence: 0.96,
        customerImpact: `Customer paid ${formatINR(product.price)} for ${product.name} and does not have course access.`,
        consequenceOfInaction: "LearnLoop has no record of the payment; access is not granted until order.paid is delivered.",
        customerMessageDraft: courseMessage(product),
      };
      const c = openCase({ type: "missing_outcome", chain, detectedAt, status: "open", investigation, defaultOutcome: "customer_contact", incidentId });
      recordPolicyEvaluation(c, addSeconds(detectedAt, 5), "requires_approval", "All checks passed; replay webhook is set to Suggest only");
      caseIds.push(c.id);
      chains.push(chain);
    }
    const detectedAt = addSeconds(cases.find((c) => c.id === caseIds[1])!.detectedAt, 20);
    const approvedAt = at(12, "20:06:15");
    caseIds.forEach((caseId, index) => {
      const c = cases.find((x) => x.id === caseId)!;
      resolveByAction(c, chains[index]!, { action: "replay_webhook", approvedAt, approvalSource: "merchant", bulk: true, outcomeLatencySeconds: rng.int(4, 9), replayDelivery: true });
    });
    const resolvedAt = cases.filter((c) => caseIds.includes(c.id)).map((c) => c.resolution!.resolvedAt).sort().at(-1)!;
    incidents.push({
      id: incidentId,
      title: "Order webhooks rejected by LearnLoop endpoint",
      status: "resolved",
      severity: "medium",
      caseIds,
      startedAt: errors.occurredAt,
      detectedAt,
      resolvedAt,
      likelyCause: "LearnLoop webhook endpoint returned HTTP 503 (no healthy upstream) for 18 minutes",
      outcomeContractId: CONTRACT_IDS.course,
      owner: OPERATOR.name,
      affectedService: "learnloop-webhooks",
      summary: "Payments were captured, but LearnLoop's webhook endpoint rejected order.paid, so enrolment never started.",
    });
    integrity({ type: "incident.created", incidentId, occurredAt: detectedAt });
    audit({ occurredAt: detectedAt, actor: ACTORS.agent, action: "Created incident", targetType: "incident", targetId: incidentId, incidentId, result: "2 cases share webhook HTTP 503 failures", evidenceIds: [errors.id, ...caseIds.slice(0, 2)], approvalSource: "not_required" });
    audit({ occurredAt: resolvedAt, actor: ACTORS.agent, action: "Resolved incident", targetType: "incident", targetId: incidentId, incidentId, result: "6 of 6 outcomes verified after webhook replay", evidenceIds: [recovered.id], approvalSource: "not_required" });
  }

  // =========================================================================
  // HISTORY: waiting cases that resolved without becoming incidents
  // =========================================================================
  for (const daysBefore of [26, 20, 15, 11, 6, 3]) {
    const product = rng.pick(courseProducts);
    const chain = buildChain({
      customer: newCustomer(),
      product,
      orderCreatedAt: at(daysBefore, businessTime()),
      webhookFailures: [{ responseCode: 504, afterSeconds: 0 }],
      outcome: { kind: "none" },
    });
    // Razorpay retried delivery after the first attempt timed out.
    const retry = chain.deliveries.at(-1)!;
    retry.occurredAt = addSeconds(chain.deliveries[0]!.occurredAt, 75);
    const observedDelay = 60;
    const c = openCase({
      type: "delayed_processing",
      chain,
      detectedAt: addSeconds(chain.payment.capturedAt!, observedDelay),
      status: "observing",
      defaultOutcome: "none",
      missedDeadline: false,
      observation: { observedDelaySeconds: observedDelay, normalRangeSeconds: { p50: 8, p95: 75 } },
    });
    resolveByArrival(c, chain, addSeconds(retry.occurredAt, rng.int(3, 7)));
  }

  // =========================================================================
  // HISTORY: late authorisations (two captured on approval, one rejected)
  // =========================================================================
  const lateAuthorization = (daysBefore: number, product: Product) => {
    const orderAt = at(daysBefore, businessTime());
    const chain = buildChain({
      customer: newCustomer(),
      product,
      orderCreatedAt: orderAt,
      authorizeAfter: 15 * 60 + rng.int(60, 240),
      capture: false,
      outcome: { kind: "none" },
      orderStatus: "expired",
    });
    const authorizedAt = chain.authorized!.occurredAt;
    chain.payment.captureDeadline = captureDeadlineFor(chain.payment);
    const detectedAt = addSeconds(authorizedAt, 2);
    const investigation: Investigation = {
      summary: `The bank authorised the payment ${Math.round((Date.parse(authorizedAt) - Date.parse(orderAt)) / 60000)} minutes after checkout started, after the LearnLoop order had expired. It was not captured and will be refunded automatically if not captured by the deadline.`,
      likelyCause: "Late bank authorisation after the checkout session expired.",
      evidenceIds: [chain.orderCreated.id, chain.authorized!.id],
      uncertainties: ["Whether the customer still expects access after checkout timed out."],
      hypotheses: [
        hyp("Bank authorised after checkout expired", "supported", [chain.orderCreated.id, chain.authorized!.id], "Authorisation arrived after the LearnLoop order had expired, so it was never captured."),
        hyp("Payment failed", "ruled_out", [chain.authorized!.id], "The bank authorised the payment; the money is held, not declined."),
      ],
      recommendedAction: "capture",
      confidence: 0.95,
      customerImpact: `Customer's ${formatINR(product.price)} is held by the bank and they do not have access.`,
      consequenceOfInaction: "The authorisation expires and the payment is refunded automatically; the sale is lost.",
      customerMessageDraft: `Your ${formatINR(product.price)} payment for ${product.name} was confirmed by your bank. Your course access is now being activated.`,
    };
    const c = openCase({ type: "late_authorization", chain, detectedAt, status: "open", investigation, defaultOutcome: "auto_refund", missedDeadline: false, deadline: chain.payment.captureDeadline });
    recordPolicyEvaluation(c, addSeconds(detectedAt, 5), "requires_approval", "Capture payment always requires approval");
    return { c, chain };
  };
  for (const daysBefore of [22, 9]) {
    const { c, chain } = lateAuthorization(daysBefore, rng.pick(courseProducts));
    const approvedAt = addSeconds(c.detectedAt, rng.int(20, 90) * 60);
    const capturedAt = addSeconds(approvedAt, 2);
    const capturedEvt: PaymentEvent = { id: uid("evt"), paymentId: chain.payment.id, source: "razorpay", type: "payment.captured", occurredAt: capturedAt, metadata: { amount: chain.payment.amount, initiatedBy: "payment_integrity" } };
    paymentEvents.push(capturedEvt);
    chain.payment.status = "captured";
    chain.payment.capturedAt = capturedAt;
    const contract = contractById(CONTRACT_IDS.course);
    chain.receipt = { id: uid("rcpt", 12), paymentId: chain.payment.id, merchantOrderId: chain.order.id, contractId: contract.id, status: "missing", expectedBy: addSeconds(capturedAt, contract.deadlineSeconds) };
    outcomeReceipts.push(chain.receipt);
    resolveByAction(c, chain, { action: "capture", approvedAt, approvalSource: "merchant", outcomeLatencySeconds: rng.int(5, 9) });
  }
  {
    const { c, chain } = lateAuthorization(17, rng.pick(courseProducts));
    reject(c, addSeconds(c.detectedAt, 41 * 60), "Customer completed a new purchase for the same course after checkout timed out.");
    const refunded: PaymentEvent = { id: uid("evt"), paymentId: chain.payment.id, source: "razorpay", type: "payment.refunded", occurredAt: chain.payment.captureDeadline!, metadata: { amount: chain.payment.amount, reason: "authorisation not captured before deadline" } };
    paymentEvents.push(refunded);
    chain.payment.status = "refunded";
  }

  // =========================================================================
  // HISTORY: rejected recommendations
  // =========================================================================
  for (const [daysBefore, reason, contact] of [
    [10, "LearnLoop support granted access manually before this case was reviewed.", "customer_initiated"],
    [4, "Order belongs to a corporate cohort; access is granted by the cohort administrator.", "none"],
  ] as const) {
    const { chain, detectedAt, investigation } = sporadicMissingOutcome(daysBefore, rng.pick(courseProducts));
    const c = openCase({ type: "missing_outcome", chain, detectedAt, status: "open", investigation, defaultOutcome: "customer_contact", customerContact: contact });
    recordPolicyEvaluation(c, addSeconds(detectedAt, 5), "requires_approval", "All checks passed; retry provisioning is set to Suggest only");
    reject(c, addSeconds(detectedAt, rng.int(10, 70) * 60), reason);
  }

  // =========================================================================
  // HISTORY: duplicate payments (grant once, second charge refunded by LearnLoop finance)
  // =========================================================================
  for (const daysBefore of [18, 6]) {
    const product = rng.pick(courseProducts);
    const customer = newCustomer();
    const time = businessTime();
    const first = buildChain({ customer, product, orderCreatedAt: at(daysBefore, time), outcome: { kind: "failed", afterSeconds: 2, responseCode: 504 } });
    const second = buildChain({ customer, product, orderCreatedAt: addSeconds(first.orderCreated.occurredAt, rng.int(150, 260)), outcome: { kind: "failed", afterSeconds: 2, responseCode: 504 } });
    // The duplicate's own receipt is tracked by the case for the original purchase.
    outcomeReceipts.splice(outcomeReceipts.indexOf(second.receipt!), 1);
    second.receipt = undefined;
    const detectedAt = addSeconds(first.receipt!.expectedBy, 1) > second.captured!.occurredAt ? addSeconds(first.receipt!.expectedBy, 1) : addSeconds(second.captured!.occurredAt, 2);
    const investigation: Investigation = {
      summary: `Customer paid twice for ${product.name}, ${Math.round((Date.parse(second.captured!.occurredAt) - Date.parse(first.captured!.occurredAt)) / 60000)} minutes apart. Neither payment produced access because /enroll timed out.`,
      likelyCause: "Enrolment request timed out (HTTP 504); the customer retried checkout when access did not appear.",
      evidenceIds: [first.captured!.id, second.captured!.id, first.outcomeEvents.find((e) => e.status === "failed")!.id, first.receipt!.id],
      uncertainties: ["Whether the second payment was intentional."],
      hypotheses: [
        hyp("Customer retried because access did not appear", "supported", [first.captured!.id, second.captured!.id], "The second payment for the same course followed the first failed enrolment within minutes."),
        hyp("Enrolment request timed out", "supported", [failedOutcome(first)], "/enroll returned HTTP 504 for the first payment."),
      ],
      recommendedAction: "retry_provisioning",
      confidence: 0.9,
      customerImpact: `Customer was charged ${formatINR(product.price * 2)} for one ${formatINR(product.price)} course and has no access.`,
      consequenceOfInaction: "A refund request or payment dispute is likely.",
    };
    const c = openCase({ type: "duplicate_payment", chain: first, related: [second], detectedAt, status: "review_required", investigation, defaultOutcome: "customer_contact" });
    recordPolicyEvaluation(c, addSeconds(detectedAt, 5), "requires_approval", "Second captured payment found; individual review required");
    resolveByAction(c, first, { action: "review_duplicate", approvedAt: addSeconds(detectedAt, rng.int(15, 50) * 60), approvalSource: "merchant", outcomeLatencySeconds: rng.int(4, 8) });
    const refundAt = addSeconds(c.resolution!.resolvedAt, 3 * 3600);
    const refunded: PaymentEvent = { id: uid("evt"), paymentId: second.payment.id, source: "razorpay", type: "payment.refunded", occurredAt: refundAt, metadata: { amount: product.price, initiatedBy: "LearnLoop finance" } };
    paymentEvents.push(refunded);
    second.payment.status = "refunded";
    second.order.status = "fulfilled";
    audit({ occurredAt: addSeconds(refundAt, 20), actor: ACTORS.connector, action: "Reported refund", targetType: "case", targetId: c.id, caseId: c.id, result: `Second charge ${second.payment.id} refunded by LearnLoop finance`, evidenceIds: [refunded.id], approvalSource: "not_required" });
  }

  // =========================================================================
  // TODAY: active incident INC-0017
  // =========================================================================
  const D = 0;
  const deploy = observability({
    type: "deploy.completed",
    service: "enrolment-service",
    occurredAt: at(D, "14:04:00"),
    metadata: { version: "v2.3", environment: "production", deployedBy: "ci-pipeline", commit: "8f3c2a1" },
  });
  const firstFailureAt = at(D, "14:05:21");
  const enrolErrors = observability({
    type: "service.errors_detected",
    service: "enrolment-service",
    occurredAt: firstFailureAt,
    metadata: { endpoint: "/enroll", statusCode: 500, errorRate: "100%", message: "TypeError: Cannot read properties of undefined (reading 'cohortId')" },
  });
  const enrolRecovered = observability({
    type: "service.recovered",
    service: "enrolment-service",
    occurredAt: at(D, "14:18:40"),
    metadata: { endpoint: "/enroll", healthCheck: "passing", consecutiveSuccesses: 20 },
  });

  // Healthy course purchases just before the deploy and just after recovery.
  const healthySample = (time: string) =>
    buildChain({ customer: newCustomer(), product: rng.pick(courseProducts), orderCreatedAt: at(D, time), outcome: { kind: "confirmed", afterSeconds: rng.int(4, 9) } });
  for (const time of ["13:41:18", "13:47:55", "13:52:30", "13:58:12", "14:02:44", "14:03:51"]) healthySample(time);
  const postRecovery = ["14:19:02", "14:20:37", "14:21:15", "14:22:48", "14:23:05"].map(healthySample);

  // 38 safe cases, 3 duplicates (original payments), 2 high-value bundles.
  const safePrices = [...Array(2).fill(999), ...Array(6).fill(2499), ...Array(10).fill(3499), ...Array(20).fill(4999)] as number[];
  type Slot = { group: "safe" | "duplicate" | "high_value"; price: number };
  const slots: Slot[] = rng.shuffle<Slot>([
    ...safePrices.map((price) => ({ group: "safe" as const, price })),
    { group: "high_value", price: 9999 },
    { group: "high_value", price: 9999 },
  ]);
  // Duplicates happen early so the customer's retry also lands inside the outage.
  slots.splice(4, 0, { group: "duplicate", price: 3499 });
  slots.splice(9, 0, { group: "duplicate", price: 3499 });
  slots.splice(15, 0, { group: "duplicate", price: 3499 });
  // The case used as the reference timeline (order created 14:07:02) is a ₹2,499 purchase.
  const referenceIndex = slots.findIndex((s, i) => i >= 6 && s.group === "safe" && s.price === 2499);
  const [referenceSlot] = slots.splice(referenceIndex, 1);
  slots.splice(6, 0, referenceSlot!);

  const productFor = (slot: Slot): Product => {
    const options = PRODUCTS.filter((p) => p.contractId === CONTRACT_IDS.course && p.price === slot.price);
    return rng.pick(options);
  };
  const start = Date.parse(at(D, "14:05:13"));
  const end = Date.parse(at(D, "14:18:18"));
  const step = (end - start) / (slots.length - 1);
  const incidentId = "INC-0017";
  const incidentCases: IntegrityCase[] = [];
  const duplicateSeconds: Chain[] = [];

  slots.forEach((slot, index) => {
    const orderCreatedAt =
      index === 6 ? at(D, "14:07:02") : new Date(Math.round((start + step * index) / 1000) * 1000 + rng.int(-4, 4) * 1000).toISOString();
    const product = productFor(slot);
    const customer = newCustomer();
    const chain = buildChain({ customer, product, orderCreatedAt, outcome: { kind: "failed", afterSeconds: 2, responseCode: 500 } });
    const detectedAt = addSeconds(chain.receipt!.expectedBy, 1);
    const baseEvidence = missingOutcomeEvidence(chain, [deploy.id, enrolErrors.id, enrolRecovered.id]);

    if (slot.group === "duplicate") {
      const second = buildChain({
        customer,
        product,
        orderCreatedAt: addSeconds(orderCreatedAt, 4 * 60 + rng.int(5, 40)),
        outcome: { kind: "failed", afterSeconds: 2, responseCode: 500 },
      });
      outcomeReceipts.splice(outcomeReceipts.indexOf(second.receipt!), 1);
      second.receipt = undefined;
      duplicateSeconds.push(second);
      const minutesApart = Math.round((Date.parse(second.captured!.occurredAt) - Date.parse(chain.captured!.occurredAt)) / 60000);
      const investigation: Investigation = {
        summary: `Customer paid twice for ${product.name}, ${minutesApart} minutes apart. Both order.paid webhooks returned HTTP 200, but both /enroll calls returned HTTP 500, so neither payment produced access.`,
        likelyCause: "LearnLoop enrolment service returned HTTP 500 after deployment v2.3; the customer retried checkout when access did not appear.",
        evidenceIds: [...baseEvidence, second.captured!.id, second.outcomeEvents.find((e) => e.status === "failed")!.id],
        uncertainties: ["Whether the second payment was intentional or a retry after access did not appear."],
        hypotheses: [
          hyp("order.paid not delivered to LearnLoop", "ruled_out", [delivered(chain), delivered(second)], "Both order.paid webhooks returned HTTP 200."),
          hyp("Enrolment service failing after deployment v2.3", "supported", [deploy.id, enrolErrors.id, failedOutcome(chain), failedOutcome(second)], "Both /enroll calls returned HTTP 500 during the outage that began after deploy.completed v2.3."),
          hyp("Customer paid twice for one purchase", "supported", [chain.captured!.id, second.captured!.id], "Two captured payments from the same customer for the same course, minutes apart."),
        ],
        recommendedAction: "retry_provisioning",
        confidence: 0.9,
        customerImpact: `Customer was charged ${formatINR(product.price * 2)} for one ${formatINR(product.price)} course and has no access.`,
        consequenceOfInaction: "Customer remains double-charged without access; a refund request or dispute is likely.",
        customerMessageDraft: `Your payment for ${product.name} was successful. We are restoring your course access, and we are reviewing your second payment of ${formatINR(product.price)}.`,
      };
      const detected = detectedAt > second.captured!.occurredAt ? detectedAt : addSeconds(second.captured!.occurredAt, 2);
      incidentCases.push(openCase({ type: "duplicate_payment", chain, related: [second], detectedAt: detected, status: "review_required", investigation, defaultOutcome: "customer_contact", incidentId }));
      return;
    }

    const highValue = slot.group === "high_value";
    const investigation: Investigation = {
      summary: `Payment captured and order.paid acknowledged with HTTP 200, but LearnLoop's /enroll call returned HTTP 500 and no course_access_granted arrived within 2 minutes. The enrolment service has since recovered and is accepting requests.`,
      likelyCause: "LearnLoop enrolment service returned HTTP 500 after deployment v2.3.",
      evidenceIds: baseEvidence,
      uncertainties: highValue ? [`${product.name} unlocks several courses; it is not confirmed whether a single enrolment grants access to all of them.`] : [],
      hypotheses: [
        hyp("order.paid not delivered to LearnLoop", "ruled_out", [delivered(chain)], "LearnLoop acknowledged order.paid with HTTP 200."),
        hyp("Enrolment service failing after deployment v2.3", "supported", [deploy.id, enrolErrors.id, failedOutcome(chain)], "/enroll returned HTTP 500 during the outage that began 81 seconds after deploy.completed v2.3."),
        hyp("Customer already has access from another payment", "ruled_out", [chain.receipt?.id], "No other captured payment or access grant exists for this order."),
        hyp("Enrolment service still unavailable", "ruled_out", [enrolRecovered.id], "Health checks have passed since the service recovered, so a retry can succeed."),
      ],
      recommendedAction: "retry_provisioning",
      confidence: highValue ? 0.96 : 0.97,
      customerImpact: `Customer paid ${formatINR(product.price)} for ${product.name} and does not have course access.`,
      consequenceOfInaction: "The customer is likely to contact LearnLoop support or raise a dispute while the payment stays captured without access.",
      customerMessageDraft: courseMessage(product),
    };
    incidentCases.push(openCase({ type: "missing_outcome", chain, detectedAt, status: "open", investigation, defaultOutcome: "customer_contact", incidentId }));
  });

  incidentCases.sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  const incidentDetectedAt = addSeconds(incidentCases[2]!.detectedAt, 3);
  for (const c of incidentCases) {
    integrity({ type: "case.clustered", caseId: c.id, incidentId, occurredAt: c.detectedAt > incidentDetectedAt ? addSeconds(c.detectedAt, 1) : incidentDetectedAt });
    recordPolicyEvaluation(
      c,
      addSeconds(c.detectedAt > incidentDetectedAt ? c.detectedAt : incidentDetectedAt, 6),
      c.detectedAt < enrolRecovered.occurredAt ? "blocked" : "requires_approval",
      c.detectedAt < enrolRecovered.occurredAt ? "Blocked: enrolment service unhealthy" : policySummaryForIncidentCase(c),
    );
  }
  for (const c of incidentCases.filter((x) => x.detectedAt < enrolRecovered.occurredAt)) {
    recordPolicyEvaluation(c, addSeconds(enrolRecovered.occurredAt, 5), "requires_approval", policySummaryForIncidentCase(c));
  }

  const incidentInvestigation: Investigation = {
    summary: "Payments continued succeeding, but LearnLoop's enrolment service stopped producing access confirmations after deployment v2.3.",
    likelyCause: "Deployment v2.3 of LearnLoop's enrolment service: /enroll returned HTTP 500 from 81 seconds after deploy.completed until the service recovered.",
    evidenceIds: [
      deploy.id,
      enrolErrors.id,
      enrolRecovered.id,
      ...incidentCases.slice(0, 3).flatMap((c) => c.investigation!.evidenceIds.slice(0, 4)),
      ...incidentCases.slice(0, 3).map((c) => c.id),
      postRecovery[0]!.outcomeEvents.find((e) => e.type === "course_access_granted")!.id,
    ],
    uncertainties: [
      "Whether duplicate payments were intentional.",
      "Whether high-value bundles require different access.",
    ],
    hypotheses: [
      hyp("Deployment v2.3 broke enrolment", "supported", [deploy.id, enrolErrors.id, enrolRecovered.id], "/enroll began returning HTTP 500 81 seconds after deploy.completed v2.3 and every enrolment failed until the service recovered."),
      hyp("Razorpay webhooks not reaching LearnLoop", "ruled_out", incidentCases.slice(0, 3).map((c) => c.investigation!.evidenceIds[1]), "order.paid deliveries returned HTTP 200 throughout the incident."),
      hyp("Payments not captured", "ruled_out", incidentCases.slice(0, 3).map((c) => c.investigation!.evidenceIds[0]), "Every affected payment was captured by Razorpay."),
      hyp("Enrolment still failing now", "ruled_out", [enrolRecovered.id, postRecovery[0]!.outcomeEvents.find((e) => e.type === "course_access_granted")!.id], "New purchases after the recovery received access normally."),
    ],
    recommendedAction: "retry_provisioning",
    confidence: 0.93,
    customerImpact: "43 customers paid and do not have course access.",
    consequenceOfInaction: "Customers contact support or raise disputes; payments stay captured without access.",
  };
  investigationResponses[incidentId] = incidentInvestigation;
  incidents.push({
    id: incidentId,
    title: "Course access not granted after successful payment",
    status: "action_required",
    severity: "high",
    caseIds: incidentCases.map((c) => c.id),
    startedAt: firstFailureAt,
    detectedAt: incidentDetectedAt,
    likelyCause: "Enrolment service returned HTTP 500 after deployment v2.3",
    outcomeContractId: CONTRACT_IDS.course,
    owner: OPERATOR.name,
    affectedService: "enrolment-service",
    summary: incidentInvestigation.summary,
    investigation: incidentInvestigation,
  });
  integrity({ type: "incident.created", incidentId, occurredAt: incidentDetectedAt });
  audit({ occurredAt: incidentDetectedAt, actor: ACTORS.agent, action: "Created incident", targetType: "incident", targetId: incidentId, incidentId, result: "3 Course purchase cases share one failure signature", evidenceIds: incidentCases.slice(0, 3).map((c) => c.id), approvalSource: "not_required" });

  // Incident history snapshots, computed from the cases known at each moment.
  const snapshot = (occurredAt: string, systemHealth: IncidentUpdate["systemHealth"], note: string, rootCauseConfidence?: number) => {
    const known = incidentCases.filter((c) => c.detectedAt <= occurredAt);
    const update: IncidentUpdate = {
      id: uid("inu", 10),
      incidentId,
      occurredAt,
      caseCount: known.length,
      exposure: known.reduce((total, c) => total + c.amountAtRisk, 0),
      systemHealth,
      note,
    };
    if (rootCauseConfidence !== undefined) update.rootCauseConfidence = rootCauseConfidence;
    incidentUpdates.push(update);
  };
  snapshot(incidentDetectedAt, "down", "Incident opened: order.paid acknowledged, /enroll returned HTTP 500, no access confirmation.", 0.58);
  snapshot(addSeconds(incidentDetectedAt, 75), "down", "Failures began 81 seconds after deploy.completed for enrolment-service v2.3.", 0.86);
  for (const time of ["14:12:00", "14:15:00", "14:18:00"]) snapshot(at(D, time), "down", "Case count updated.");
  snapshot(enrolRecovered.occurredAt, "healthy", "Enrolment service health checks passing; recovery is now possible.", 0.9);
  snapshot(addSeconds(incidentCases.at(-1)!.detectedAt, 1), "healthy", "Final affected purchase added. No failures after recovery.", 0.93);
  snapshot(addSeconds(postRecovery[2]!.receipt!.confirmedAt!, 1), "healthy", "New purchases receiving course access within normal time.", 0.93);

  // =========================================================================
  // TODAY: refusal case (event booking with changed inventory)
  // =========================================================================
  {
    const product = productById("prd_system_design_workshop");
    const chain = buildChain({ customer: newCustomer(), product, orderCreatedAt: at(D, "12:51:40"), outcome: { kind: "none" } });
    const inventoryChanged: MerchantOutcomeEvent = {
      id: uid("ll_evt", 12),
      merchantOrderId: chain.order.id,
      source: "learnloop",
      type: "inventory_changed",
      status: "completed",
      occurredAt: addSeconds(chain.captured!.occurredAt, 17),
      metadata: { heldSeat: "B-14", change: "Venue capacity reduced from 60 to 40; seat block B released", replacementAvailable: null },
    };
    const bookingFailed: MerchantOutcomeEvent = {
      id: uid("ll_evt", 12),
      merchantOrderId: chain.order.id,
      source: "learnloop",
      type: "booking.failed",
      status: "failed",
      responseCode: 409,
      occurredAt: addSeconds(inventoryChanged.occurredAt, 1),
      metadata: { endpoint: "/enroll", message: "Seat B-14 no longer exists" },
    };
    outcomeEvents.push(inventoryChanged, bookingFailed);
    chain.outcomeEvents.push(inventoryChanged, bookingFailed);
    chain.order.status = "fulfilment_failed";
    const detectedAt = addSeconds(bookingFailed.occurredAt, 2);
    const investigation: Investigation = {
      summary: "Payment captured for seat B-14, but the workshop's seat inventory changed 17 seconds later and the booking returned HTTP 409.",
      likelyCause: "Seat inventory changed after payment: capacity reduced from 60 to 40 and seat block B released.",
      evidenceIds: [chain.captured!.id, chain.deliveries.at(-1)!.id, inventoryChanged.id, bookingFailed.id, chain.receipt!.id],
      uncertainties: ["Whether a valid replacement seat exists in the reduced layout.", "Whether the customer would accept a different seat."],
      hypotheses: [
        hyp("Seat inventory changed after payment", "supported", [inventoryChanged.id, bookingFailed.id], "Seat block B was released 17 seconds after capture; the booking then returned HTTP 409 for the missing seat."),
        hyp("Booking service outage", "ruled_out", [bookingFailed.id], "The booking was rejected with HTTP 409 (conflict), not a server error."),
        hyp("order.paid not delivered to LearnLoop", "ruled_out", [chain.deliveries.at(-1)!.id], "LearnLoop acknowledged order.paid with HTTP 200."),
      ],
      recommendedAction: "escalate",
      confidence: 0.91,
      customerImpact: `Customer paid ${formatINR(product.price)} for a workshop seat that no longer exists.`,
      consequenceOfInaction: "The customer has paid without a confirmed seat; completing the original booking could overbook the workshop.",
    };
    const c = openCase({ type: "inventory_conflict", chain, detectedAt, status: "review_required", investigation, defaultOutcome: "customer_contact", missedDeadline: false });
    recordPolicyEvaluation(c, addSeconds(detectedAt, 5), "blocked", "Blocked: inventory changed after payment; no valid replacement confirmed");
  }

  // =========================================================================
  // TODAY: late authorisation approaching its capture deadline
  // =========================================================================
  {
    const product = productById("prd_ml_python");
    const orderAt = at(D, "13:31:10");
    const chain = buildChain({ customer: newCustomer(), product, orderCreatedAt: orderAt, authorizeAfter: 17 * 60 + 42, capture: false, outcome: { kind: "none" }, orderStatus: "expired" });
    const authorizedAt = chain.authorized!.occurredAt;
    chain.payment.captureDeadline = captureDeadlineFor(chain.payment);
    const investigation: Investigation = {
      summary: "The bank authorised the payment 17 minutes after checkout started, after the LearnLoop order had expired. It was not captured and will be refunded automatically if not captured by the deadline.",
      likelyCause: "Late bank authorisation after the checkout session expired.",
      evidenceIds: [chain.orderCreated.id, chain.authorized!.id],
      uncertainties: ["Whether the customer still expects access after checkout timed out."],
      hypotheses: [
        hyp("Bank authorised after checkout expired", "supported", [chain.orderCreated.id, chain.authorized!.id], "Authorisation arrived 17 minutes after checkout started, after the LearnLoop order had expired."),
        hyp("Payment failed", "ruled_out", [chain.authorized!.id], "The bank authorised the payment; the money is held, not declined."),
        hyp("Customer bought the course again", "ruled_out", [chain.orderCreated.id], "No other payment from this customer for the course was found."),
      ],
      recommendedAction: "capture",
      confidence: 0.95,
      customerImpact: `Customer's ${formatINR(product.price)} is held by the bank and they do not have access.`,
      consequenceOfInaction: "The authorisation expires and the payment is refunded automatically; the sale is lost.",
      customerMessageDraft: `Your ${formatINR(product.price)} payment for ${product.name} was confirmed by your bank. Your course access is now being activated.`,
    };
    const c = openCase({ type: "late_authorization", chain, detectedAt: addSeconds(authorizedAt, 2), status: "open", investigation, defaultOutcome: "auto_refund", missedDeadline: false, deadline: chain.payment.captureDeadline });
    recordPolicyEvaluation(c, addSeconds(c.detectedAt, 5), "requires_approval", "Capture payment always requires approval");
  }

  // =========================================================================
  // TODAY: waiting case (membership activation 70 s, within learned range)
  // =========================================================================
  {
    const product = productById("prd_plus_membership");
    const chain = buildChain({ customer: newCustomer(), product, orderCreatedAt: at(D, "14:23:24"), outcome: { kind: "pending" } });
    const c = openCase({
      type: "delayed_processing",
      chain,
      detectedAt: addSeconds(chain.payment.capturedAt!, 70),
      status: "observing",
      defaultOutcome: "none",
      missedDeadline: false,
      observation: { observedDelaySeconds: 70, normalRangeSeconds: { p50: 18, p95: 96 } },
    });
    // What the investigator concludes if the activation never arrives and the
    // case becomes a missing outcome at the contract deadline.
    const pending = chain.outcomeEvents.find((e) => e.status === "pending")!;
    investigationResponses[c.id] = {
      summary: "Payment captured and order.paid acknowledged with HTTP 200. LearnLoop recorded the membership activation as pending, but no membership_activated arrived within the 5-minute contract deadline.",
      likelyCause: "Membership activation stalled inside LearnLoop after the order was accepted.",
      evidenceIds: [chain.captured!.id, delivered(chain)!, pending.id, chain.receipt!.id],
      uncertainties: ["membership-service logged no errors, so why the activation stalled is not confirmed."],
      hypotheses: [
        hyp("order.paid not delivered to LearnLoop", "ruled_out", [delivered(chain)], "LearnLoop acknowledged order.paid with HTTP 200."),
        hyp("Activation stalled after LearnLoop accepted the order", "supported", [pending.id], "LearnLoop recorded the activation as pending and never completed it."),
        hyp("Slow but normal processing", "ruled_out", [chain.receipt!.id], "The 5-minute deadline is well past this contract's 95th percentile of 96 s."),
      ],
      // LearnLoop still reports the activation as in progress, and Payment
      // Integrity cannot activate memberships, so the fix sits with LearnLoop.
      recommendedAction: "escalate",
      confidence: 0.9,
      customerImpact: `Customer paid ${formatINR(product.price)} for ${product.name} and the membership is not active.`,
      consequenceOfInaction: "The customer is likely to contact LearnLoop support or request a refund.",
      customerMessageDraft: `Your ${formatINR(product.price)} payment for ${product.name} was successful. We are activating your membership now, and you will not be charged again.`,
    } satisfies Investigation;
  }

  // =========================================================================
  // Configuration history in the audit log
  // =========================================================================
  audit({ occurredAt: at(40, "11:20:00"), actor: OPERATOR.name, action: "Created contract", targetType: "contract", targetId: CONTRACT_IDS.course, result: "Course purchase activated", approvalSource: "merchant" });
  audit({ occurredAt: at(40, "11:24:00"), actor: OPERATOR.name, action: "Created contract", targetType: "contract", targetId: CONTRACT_IDS.membership, result: "Membership activation activated", approvalSource: "merchant" });
  audit({ occurredAt: at(30, "15:10:00"), actor: OPERATOR.name, action: "Created contract", targetType: "contract", targetId: CONTRACT_IDS.event, result: "Event booking activated with inventory check", approvalSource: "merchant" });
  audit({ occurredAt: at(29, "09:45:00"), actor: OPERATOR.name, action: "Changed action policy", targetType: "policy", targetId: "retry_provisioning", result: "Retry provisioning: Suggest only → Automatic below thresholds", approvalSource: "merchant" });
  audit({ occurredAt: at(5, "10:05:00"), actor: OPERATOR.name, action: "Paused contract", targetType: "contract", targetId: CONTRACT_IDS.wallet, result: "Wallet credit purchase paused during wallet-service migration", approvalSource: "merchant" });
  audit({ occurredAt: at(3, "16:42:00"), actor: OPERATOR.name, action: "Created contract", targetType: "contract", targetId: CONTRACT_IDS.saas, result: "SaaS upgrade saved as draft", approvalSource: "merchant" });

  connectorLogs.push(
    { id: uid("log", 10), integrationId: "customer_comms", kind: "auth_error", occurredAt: at(9, "03:12:44"), detail: "Access token expired; refreshed automatically on the next attempt." },
    { id: uid("log", 10), integrationId: "learnloop_orders", kind: "schema_error", occurredAt: at(6, "21:37:09"), detail: "Field coupon_code returned as number; expected string. Record read with coupon_code ignored." },
    { id: uid("log", 10), integrationId: "learnloop_enrolment", kind: "timeout", occurredAt: at(18, "16:20:31"), detail: "Enrolment status read timed out after 10 s; retried successfully." },
  );

  // Records were appended per scenario; the audit log reads chronologically.
  auditEvents.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  // One affected customer has unsubscribed from email, so messaging has to respect opt-outs.
  const optedOut = cases.filter((c) => c.incidentId === "INC-0017" && c.type === "missing_outcome")[7]!;
  customers.find((c) => c.id === optedOut.customerId)!.emailOptOut = true;

  const dailyStats = buildDailyStats(rng, cases, payments, at);
  const allTimestamps = [
    ...paymentEvents.map((e) => e.occurredAt),
    ...outcomeEvents.map((e) => e.occurredAt),
    ...integrityEvents.map((e) => e.occurredAt),
    ...auditEvents.map((e) => e.occurredAt),
    ...webhookDeliveries.map((e) => e.occurredAt),
  ].sort();

  return {
    meta: { seed: FIXTURE_SEED, anchorDate: FIXTURE_ANCHOR_DATE, horizon: allTimestamps.at(-1)! },
    merchant: MERCHANT,
    operator: OPERATOR,
    customers,
    products: PRODUCTS,
    contracts,
    orders,
    payments,
    paymentEvents,
    webhookDeliveries,
    outcomeEvents,
    observabilityEvents,
    integrityEvents,
    outcomeReceipts,
    cases,
    incidents,
    incidentUpdates,
    executions,
    auditEvents,
    actionPolicies: buildActionPolicies(at),
    globalControls: buildGlobalControls(at),
    integrations: buildIntegrations(at),
    connectorLogs,
    dailyStats,
    scheduledPurchases: buildScheduledPurchases(rng),
    investigationResponses,
  };

  function policySummaryForIncidentCase(c: IntegrityCase): string {
    if (c.type === "duplicate_payment") return "Second captured payment found; individual review required";
    if (c.amountAtRisk > 5000) return "Amount above ₹5,000 automatic limit; individual approval required";
    return "All checks passed; retry provisioning is set to Suggest only";
  }
}

/**
 * Razorpay refunds authorised payments that are not captured within 3 days of
 * creation (https://razorpay.com/docs/payments/payments/capture-settings/).
 */
export const CAPTURE_WINDOW_SECONDS = 3 * 24 * 3600;

function captureDeadlineFor(payment: Payment): string {
  return addSeconds(payment.createdAt, CAPTURE_WINDOW_SECONDS);
}

function caseOpenedResult(type: CaseType): string {
  switch (type) {
    case "missing_outcome":
      return "Outcome deadline missed";
    case "duplicate_payment":
      return "Second captured payment for the same purchase";
    case "late_authorization":
      return "Payment authorised after order expiry";
    case "inventory_conflict":
      return "Inventory changed after payment";
    case "delayed_processing":
      return "Outcome slower than median; within learned normal range";
  }
}

/**
 * Twelve hours of healthy course purchases after the horizon, roughly one every
 * 30-70 seconds. They surface as the real clock passes each one.
 */
function buildScheduledPurchases(rng: ReturnType<typeof createRandom>) {
  const courses = PRODUCTS.filter((p) => p.contractId === CONTRACT_IDS.course);
  const purchases = [];
  let offset = 20;
  for (let i = 1; offset < 12 * 3600; i += 1) {
    const product = rng.pick(courses);
    purchases.push({
      id: `sched_${String(i).padStart(4, "0")}`,
      contractId: CONTRACT_IDS.course,
      productId: product.id,
      amount: product.price,
      offsetSeconds: offset,
      completionSeconds: rng.int(4, 11),
    });
    offset += rng.int(30, 70);
  }
  return purchases;
}

/**
 * Daily aggregates for healthy traffic. Case payments are counted inside
 * `paymentsCaptured` and excluded from `outcomesConfirmedOnTime`, so completion
 * rates reconcile with the case list.
 */
function buildDailyStats(
  rng: ReturnType<typeof createRandom>,
  cases: IntegrityCase[],
  payments: Payment[],
  at: (daysBefore: number, time: string) => string,
): DailyOutcomeStat[] {
  const stats: DailyOutcomeStat[] = [];
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const volumes: Record<string, { base: number; spread: number; prices: number[]; median: [number, number] }> = {
    [CONTRACT_IDS.course]: { base: 2050, spread: 260, prices: [999, 999, 2499, 2499, 3499, 3499, 4999, 4999, 9999], median: [7, 10] },
    [CONTRACT_IDS.membership]: { base: 74, spread: 14, prices: [4999], median: [14, 22] },
    [CONTRACT_IDS.event]: { base: 28, spread: 9, prices: [2499], median: [9, 14] },
    [CONTRACT_IDS.wallet]: { base: 180, spread: 35, prices: [999], median: [3, 5] },
  };
  for (let daysBefore = 28; daysBefore >= 0; daysBefore -= 1) {
    const date = istDate(at(daysBefore, "12:00:00"));
    const dayFraction = daysBefore === 0 ? 0.43 : 1;
    for (const [contractId, volume] of Object.entries(volumes)) {
      if (contractId === CONTRACT_IDS.wallet && daysBefore <= 5) continue;
      const caseCount = cases.filter(
        (c) =>
          c.outcomeContractId === contractId &&
          paymentById.get(c.paymentId)?.capturedAt !== undefined &&
          istDate(paymentById.get(c.paymentId)!.capturedAt!) === date,
      );
      const captured = Math.round((volume.base + rng.int(-volume.spread, volume.spread)) * dayFraction);
      let gmv = caseCount.reduce((total, c) => total + c.amountAtRisk, 0);
      for (let i = caseCount.length; i < captured; i += 1) gmv += volume.prices[i % volume.prices.length]!;
      const webhookFailures = rng.int(0, 3) + (daysBefore === 12 && contractId === CONTRACT_IDS.course ? 18 : 0);
      stats.push({
        date,
        contractId,
        paymentsCaptured: captured,
        gmv,
        outcomesConfirmedOnTime: captured - caseCount.length,
        caseIds: caseCount.map((c) => c.id),
        medianCompletionSeconds: rng.int(volume.median[0], volume.median[1]),
        webhookAttempts: captured + webhookFailures,
        webhookFailures,
        medianEventLatencyMs: rng.int(380, 620),
      });
    }
  }
  return stats;
}
