import type { Investigation } from "@/domain/types";
import type { Repositories } from "@/repositories";
import { requireContract } from "@/services/policy/currentState";
import { investigationSchema } from "./schema";

/** One evidence item as supplied to the investigator. Contains no customer PII. */
export type EvidenceItem = {
  id: string;
  source: "razorpay" | "learnloop" | "learnloop_observability" | "payment_integrity";
  type: string;
  occurredAt: string;
  detail?: Record<string, unknown>;
};

export type CaseInvestigationInput = {
  caseId: string;
  caseType: string;
  contract: { name: string; expectedOutcome: string; deadlineSeconds: number };
  payment: { id: string; amount: number; method: string; status: string };
  merchantOrderId: string;
  evidence: EvidenceItem[];
};

export type IncidentInvestigationInput = {
  incidentId: string;
  contract: { name: string; expectedOutcome: string; deadlineSeconds: number };
  caseIds: string[];
  evidence: EvidenceItem[];
};

/** The single AI boundary. Adapters return raw, unvalidated output. */
export type InvestigationAdapter = {
  investigateCase(input: CaseInvestigationInput): Promise<unknown>;
  investigateIncident(input: IncidentInvestigationInput): Promise<unknown>;
};

export type InvestigationResult =
  | { status: "valid"; investigation: Investigation; removedEvidenceIds: string[] }
  | { status: "invalid"; investigation: Investigation; issues: string[] }
  | { status: "unavailable"; investigation: Investigation };

export const INVESTIGATION_UNAVAILABLE = "Automated investigation unavailable. Deterministic detection remains active.";

/** Rule-based alert used when the investigator fails or returns unusable output. */
export function escalationFallback(summary: string): Investigation {
  return {
    summary,
    likelyCause: "Not determined. Deterministic detection flagged this payment.",
    evidenceIds: [],
    uncertainties: ["No automated investigation is available for this case."],
    recommendedAction: "escalate",
    confidence: 0,
    customerImpact: "The customer's payment may not have produced the promised outcome.",
    consequenceOfInaction: "The case stays unresolved until a person reviews it.",
  };
}

/**
 * Validates raw investigator output: schema and confidence range via Zod, then
 * removes any evidence ID not present in the supplied evidence. Output with no
 * supported evidence cannot justify an action and becomes an escalation.
 */
export function validateInvestigation(raw: unknown, allowedEvidenceIds: ReadonlySet<string>): InvestigationResult {
  const parsed = investigationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "invalid",
      investigation: escalationFallback("Automated investigation returned invalid output. Escalated for review."),
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`),
    };
  }
  const investigation = parsed.data as Investigation;
  const supported = investigation.evidenceIds.filter((id) => allowedEvidenceIds.has(id));
  const removedEvidenceIds = investigation.evidenceIds.filter((id) => !allowedEvidenceIds.has(id));
  if (supported.length === 0 && investigation.recommendedAction !== "escalate") {
    return {
      status: "invalid",
      investigation: escalationFallback("Automated investigation cited no verifiable evidence. Escalated for review."),
      issues: ["evidenceIds: no cited evidence exists in the supplied event set"],
    };
  }
  return { status: "valid", investigation: { ...investigation, evidenceIds: supported }, removedEvidenceIds };
}

async function run(call: () => Promise<unknown>, allowed: ReadonlySet<string>): Promise<InvestigationResult> {
  let raw: unknown;
  try {
    raw = await call();
  } catch {
    return { status: "unavailable", investigation: escalationFallback(INVESTIGATION_UNAVAILABLE) };
  }
  return validateInvestigation(raw, allowed);
}

export function investigateCase(adapter: InvestigationAdapter, input: CaseInvestigationInput): Promise<InvestigationResult> {
  return run(() => adapter.investigateCase(input), new Set(input.evidence.map((e) => e.id)));
}

export function investigateIncident(
  adapter: InvestigationAdapter,
  input: IncidentInvestigationInput,
): Promise<InvestigationResult> {
  return run(() => adapter.investigateIncident(input), new Set([...input.evidence.map((e) => e.id), ...input.caseIds]));
}

function caseEvidence(repos: Repositories, caseId: string): EvidenceItem[] {
  const c = repos.cases.get(caseId);
  if (!c) throw new Error(`Case ${caseId} not found`);
  const contract = requireContract(repos, c.outcomeContractId);
  const paymentIds = [c.paymentId, ...c.relatedPaymentIds];
  const items: EvidenceItem[] = [];
  for (const paymentId of paymentIds) {
    const payment = repos.payments.get(paymentId);
    if (!payment) continue;
    for (const e of repos.payments.events(paymentId)) {
      items.push({ id: e.id, source: "razorpay", type: e.type, occurredAt: e.occurredAt, ...(e.metadata ? { detail: e.metadata } : {}) });
    }
    for (const d of repos.payments.deliveriesForPayment(paymentId)) {
      items.push({ id: d.id, source: "razorpay", type: `webhook.${d.status}`, occurredAt: d.occurredAt, detail: { attempt: d.attempt, responseCode: d.responseCode } });
    }
    for (const e of repos.outcomes.events(payment.merchantOrderId)) {
      items.push({ id: e.id, source: "learnloop", type: e.type, occurredAt: e.occurredAt, detail: { status: e.status, responseCode: e.responseCode, ...e.metadata } });
    }
    const receipt = repos.outcomes.receiptForPayment(paymentId);
    if (receipt) {
      items.push({ id: receipt.id, source: "payment_integrity", type: `outcome_receipt.${receipt.status}`, occurredAt: receipt.expectedBy });
    }
  }
  // Service-level signals for the fulfilment service within 24 hours of detection.
  const windowStart = new Date(Date.parse(c.detectedAt) - 86_400_000).toISOString();
  for (const e of repos.outcomes.observability(contract.fulfilmentService)) {
    if (e.occurredAt >= windowStart) {
      items.push({ id: e.id, source: "learnloop_observability", type: e.type, occurredAt: e.occurredAt, ...(e.metadata ? { detail: e.metadata } : {}) });
    }
  }
  return items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/** Builds the minimal input for a case: payment and outcome evidence only, no customer details. */
export function buildCaseInvestigationInput(repos: Repositories, caseId: string): CaseInvestigationInput {
  const c = repos.cases.get(caseId);
  if (!c) throw new Error(`Case ${caseId} not found`);
  const payment = repos.payments.get(c.paymentId);
  if (!payment) throw new Error(`Payment ${c.paymentId} not found`);
  const contract = requireContract(repos, c.outcomeContractId);
  return {
    caseId,
    caseType: c.type,
    contract: { name: contract.name, expectedOutcome: contract.expectedOutcome, deadlineSeconds: contract.deadlineSeconds },
    payment: { id: payment.id, amount: payment.amount, method: payment.method, status: payment.status },
    merchantOrderId: payment.merchantOrderId,
    evidence: caseEvidence(repos, caseId),
  };
}

export function buildIncidentInvestigationInput(repos: Repositories, incidentId: string): IncidentInvestigationInput {
  const incident = repos.incidents.get(incidentId);
  if (!incident) throw new Error(`Incident ${incidentId} not found`);
  const contract = requireContract(repos, incident.outcomeContractId);
  const evidence = new Map<string, EvidenceItem>();
  for (const caseId of incident.caseIds) for (const item of caseEvidence(repos, caseId)) evidence.set(item.id, item);
  // Outcomes of healthy purchases after the incident started show whether the service recovered.
  const since = incident.startedAt;
  for (const order of repos.payments.list().filter((p) => p.capturedAt && p.capturedAt >= since)) {
    for (const e of repos.outcomes.events(order.merchantOrderId)) {
      if (e.type === contract.expectedOutcome && e.status === "completed") {
        evidence.set(e.id, { id: e.id, source: "learnloop", type: e.type, occurredAt: e.occurredAt });
      }
    }
  }
  return {
    incidentId,
    contract: { name: contract.name, expectedOutcome: contract.expectedOutcome, deadlineSeconds: contract.deadlineSeconds },
    caseIds: incident.caseIds,
    evidence: [...evidence.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  };
}
