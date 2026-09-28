import { maskEmail, maskPhone } from "@/domain/privacy";
import type { Repositories } from "@/repositories";

/** Roles allowed to see a customer's full email and phone in operations views. */
export const CONTACT_REVEAL_ROLES: ReadonlySet<string> = new Set(["Payments Operations Manager"]);

export class PrivacyError extends Error {}

export function maskedContact(repos: Repositories, customerId: string) {
  const customer = repos.payments.customer(customerId);
  return customer ? { email: maskEmail(customer.email), phone: maskPhone(customer.phone) } : { email: "•••", phone: "••••" };
}

/**
 * Returns a customer's full contact details for one case and records who
 * revealed them and why. Only roles in CONTACT_REVEAL_ROLES may reveal.
 */
export function revealCustomerContact(repos: Repositories, caseId: string, user: { name: string; role: string }, asOf: string) {
  if (!CONTACT_REVEAL_ROLES.has(user.role)) throw new PrivacyError(`${user.role} cannot view customer contact details.`);
  const c = repos.cases.get(caseId);
  if (!c) throw new PrivacyError(`Case ${caseId} not found`);
  const customer = repos.payments.customer(c.customerId);
  if (!customer) throw new PrivacyError("Customer not found");
  repos.audit.append({
    id: repos.nextId("aud"),
    occurredAt: asOf,
    actor: user.name,
    action: "Revealed customer contact",
    targetType: "case",
    targetId: caseId,
    caseId,
    ...(c.incidentId ? { incidentId: c.incidentId } : {}),
    result: "Email and phone shown in full",
    evidenceIds: [],
    approvalSource: "merchant",
  });
  return { email: customer.email, phone: customer.phone };
}
