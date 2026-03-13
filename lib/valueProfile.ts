/**
 * Deterministic value interpretation layer.
 * Maps score/grade to business narrative: why Quanto creates value for this firm.
 */
export type GradeBand = "A" | "B" | "C" | "D";

export interface ValueProfile {
  gradeBand: GradeBand;
  /** Short headline for "How Quanto Creates Value Here" */
  headline: string;
  /** 2–3 sentence narrative; used even when AI is loading or failed */
  narrative: string;
}

const A_HEADLINE = "Preserve quality at scale and protect margins";
const A_NARRATIVE =
  "This firm already runs relatively clean books. Quanto helps preserve quality as the firm scales, reduce manual review, accelerate closes, standardize SOP-driven work, and protect margins across a growing client base or acquisition pipeline.";

const B_C_HEADLINE = "Standardize workflows and unlock capacity";
const B_C_NARRATIVE =
  "This firm has workable books but meaningful operational friction. Quanto helps standardize workflows, reduce recurring cleanup burden, increase team capacity, and make the operation more repeatable and acquisition-ready.";

const D_HEADLINE = "De-risk onboarding and reduce cleanup burden";
const D_NARRATIVE =
  "This firm has clear cleanup burden and operational risk. Quanto helps de-risk onboarding, surface hidden issues earlier, reduce manual cleanup, and create a path toward more predictable operations.";

export function buildValueProfile(overallGrade: GradeBand): ValueProfile {
  switch (overallGrade) {
    case "A":
      return { gradeBand: "A", headline: A_HEADLINE, narrative: A_NARRATIVE };
    case "B":
    case "C":
      return { gradeBand: overallGrade, headline: B_C_HEADLINE, narrative: B_C_NARRATIVE };
    case "D":
      return { gradeBand: "D", headline: D_HEADLINE, narrative: D_NARRATIVE };
    default:
      return { gradeBand: "C", headline: B_C_HEADLINE, narrative: B_C_NARRATIVE };
  }
}
