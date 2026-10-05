import type { GlobalControls, OutcomeContract } from "@/domain/types";

export type ConfidenceThreshold = { value: number; source: "contract" | "global" | "contract and global" };

/** The confidence an action needs: the stricter of the contract and global minimums, and which one sets it. */
export function confidenceThreshold(contract: Pick<OutcomeContract, "minimumConfidence">, controls: Pick<GlobalControls, "minimumConfidence">): ConfidenceThreshold {
  const value = Math.max(contract.minimumConfidence, controls.minimumConfidence);
  const source = contract.minimumConfidence === controls.minimumConfidence ? "contract and global" : contract.minimumConfidence > controls.minimumConfidence ? "contract" : "global";
  return { value, source };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** "required ≥95% (contract and global)". */
export function thresholdLabel(t: ConfidenceThreshold): string {
  return `required ≥${pct(t.value)} (${t.source})`;
}
