import { z } from "zod/v4";

/**
 * Investigation output. Used both as the structured-output schema sent to the
 * model and to validate every response before it can reach the product.
 */
export const hypothesisSchema = z.object({
  cause: z.string().min(1).describe("A candidate cause, in plain operational language"),
  verdict: z.enum(["supported", "ruled_out", "inconclusive"]),
  evidenceIds: z.array(z.string()).describe("IDs from the supplied evidence that support or rule out this cause"),
  reasoning: z.string().min(1).describe("One sentence linking the cited evidence to the verdict"),
});

export const investigationSchema = z.object({
  summary: z.string().min(1),
  likelyCause: z.string().min(1),
  evidenceIds: z.array(z.string()),
  uncertainties: z.array(z.string()),
  recommendedAction: z.enum(["wait", "replay_webhook", "retry_provisioning", "capture", "prepare_refund", "refund_duplicate", "escalate"]),
  confidence: z.number().min(0).max(1),
  customerImpact: z.string().min(1),
  consequenceOfInaction: z.string().min(1),
  customerMessageDraft: z.string().optional(),
  hypotheses: z.array(hypothesisSchema).optional(),
});
