import type {
  ActionMode,
  ActionPolicy,
  AuditEvent,
  ConnectorLog,
  Customer,
  DailyOutcomeStat,
  Execution,
  GlobalControls,
  IncidentRecord,
  IncidentUpdate,
  IntegrityCase,
  IntegrityEvent,
  Integration,
  IntegrationId,
  MerchantOrder,
  MerchantOutcomeEvent,
  ObservabilityEvent,
  OutcomeContract,
  OutcomeReceipt,
  Payment,
  PaymentEvent,
  PolicyAction,
  Product,
  SystemFlags,
  WebhookDelivery,
} from "@/domain/types";
import type { DataStore } from "./store";

/**
 * Repository interfaces. The fixture-backed implementations below read and
 * write the in-memory DataStore; a production build would implement the same
 * interfaces over Razorpay and merchant APIs.
 */
export type PaymentsRepository = {
  get(id: string): Payment | undefined;
  list(): ReadonlyArray<Payment>;
  save(payment: Payment): void;
  events(paymentId: string): PaymentEvent[];
  appendEvent(event: PaymentEvent): void;
  deliveriesForEvent(eventId: string): WebhookDelivery[];
  deliveriesForPayment(paymentId: string): WebhookDelivery[];
  appendDelivery(delivery: WebhookDelivery): void;
  customer(id: string): Customer | undefined;
  customers(): ReadonlyArray<Customer>;
  order(merchantOrderId: string): MerchantOrder | undefined;
  saveOrder(order: MerchantOrder): void;
  product(id: string): Product | undefined;
};

export type OutcomesRepository = {
  events(merchantOrderId: string): MerchantOutcomeEvent[];
  appendEvent(event: MerchantOutcomeEvent): void;
  receiptForPayment(paymentId: string): OutcomeReceipt | undefined;
  receipt(id: string): OutcomeReceipt | undefined;
  saveReceipt(receipt: OutcomeReceipt): void;
  observability(service?: string): ObservabilityEvent[];
  integrityEvents(filter: { caseId?: string; incidentId?: string }): IntegrityEvent[];
  appendIntegrityEvent(event: IntegrityEvent): void;
};

export type CasesRepository = {
  get(id: string): IntegrityCase | undefined;
  list(): ReadonlyArray<IntegrityCase>;
  forIncident(incidentId: string): IntegrityCase[];
  /** Saves a new version of a case, incrementing `version`. */
  save(next: IntegrityCase): IntegrityCase;
};

export type IncidentsRepository = {
  get(id: string): IncidentRecord | undefined;
  list(): ReadonlyArray<IncidentRecord>;
  save(incident: IncidentRecord): void;
  updates(incidentId: string): IncidentUpdate[];
  appendUpdate(update: IncidentUpdate): void;
};

export type ExecutionsRepository = {
  get(id: string): Execution | undefined;
  forCase(caseId: string): Execution[];
  withKey(idempotencyKey: string): Execution[];
  list(): ReadonlyArray<Execution>;
  save(execution: Execution): void;
};

/** Audit events are append-only. There is deliberately no update or delete. */
export type AuditRepository = {
  list(): ReadonlyArray<AuditEvent>;
  forCase(caseId: string): AuditEvent[];
  forIncident(incidentId: string): AuditEvent[];
  append(event: AuditEvent): void;
};

export type ConfigRepository = {
  contracts(): ReadonlyArray<OutcomeContract>;
  contract(id: string): OutcomeContract | undefined;
  saveContract(contract: OutcomeContract): void;
  actionPolicies(): ReadonlyArray<ActionPolicy>;
  actionModes(): Record<PolicyAction, ActionMode>;
  saveActionPolicy(policy: ActionPolicy): void;
  globalControls(): GlobalControls;
  saveGlobalControls(controls: GlobalControls): void;
  integrations(): ReadonlyArray<Integration>;
  integration(id: IntegrationId): Integration | undefined;
  saveIntegration(integration: Integration): void;
  connectorLogs(): ReadonlyArray<ConnectorLog>;
  dailyStats(): ReadonlyArray<DailyOutcomeStat>;
  flags(): SystemFlags;
  saveFlags(flags: SystemFlags): void;
};

export type Repositories = {
  payments: PaymentsRepository;
  outcomes: OutcomesRepository;
  cases: CasesRepository;
  incidents: IncidentsRepository;
  executions: ExecutionsRepository;
  audit: AuditRepository;
  config: ConfigRepository;
  nextId(prefix: string): string;
};

const byTime = <T extends { occurredAt: string }>(a: T, b: T) => a.occurredAt.localeCompare(b.occurredAt);

export function createRepositories(store: DataStore): Repositories {
  return {
    nextId: (prefix) => store.nextId(prefix),
    payments: {
      get: (id) => store.get("payments", id),
      list: () => store.list("payments"),
      save: (payment) => store.put("payments", payment),
      events: (paymentId) => store.list("paymentEvents").filter((e) => e.paymentId === paymentId).sort(byTime),
      appendEvent: (event) => store.put("paymentEvents", event),
      deliveriesForEvent: (eventId) => store.list("webhookDeliveries").filter((d) => d.eventId === eventId).sort(byTime),
      deliveriesForPayment: (paymentId) => {
        const eventIds = new Set(store.list("paymentEvents").filter((e) => e.paymentId === paymentId).map((e) => e.id));
        return store.list("webhookDeliveries").filter((d) => eventIds.has(d.eventId)).sort(byTime);
      },
      appendDelivery: (delivery) => store.put("webhookDeliveries", delivery),
      customer: (id) => store.get("customers", id),
      customers: () => store.list("customers"),
      order: (merchantOrderId) => store.get("orders", merchantOrderId),
      saveOrder: (order) => store.put("orders", order),
      product: (id) => store.get("products", id),
    },
    outcomes: {
      events: (merchantOrderId) => store.list("outcomeEvents").filter((e) => e.merchantOrderId === merchantOrderId).sort(byTime),
      appendEvent: (event) => store.put("outcomeEvents", event),
      receiptForPayment: (paymentId) => store.list("outcomeReceipts").find((r) => r.paymentId === paymentId),
      receipt: (id) => store.get("outcomeReceipts", id),
      saveReceipt: (receipt) => store.put("outcomeReceipts", receipt),
      observability: (service) =>
        store.list("observabilityEvents").filter((e) => service === undefined || e.service === service).sort(byTime),
      integrityEvents: ({ caseId, incidentId }) =>
        store
          .list("integrityEvents")
          .filter((e) => (caseId === undefined || e.caseId === caseId) && (incidentId === undefined || e.incidentId === incidentId))
          .sort(byTime),
      appendIntegrityEvent: (event) => store.put("integrityEvents", event),
    },
    cases: {
      get: (id) => store.get("cases", id),
      list: () => store.list("cases"),
      forIncident: (incidentId) => store.list("cases").filter((c) => c.incidentId === incidentId),
      save: (next) => {
        const current = store.get("cases", next.id);
        const saved = { ...next, version: (current?.version ?? 0) + 1 };
        store.put("cases", saved);
        return saved;
      },
    },
    incidents: {
      get: (id) => store.get("incidents", id),
      list: () => store.list("incidents"),
      save: (incident) => store.put("incidents", incident),
      updates: (incidentId) => store.list("incidentUpdates").filter((u) => u.incidentId === incidentId).sort(byTime),
      appendUpdate: (update) => store.put("incidentUpdates", update),
    },
    executions: {
      get: (id) => store.get("executions", id),
      forCase: (caseId) => store.list("executions").filter((e) => e.caseId === caseId),
      withKey: (key) => store.list("executions").filter((e) => e.idempotencyKey === key),
      list: () => store.list("executions"),
      save: (execution) => store.put("executions", execution),
    },
    audit: {
      list: () => store.list("auditEvents"),
      forCase: (caseId) => store.list("auditEvents").filter((e) => e.caseId === caseId),
      forIncident: (incidentId) => store.list("auditEvents").filter((e) => e.incidentId === incidentId),
      append: (event) => {
        if (store.get("auditEvents", event.id)) throw new Error(`Audit event ${event.id} already exists`);
        store.put("auditEvents", event);
      },
    },
    config: {
      contracts: () => store.list("contracts"),
      contract: (id) => store.get("contracts", id),
      saveContract: (contract) => store.put("contracts", contract),
      actionPolicies: () => store.list("actionPolicies"),
      actionModes: () =>
        Object.fromEntries(store.list("actionPolicies").map((p) => [p.action, p.mode])) as Record<PolicyAction, ActionMode>,
      saveActionPolicy: (policy) => store.put("actionPolicies", policy),
      globalControls: () => store.globalControls,
      saveGlobalControls: (controls) => store.setGlobalControls(controls),
      integrations: () => store.list("integrations"),
      integration: (id) => store.get("integrations", id),
      saveIntegration: (integration) => store.put("integrations", integration),
      connectorLogs: () => store.list("connectorLogs"),
      dailyStats: () => store.list("dailyStats"),
      flags: () => store.flags,
      saveFlags: (flags) => store.setFlags(flags),
    },
  };
}
