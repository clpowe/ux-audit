import { z } from "zod";

export const HEURISTICS = [
  "Visibility of system status", "Match between system and real world",
  "User control and freedom", "Consistency and standards", "Error prevention",
  "Recognition rather than recall", "Flexibility and efficiency of use",
  "Aesthetic and minimalist design", "Error recovery", "Help and documentation",
] as const;

export const evaluationSchema = z.object({
  stage: z.string(),
  userIntent: z.string(),
  businessGoalHypothesis: z.string(),
  expectedPath: z.string(),
  informationNeeded: z.array(z.string()),
  decisionsRequired: z.array(z.string()),
  assumptions: z.array(z.string()),
  firstTimeUserRisks: z.array(z.string()),
  experiencedUserFriction: z.array(z.string()),
  heuristics: z.array(z.object({
    name: z.enum(HEURISTICS),
    assessment: z.enum(["Issue", "No issue observed", "Insufficient evidence"]),
    rationale: z.string(),
    evidence: z.array(z.number().int()),
  })).length(10),
  score: z.number().min(0).max(10).nullable(),
  scoreRationale: z.string().min(1),
});

export const findingReviewSchema = z.object({
  basis: z.enum(["Observed issue", "Expert Hypothesis"]),
  category: z.enum(["Clarity", "Effort", "Trust", "Navigation", "Interaction", "Accessibility"]),
  heuristics: z.array(z.enum(HEURISTICS)),
  severity: z.enum(["Critical", "High", "Medium", "Low"]),
  rootCauseHypothesis: z.string(),
  recommendation: z.string(),
  expectedUXImpact: z.string(),
  userImpact: z.enum(["Low", "Medium", "High"]),
  businessImpactHypothesis: z.string(),
  effort: z.enum(["Small", "Medium", "Large"]),
  priority: z.enum(["P0 Immediate", "P1 High", "P2 Medium", "P3 Future"]),
  metrics: z.array(z.object({
    name: z.string(),
    direction: z.enum(["Likely increase", "Potential reduction", "Uncertain"]),
    rationale: z.string(),
    confidence: z.enum(["Low", "Medium", "High"]),
  })),
});

export type StepEvaluation = z.infer<typeof evaluationSchema>;
export type FindingReview = z.infer<typeof findingReviewSchema>;

export function validateEvaluation(evaluation: StepEvaluation, refs: Set<number>) {
  evaluationSchema.parse(evaluation);
  if (new Set(evaluation.heuristics.map((item) => item.name)).size !== HEURISTICS.length) {
    throw new Error("Step evaluation must assess each heuristic exactly once.");
  }
  if (evaluation.score !== null && evaluation.heuristics.every((item) => item.assessment === "Insufficient evidence")) {
    throw new Error("A step with no assessable heuristic evidence cannot receive a score.");
  }
  for (const item of evaluation.heuristics) {
    if (item.evidence.some((ref) => !refs.has(ref))) throw new Error("Heuristic assessment cited evidence outside the current snapshot.");
    if (item.assessment !== "Insufficient evidence" && !item.evidence.length) {
      throw new Error("Heuristic assessment requires evidence or an explicit insufficient-evidence result.");
    }
  }
}

export function evaluationMarkdown(evaluation: StepEvaluation, nodes: { ref: number; role: string; name: string }[], escape: (text: string) => string): string[] {
  const list = (name: string, values: string[]) => `**${name}:** ${values.length ? values.map(escape).join("; ") : "None identified"}`;
  const evidence = (refs: number[]) => refs.map((ref) => {
    const node = nodes.find((item) => item.ref === ref);
    return node ? `${ref}: ${escape(node.role)} — ${escape(node.name)}` : `${ref}: unavailable`;
  }).join("; ") || "Unavailable";
  return [
    `**Stage:** ${escape(evaluation.stage)}`,
    `**User intent:** ${escape(evaluation.userIntent)}`,
    `**Business goal — Expert Hypothesis:** ${escape(evaluation.businessGoalHypothesis)}`,
    `**Expected path:** ${escape(evaluation.expectedPath)}`,
    list("Information needed", evaluation.informationNeeded),
    list("Decisions required", evaluation.decisionsRequired),
    list("Assumptions", evaluation.assumptions),
    list("First-time user risks — Expert Hypothesis", evaluation.firstTimeUserRisks),
    list("Experienced-user friction — Expert Hypothesis", evaluation.experiencedUserFriction), "",
    "| Heuristic | Assessment | Rationale | Evidence |",
    "|---|---|---|---|",
    ...evaluation.heuristics.map((item) => `| ${escape(item.name)} | ${item.assessment} | ${escape(item.rationale)} | ${evidence(item.evidence)} |`), "",
    `**Step score — expert judgment:** ${evaluation.score === null ? "Not assessed" : `${evaluation.score}/10`}. ${escape(evaluation.scoreRationale)}`, "",
  ];
}

export function findingReviewMarkdown(review: FindingReview, escape: (text: string) => string): string[] {
  return [
    `**${review.basis} · ${review.category} · ${review.severity} · ${review.priority}**`,
    `**Heuristics:** ${review.heuristics.map(escape).join("; ") || "Task-based finding"}`,
    `**Root cause — Expert Hypothesis:** ${escape(review.rootCauseHypothesis)}`,
    `**Recommendation:** ${escape(review.recommendation)}`,
    `**Expected UX impact — Expert Hypothesis:** ${escape(review.expectedUXImpact)}`,
    `**User impact:** ${review.userImpact} · **Estimated effort:** ${review.effort}`,
    `**Business impact — Expert Hypothesis:** ${escape(review.businessImpactHypothesis)}`, "",
    ...review.metrics.map((metric) => `- **${escape(metric.name)} — Expert Hypothesis:** ${metric.direction}; ${escape(metric.rationale)} (confidence: ${metric.confidence}).`), "",
  ];
}
