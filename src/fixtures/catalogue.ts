import type {
  ActionPolicy,
  GlobalControls,
  Integration,
  Merchant,
  OperatorUser,
  OutcomeContract,
  Product,
} from "@/domain/types";

export const WEBHOOK_ENDPOINT = "https://api.learnloop.in/webhooks/razorpay";

export const MERCHANT: Merchant = {
  id: "mer_LearnLoop01",
  name: "LearnLoop",
  industry: "Edtech",
  environment: "live",
  timezone: "Asia/Kolkata",
  currency: "INR",
};

export const OPERATOR: OperatorUser = {
  id: "usr_priya",
  name: "Priya Sharma",
  role: "Payments Operations Manager",
};

export const CONTRACT_IDS = {
  course: "ctr_course_purchase",
  saas: "ctr_saas_upgrade",
  wallet: "ctr_wallet_credit",
  membership: "ctr_membership_activation",
  event: "ctr_event_booking",
} as const;

export const PRODUCTS: Product[] = [
  { id: "prd_excel_analysts", name: "Excel for Analysts", kind: "course", price: 999, contractId: CONTRACT_IDS.course },
  { id: "prd_python_foundations", name: "Python Foundations", kind: "course", price: 999, contractId: CONTRACT_IDS.course },
  { id: "prd_sql_analysis", name: "SQL for Data Analysis", kind: "course", price: 2499, contractId: CONTRACT_IDS.course },
  { id: "prd_ui_design", name: "UI Design Essentials", kind: "course", price: 2499, contractId: CONTRACT_IDS.course },
  { id: "prd_fullstack_js", name: "Full-Stack JavaScript", kind: "course", price: 3499, contractId: CONTRACT_IDS.course },
  { id: "prd_pm_fundamentals", name: "Product Management Fundamentals", kind: "course", price: 3499, contractId: CONTRACT_IDS.course },
  { id: "prd_ml_python", name: "Machine Learning with Python", kind: "course", price: 4999, contractId: CONTRACT_IDS.course },
  { id: "prd_dsa_intensive", name: "Data Structures and Algorithms Intensive", kind: "course", price: 4999, contractId: CONTRACT_IDS.course },
  { id: "prd_ds_career_bundle", name: "Data Science Career Bundle", kind: "bundle", price: 9999, contractId: CONTRACT_IDS.course },
  { id: "prd_system_design_workshop", name: "System Design Live Workshop, Bengaluru", kind: "event_seat", price: 2499, contractId: CONTRACT_IDS.event },
  { id: "prd_plus_membership", name: "LearnLoop Plus annual membership", kind: "membership", price: 4999, contractId: CONTRACT_IDS.membership },
  { id: "prd_practice_credits", name: "Practice credits, 500 pack", kind: "credits", price: 999, contractId: CONTRACT_IDS.wallet },
  { id: "prd_teams_upgrade", name: "LearnLoop Teams upgrade, 25 seats", kind: "plan_upgrade", price: 9999, contractId: CONTRACT_IDS.saas },
];

export function productById(id: string): Product {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`Unknown product ${id}`);
  return product;
}

export function buildContracts(at: (daysBeforeAnchor: number, time: string) => string): OutcomeContract[] {
  return [
    {
      id: CONTRACT_IDS.course,
      name: "Course purchase",
      paymentType: "Course and bundle purchases",
      expectedOutcome: "course_access_granted",
      matchingKey: "merchant_order_id",
      deadlineSeconds: 120,
      safeRecoveryAction: "retry_provisioning",
      maxAutomaticValue: 5000,
      minimumConfidence: 0.95,
      status: "active",
      productScope: PRODUCTS.filter((p) => p.contractId === CONTRACT_IDS.course).map((p) => p.id),
      fulfilmentService: "enrolment-service",
      verificationMethod: "course_access_granted event from LearnLoop Enrolment API matched on merchant_order_id",
      alwaysReviewCaseTypes: ["duplicate_payment"],
      requiresInventoryCheck: false,
      customerNotificationTemplate:
        "Your payment for {product} was successful. We are restoring your course access and you will not be charged again.",
      updatedAt: at(40, "11:20:00"),
    },
    {
      id: CONTRACT_IDS.saas,
      name: "SaaS upgrade",
      paymentType: "Team plan upgrades",
      expectedOutcome: "plan_upgraded",
      matchingKey: "merchant_order_id",
      deadlineSeconds: 300,
      safeRecoveryAction: "retry_provisioning",
      maxAutomaticValue: 10000,
      minimumConfidence: 0.95,
      status: "draft",
      productScope: ["prd_teams_upgrade"],
      fulfilmentService: "billing-service",
      verificationMethod: "plan_upgraded event from LearnLoop billing matched on merchant_order_id",
      alwaysReviewCaseTypes: ["duplicate_payment"],
      requiresInventoryCheck: false,
      customerNotificationTemplate:
        "Your payment for {product} was successful. Your team plan upgrade is being completed.",
      updatedAt: at(3, "16:42:00"),
    },
    {
      id: CONTRACT_IDS.wallet,
      name: "Wallet credit purchase",
      paymentType: "Practice credit packs",
      expectedOutcome: "wallet_credited",
      matchingKey: "merchant_order_id",
      deadlineSeconds: 60,
      safeRecoveryAction: "retry_provisioning",
      maxAutomaticValue: 1000,
      minimumConfidence: 0.95,
      status: "paused",
      productScope: ["prd_practice_credits"],
      fulfilmentService: "wallet-service",
      verificationMethod: "wallet_credited event matched on merchant_order_id",
      alwaysReviewCaseTypes: ["duplicate_payment"],
      requiresInventoryCheck: false,
      customerNotificationTemplate:
        "Your payment for {product} was successful. Your credits are being added to your wallet.",
      updatedAt: at(5, "10:05:00"),
    },
    {
      id: CONTRACT_IDS.membership,
      name: "Membership activation",
      paymentType: "LearnLoop Plus memberships",
      expectedOutcome: "membership_activated",
      matchingKey: "merchant_order_id",
      deadlineSeconds: 300,
      safeRecoveryAction: "retry_provisioning",
      maxAutomaticValue: 5000,
      minimumConfidence: 0.95,
      status: "active",
      productScope: ["prd_plus_membership"],
      fulfilmentService: "membership-service",
      verificationMethod: "membership_activated event matched on merchant_order_id",
      alwaysReviewCaseTypes: ["duplicate_payment"],
      requiresInventoryCheck: false,
      customerNotificationTemplate:
        "Your payment for {product} was successful. Your membership is being activated.",
      updatedAt: at(40, "11:24:00"),
    },
    {
      id: CONTRACT_IDS.event,
      name: "Event booking",
      paymentType: "Live workshop seats",
      expectedOutcome: "booking_confirmed",
      matchingKey: "merchant_order_id",
      deadlineSeconds: 300,
      safeRecoveryAction: "retry_provisioning",
      maxAutomaticValue: 3000,
      minimumConfidence: 0.95,
      status: "active",
      productScope: ["prd_system_design_workshop"],
      fulfilmentService: "booking-service",
      verificationMethod: "booking_confirmed event with the original seat, matched on merchant_order_id",
      alwaysReviewCaseTypes: ["duplicate_payment", "inventory_conflict"],
      requiresInventoryCheck: true,
      customerNotificationTemplate:
        "Your payment for {product} was successful. We are confirming your seat and will update you shortly.",
      updatedAt: at(30, "15:10:00"),
    },
  ];
}

export function buildActionPolicies(at: (daysBeforeAnchor: number, time: string) => string): ActionPolicy[] {
  const setup = at(40, "11:30:00");
  return [
    { action: "retry_provisioning", mode: "suggest_only", updatedAt: at(14, "10:12:00"), updatedBy: OPERATOR.name },
    { action: "replay_webhook", mode: "suggest_only", updatedAt: setup, updatedBy: OPERATOR.name },
    { action: "capture_payment", mode: "always_require_approval", updatedAt: setup, updatedBy: OPERATOR.name },
    { action: "prepare_refund", mode: "suggest_only", updatedAt: setup, updatedBy: OPERATOR.name },
    { action: "issue_refund", mode: "always_require_approval", updatedAt: setup, updatedBy: OPERATOR.name },
    { action: "notify_customer", mode: "always_require_approval", updatedAt: setup, updatedBy: OPERATOR.name },
    { action: "escalate", mode: "automatic_below_threshold", updatedAt: setup, updatedBy: OPERATOR.name },
  ];
}

export function buildGlobalControls(at: (daysBeforeAnchor: number, time: string) => string): GlobalControls {
  return {
    maxAutomaticValue: 5000,
    dailyRefundLimit: 25000,
    minimumConfidence: 0.95,
    neverActAfterInventoryChange: true,
    neverActOnLowConfidenceMatch: true,
    requireApprovalForCustomerCommunication: true,
    automationPaused: false,
    updatedAt: at(40, "11:30:00"),
  };
}

export function buildIntegrations(at: (daysBeforeAnchor: number, time: string) => string): Integration[] {
  return [
    {
      id: "razorpay_payments",
      name: "Razorpay Payments",
      purpose: "Payment, order and webhook events for LearnLoop's live account",
      status: "connected",
      access: "scoped_write",
      scopes: {
        read: ["payment_status", "order_status", "webhook_deliveries"],
        write: ["capture_payment", "replay_webhook"],
        notGranted: ["issue_refund"],
      },
      dataAccessed: ["Payments", "Orders", "Webhook deliveries", "Refund status"],
      connectedAt: at(41, "10:02:00"),
    },
    {
      id: "learnloop_orders",
      name: "LearnLoop Orders API",
      purpose: "Merchant order records used to match payments to purchases",
      status: "connected",
      access: "read_only",
      scopes: { read: ["order_status"], write: [], notGranted: ["delete_order", "change_product"] },
      dataAccessed: ["Order status", "Product purchased", "Customer reference"],
      connectedAt: at(41, "10:15:00"),
    },
    {
      id: "learnloop_enrolment",
      name: "LearnLoop Enrolment API",
      purpose: "Course access and workshop seat status; the only fulfilment action granted",
      status: "connected",
      access: "scoped_write",
      scopes: {
        read: ["course_access_status"],
        write: ["grant_course_access"],
        notGranted: ["edit_customer", "change_product", "delete_order"],
      },
      dataAccessed: ["Course access status", "Enrolment responses", "Seat inventory"],
      connectedAt: at(41, "10:21:00"),
    },
    {
      id: "customer_comms",
      name: "Customer communications",
      purpose: "Email updates to affected customers",
      status: "connected",
      access: "scoped_write",
      scopes: { read: ["message_status"], write: ["send_customer_message"], notGranted: ["edit_customer"] },
      dataAccessed: ["Customer email", "Customer phone", "Message delivery status"],
      connectedAt: at(38, "12:40:00"),
    },
    {
      id: "incident_management",
      name: "Slack incident management",
      purpose: "Engineering incidents and escalations in #payments-ops",
      status: "connected",
      access: "scoped_write",
      scopes: { read: ["channel_membership"], write: ["create_incident", "post_message"], notGranted: [] },
      dataAccessed: ["Incident channel", "Escalation threads"],
      connectedAt: at(38, "12:55:00"),
    },
    {
      id: "learnloop_observability",
      name: "LearnLoop Observability",
      purpose: "Deploy events and service error logs used as incident evidence",
      status: "connected",
      access: "read_only",
      scopes: { read: ["deploy_events", "service_error_logs"], write: [], notGranted: [] },
      dataAccessed: ["Deploy events", "Service error logs", "Health checks"],
      connectedAt: at(20, "17:30:00"),
    },
  ];
}
