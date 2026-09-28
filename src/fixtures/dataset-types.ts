import type {
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
  Merchant,
  MerchantOrder,
  MerchantOutcomeEvent,
  ObservabilityEvent,
  OperatorUser,
  OutcomeContract,
  OutcomeReceipt,
  Payment,
  PaymentEvent,
  Product,
  WebhookDelivery,
} from "@/domain/types";

export type DatasetMeta = {
  seed: number;
  /** IST date of the active incident in the committed fixture file. */
  anchorDate: string;
  /** Latest timestamp in the fixture set. Rebasing keeps this in the past. */
  horizon: string;
};

/** Everything the app knows at first load. Collections are keyed by `id`. */
export type Dataset = {
  meta: DatasetMeta;
  merchant: Merchant;
  operator: OperatorUser;
  customers: Customer[];
  products: Product[];
  contracts: OutcomeContract[];
  orders: MerchantOrder[];
  payments: Payment[];
  paymentEvents: PaymentEvent[];
  webhookDeliveries: WebhookDelivery[];
  outcomeEvents: MerchantOutcomeEvent[];
  observabilityEvents: ObservabilityEvent[];
  integrityEvents: IntegrityEvent[];
  outcomeReceipts: OutcomeReceipt[];
  cases: IntegrityCase[];
  incidents: IncidentRecord[];
  incidentUpdates: IncidentUpdate[];
  executions: Execution[];
  auditEvents: AuditEvent[];
  actionPolicies: ActionPolicy[];
  globalControls: GlobalControls;
  integrations: Integration[];
  connectorLogs: ConnectorLog[];
  dailyStats: DailyOutcomeStat[];
  /** Raw responses returned by the fixture investigation adapter, keyed by case or incident ID. */
  investigationResponses: Record<string, unknown>;
};
