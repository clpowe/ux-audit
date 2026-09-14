import { expect, test } from "bun:test";
import { HEURISTICS, validateEvaluation, type StepEvaluation, type FindingReview } from "./journey-evaluation";
import { journeyMarkdown, runJourney } from "./journey";
import { FakePage } from "./page/fake";

const evaluation = (): StepEvaluation => ({
  stage: "Product selection", userIntent: "Choose a sofa", businessGoalHypothesis: "Enable product selection", expectedPath: "Review details, then add to cart",
  informationNeeded: ["Delivery date"], decisionsRequired: ["Whether delivery meets the shopper's needs"], assumptions: ["No business analytics provided"], firstTimeUserRisks: [], experiencedUserFriction: [],
  heuristics: HEURISTICS.map((name) => ({ name, assessment: "Insufficient evidence", rationale: "Not established by this view", evidence: [] })),
  score: null, scoreRationale: "Insufficient evidence for scoring",
});
const review: FindingReview = {
  basis: "Observed issue", category: "Clarity", heuristics: [HEURISTICS[0]], severity: "Medium",
  rootCauseHypothesis: "Delivery information may be deferred", recommendation: "Show an estimated delivery window", expectedUXImpact: "Reduce uncertainty during product selection", userImpact: "Medium", businessImpactHypothesis: "May support informed cart additions", effort: "Medium", priority: "P2 Medium",
  metrics: [{ name: "Task success rate", direction: "Likely increase", rationale: "Shoppers could determine whether delivery meets their needs", confidence: "Low" }],
};

test("all ten heuristics may explicitly lack evidence without manufacturing a score", () => {
  expect(() => validateEvaluation(evaluation(), new Set())).not.toThrow();
  const scored = evaluation();
  scored.score = 10;
  expect(() => validateEvaluation(scored, new Set())).toThrow("cannot receive a score");
});

test("ten duplicated heuristics cannot conceal missing assessments", () => {
  const value = evaluation();
  value.heuristics[1] = { ...value.heuristics[0]! };
  expect(() => validateEvaluation(value, new Set())).toThrow("exactly once");
});

test("positive and negative assessments both need current evidence", () => {
  for (const assessment of ["No issue observed", "Issue"] as const) {
    const value = evaluation();
    value.heuristics[0] = { name: HEURISTICS[0], assessment, rationale: "Claim", evidence: [] };
    expect(() => validateEvaluation(value, new Set())).toThrow("requires evidence");
    value.heuristics[0].evidence = [99];
    expect(() => validateEvaluation(value, new Set([0]))).toThrow("outside the current snapshot");
  }
});

test("heuristic findings retain step evidence, screenshot, recommendation, and hypothesis labels in the report", async () => {
  const value = evaluation();
  value.heuristics[0] = { name: HEURISTICS[0], assessment: "Issue", rationale: "Delivery timing is explicitly unavailable", evidence: [0] };
  value.score = 6;
  value.scoreRationale = "Delivery uncertainty reduces clarity; broader business effectiveness cannot be assessed.";
  const page = new FakePage({ initial: "product", states: { product: { nodes: [{ role: "note", name: "Delivery date unavailable" }] } } });
  const result = await runJourney(page, { url: "https://shop.example", task: "buy a sofa", persona: "New Mother", needs: "Clear delivery" }, async () => ({
    action: "blocked", ref: null, text: null, direction: null, reason: "Fixture stops at product view", evidence: [0], evaluation: value,
    observations: [{ problem: "Delivery timing is missing", impact: "Makes planning uncertain", evidence: [0], review }],
  }), async () => "product.png");
  expect(result.status).toBe("blocked");
  const report = journeyMarkdown(result);
  for (const text of ["![Page at step 1](product.png)", "0: note — Delivery date unavailable", "Show an estimated delivery window", "Task success rate — Expert Hypothesis", "P2 Medium", "6.0/10", "not a score for unvisited"]) expect(report).toContain(text);
  for (const name of HEURISTICS) expect(report).toContain(name);
  expect(JSON.parse(JSON.stringify(result)).steps[0].decision.evaluation).toEqual(value);
});

test("an incomplete heuristic review does not prevent a safe action or successful cart completion", async () => {
  const value = evaluation();
  value.heuristics[0] = { name: HEURISTICS[0], assessment: "Issue", rationale: "Missing status", evidence: [0] };
  const page = new FakePage({ initial: "modal", states: {
    modal: { nodes: [{ role: "button", name: "Close Modal" }] },
    product: { nodes: [{ role: "button", name: "Add to cart" }] },
    cart: { nodes: [{ role: "status", name: "Sofa added to cart" }] },
  }, transitions: { modal: { "button:Close Modal": "product" }, product: { "button:Add to cart": "cart" } } });
  const result = await runJourney(page, { url: "https://shop.example", task: "buy a sofa", persona: "New Mother", needs: "Clear delivery" }, async ({ afterCartAttempt, steps }) => ({
    action: afterCartAttempt ? "added_to_cart" : "click", ref: afterCartAttempt ? null : 0, text: null, direction: null, reason: "Continue shopping", evidence: [0], observations: [], evaluation: steps.length === 0 ? value : evaluation(),
  }), async (number) => `step-${number}.png`);
  expect(result.status).toBe("added_to_cart");
  expect(page.state).toBe("cart");
  expect(result.steps[0]?.executed).toBe(true);
  expect(result.steps[0]?.decision?.evaluation).toBeUndefined();
  expect(result.steps[0]?.unverifiedReview?.evaluation).toEqual(value);
  expect(result.notices[0]).toContain("no corresponding finding");
  const report = journeyMarkdown(result);
  expect(report).toContain("Step evaluation unavailable");
  expect(report).toContain("Evaluation limitations");
  expect(report).toContain("![Page at step 1](step-1.png)");
  expect(report).not.toContain("| Visibility of system status | Issue |");
});

for (const unsafe of ["Checkout", "missing target", "invalid action evidence"]) {
  test(`incomplete evaluation cannot bypass action checks: ${unsafe}`, async () => {
    const value = evaluation();
    value.heuristics[0] = { name: HEURISTICS[0], assessment: "Issue", rationale: "Missing status", evidence: [0] };
    const page = new FakePage({ initial: "start", states: { start: { nodes: [{ role: "button", name: "Checkout" }] } } });
    const result = await runJourney(page, { url: "https://shop.example", task: "buy a sofa", persona: "New Mother", needs: "Clear delivery" }, async () => ({
      action: "click", ref: unsafe === "missing target" ? 99 : 0, text: null, direction: null, reason: "Attempt", evidence: [unsafe === "invalid action evidence" ? 99 : 0], observations: [], evaluation: value,
    }), async () => "step.png");
    expect(result.status).toBe(unsafe === "Checkout" ? "blocked" : "error");
    expect(result.steps[0]?.executed).toBeUndefined();
  });
}

test("valid findings survive alongside an invalid assessment and unsupported sibling finding", async () => {
  const value = evaluation();
  value.heuristics[0] = { name: HEURISTICS[0], assessment: "Issue", rationale: "Invented reference", evidence: [99] };
  const page = new FakePage({ initial: "product", states: { product: { nodes: [{ role: "note", name: "Delivery date unavailable" }] } } });
  const result = await runJourney(page, { url: "https://shop.example", task: "buy a sofa", persona: "New Mother", needs: "Clear delivery" }, async () => ({
    action: "blocked", ref: null, text: null, direction: null, reason: "Stop", evidence: [0], evaluation: value,
    observations: [{ problem: "Delivery unavailable", impact: "Uncertainty", evidence: [0], review }, { problem: "Invented defect", impact: "Unknown", evidence: [99], review }],
  }), async () => "step.png");
  expect(result.status).toBe("blocked");
  expect(result.steps[0]?.decision?.observations).toHaveLength(1);
  expect(result.steps[0]?.evaluationWarnings).toHaveLength(2);
  const report = journeyMarkdown(result);
  expect(report).toContain("Delivery unavailable");
  expect(report).not.toContain("Invented defect");
  expect(report).toContain("Journey score unavailable");
});
