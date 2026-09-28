import { z } from "zod";

export const investigationSchema = z.object({
  summary: z.string().min(1),
  likelyCause: z.string().min(1),
  evidenceIds: z.array(z.string()),
  uncertainties: z.array(z.string()),
  recommendedAction: z.enum([
    "wait",
    "replay_webhook",
    "retry_provisioning",
    "capture",
    "prepare_refund",
    "refund_duplicate",
    "escalate",
  ]),
  confidence: z.number().min(0).max(1),
  customerImpact: z.string().min(1),
  consequenceOfInaction: z.string().min(1),
  customerMessageDraft: z.string().optional(),
});
