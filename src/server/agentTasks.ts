import "server-only";
import {
  askAnswerSchema,
  askIncidentInputSchema,
  autonomyExplanationSchema,
  autonomyInputSchema,
  contractDraftInputSchema,
  contractDraftSchema,
  messageDraftInputSchema,
  messageDraftSchema,
  type AgentTask,
} from "@/services/agent/contracts";
import { investigationSchema } from "@/services/investigation/schema";
import { structuredCall } from "./claude";
import { z } from "zod/v4";

const PRODUCT_CONTEXT = `You work inside Payment Integrity, a Razorpay Agent Studio agent for the merchant LearnLoop (an Indian edtech company selling courses, workshop seats, memberships and credit packs in INR).
Payment Integrity checks that every captured payment produces the outcome it promised (for example course access), investigates when it does not, and proposes recovery.
You never execute anything. A deterministic policy engine and a person decide what runs.`;

const evidenceItemSchema = z.object({
  id: z.string(),
  source: z.string(),
  type: z.string(),
  occurredAt: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

const caseInputSchema = z.object({
  caseId: z.string(),
  caseType: z.string(),
  contract: z.object({ name: z.string(), expectedOutcome: z.string(), deadlineSeconds: z.number() }),
  payment: z.object({ id: z.string(), amount: z.number(), method: z.string(), status: z.string() }),
  merchantOrderId: z.string(),
  evidence: z.array(evidenceItemSchema).max(400),
});

const incidentInputSchema = z.object({
  incidentId: z.string(),
  contract: z.object({ name: z.string(), expectedOutcome: z.string(), deadlineSeconds: z.number() }),
  caseIds: z.array(z.string()),
  evidence: z.array(evidenceItemSchema).max(1500),
});

const INVESTIGATION_RULES = `Investigate using only the evidence supplied.
- Cite evidence by its exact id. Never invent ids; uncited claims are removed.
- Consider at least two candidate causes. For each, say whether the evidence supports it, rules it out, or is inconclusive, and cite the ids that decide it.
- recommendedAction: retry_provisioning only if the fulfilment failure has cleared; replay_webhook if the merchant never received order.paid; capture for an authorised but uncaptured payment; escalate when a person must decide (changed inventory, missing information, conflicting evidence).
- confidence is your probability (0 to 1) that likelyCause is correct.
- uncertainties: what the evidence cannot settle.
- customerMessageDraft: optional, customer-safe, no internal detail.
Write in plain operational English. Times in the evidence are UTC; do not restate clock times.`;

type TaskHandler = { input: z.ZodType; run: (input: never) => Promise<unknown> };

export const AGENT_TASK_HANDLERS: Record<AgentTask, TaskHandler> = {
  "investigate-case": {
    input: caseInputSchema,
    run: (input: z.infer<typeof caseInputSchema>) =>
      structuredCall({
        schema: investigationSchema,
        effort: "high",
        system: `${PRODUCT_CONTEXT}\n\n${INVESTIGATION_RULES}`,
        prompt: `Investigate why this payment has not produced its promised outcome.\n\n${JSON.stringify(input)}`,
      }),
  },
  "investigate-incident": {
    input: incidentInputSchema,
    run: (input: z.infer<typeof incidentInputSchema>) =>
      structuredCall({
        schema: investigationSchema,
        effort: "high",
        system: `${PRODUCT_CONTEXT}\n\n${INVESTIGATION_RULES}\nThis is an incident: many cases that may share one cause. Case ids may also be cited as evidence of a shared pattern.`,
        prompt: `Investigate the shared cause of this incident.\n\n${JSON.stringify(input)}`,
      }),
  },
  "draft-message": {
    input: messageDraftInputSchema,
    run: (input: z.infer<typeof messageDraftInputSchema>) =>
      structuredCall({
        schema: messageDraftSchema,
        effort: "low",
        system: `${PRODUCT_CONTEXT}\n\nDraft a short message from LearnLoop to a customer. Warm, plain and specific; at most 80 words; address the customer as {first_name}.
Never mention: confidence scores, AI or agents, webhooks, HTTP codes, APIs, policies or thresholds, deployments, internal errors or system names.
Only state facts from the input. Do not promise timelines or refunds that are not in the facts.`,
        prompt: JSON.stringify(input),
      }),
  },
  "draft-contract": {
    input: contractDraftInputSchema,
    run: (input: z.infer<typeof contractDraftInputSchema>) =>
      structuredCall({
        schema: contractDraftSchema,
        effort: "medium",
        system: `${PRODUCT_CONTEXT}\n\nTurn the merchant's plain-language description into an Outcome Contract: what a successful payment must produce, how to match it, how long to wait, and how to recover safely.
- productScope must use product ids from the catalogue.
- fulfilmentService must be one of the listed services.
- maxAutomaticValue must not exceed the global maximum.
- Prefer conservative defaults (review duplicates; inventory checks for anything with limited seats or stock).
- List every choice the description did not state in assumptions.`,
        prompt: JSON.stringify(input),
      }),
  },
  "ask-incident": {
    input: askIncidentInputSchema,
    run: (input: z.infer<typeof askIncidentInputSchema>) =>
      structuredCall({
        schema: askAnswerSchema,
        effort: "medium",
        system: `${PRODUCT_CONTEXT}\n\nAnswer a payments operations manager's question about ONE incident, using only the supplied evidence (event ids), case ids and facts (fact ids).
- Cite every claim by exact id in citedIds. Never invent ids; uncited claims are removed.
- The facts are computed by the product from current policy: use them for anything about recovery groups, what approval would do, limits or verification. Do not contradict them.
- You cannot execute, approve, refund, capture or message anyone. If the question asks you to act, explain what would happen and set nextStep to where the manager can act (review_recovery, view_investigation or view_evidence).
- If the question is not about this incident or cannot be answered from the evidence and facts, set inScope to false and say what you can answer instead.
- At most 120 words. Plain operational English. Times in the evidence are UTC; do not restate clock times. No customer personal data.`,
        prompt: JSON.stringify(input),
      }),
  },
  "explain-autonomy": {
    input: autonomyInputSchema,
    run: (input: z.infer<typeof autonomyInputSchema>) =>
      structuredCall({
        schema: autonomyExplanationSchema,
        effort: "medium",
        system: `${PRODUCT_CONTEXT}\n\nExplain to a payments operations manager whether an action could safely run automatically, based on how they decided past recommendations.
Be concrete and balanced: cite the counts, name the risks (including any wrong actions, failed executions and the reasons for edits or rejections), and suggest a mode with value and confidence limits.
Eligibility has already been decided by deterministic rules and is given as \`eligible\` with any \`unmetCriteria\`. Never contradict it: if \`eligible\` is false, suggest keeping the action review-first. Merchant approval without edits is agreement, not evidence that the action worked; only verified outcomes count as success. The manager decides; nothing changes unless they switch it on.`,
        prompt: JSON.stringify(input),
      }),
  },
};
