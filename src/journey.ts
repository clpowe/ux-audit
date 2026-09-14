import type { Node, Page } from "./page/page";
import { evaluationMarkdown, findingReviewMarkdown, findingReviewSchema, validateEvaluation, type StepEvaluation, type FindingReview } from "./journey-evaluation";

export const PERSONAS: Record<string, string> = {
  "New Mother": "A 34-year-old married mother based in Atlanta, shopping with limited time. Prefers a warm, contemporary, family-friendly style with soft shapes and an uncluttered look; no specific color is required. Needs an easy-to-clean sofa with a listed item price of no more than $1,500 and delivery available by October 15, 2026. Her exact delivery address and ZIP, taxes, delivery fees, disability, and technical ability are unknown; do not infer them or infer needs and abilities from her demographics.",
  "Careful Shopper": "Compares product details, total price, delivery, and returns before choosing. Do not invent a budget or product requirements.",
};

export type JourneyInput = { url: string; task: string; persona: string; needs: string };
export type Observation = { problem: string; impact: string; evidence: number[]; review?: FindingReview };
export type Decision = {
  action: "click" | "type" | "scroll" | "added_to_cart" | "blocked";
  ref: number | null;
  text: string | null;
  direction: "up" | "down" | null;
  reason: string;
  evidence: number[];
  observations: Observation[];
  evaluation?: StepEvaluation;
};
export type JourneyStep = {
  number: number;
  screenshot?: string;
  nodes: { ref: number; role: string; name: string; value?: string }[];
  decision?: Decision;
  executed?: boolean;
  executedRef?: number;
  actionError?: string;
  evaluationWarnings?: string[];
  /** Unverified model output retained only for diagnostics, never scored or rendered as findings. */
  unverifiedReview?: Pick<Decision, "evaluation" | "observations">;
};
export type JourneyResult = {
  input: JourneyInput;
  status: "added_to_cart" | "blocked" | "step_limit" | "error";
  reason: string;
  steps: JourneyStep[];
  notices: string[];
};
export type Decide = (context: {
  input: JourneyInput;
  nodes: Node[];
  screenshot?: Uint8Array;
  previousScreenshot?: Uint8Array;
  steps: JourneyStep[];
  afterCartAttempt: boolean;
  atLimit: boolean;
}) => Promise<Decision>;

// Deliberately conservative: ambiguous or sensitive controls terminate this MVP.
const FORBIDDEN = /check\s*-?\s*out|payment|\bpay\b|buy\s*now|\bpurchase\b|place.{0,12}order|submit.{0,12}order|complete.{0,12}order|confirm.{0,12}order|express\s*buy|one.click|shop\s*pay|paypal|apple\s*pay|google\s*pay|subscribe|sign\s*up|register|log\s*in|sign\s*in|delete|\bsend\b/i;
const ADD_TO_CART = /\badd\b.{0,35}\b(cart|bag|basket)\b/i;
const CART_CONFIRMATION = /\badded\b.{0,60}\b(cart|bag|basket)\b|\b(cart|bag|basket)\b.{0,30}\bupdated\b/i;
const CART_FAILURE = /\b(not|never|unable|cannot|failed|couldn.t|wasn.t|isn.t|error)\b/i;
const CLICK_ROLES = new Set(["button", "link", "checkbox", "radio", "tab", "option", "menuitem"]);

function clickTarget(node: Node, nodes: Node[]): Node {
  if (node.role !== "StaticText" && node.role !== "InlineTextBox") return node;
  let depth = node.depth;
  for (let index = nodes.indexOf(node) - 1; index >= 0; index--) {
    const parent = nodes[index]!;
    if (parent.depth >= depth) continue;
    if (parent.role === "RootWebArea") break;
    if (CLICK_ROLES.has(parent.role)) return parent;
    depth = parent.depth;
  }
  return node;
}

function targetFor(decision: Decision, nodes: Node[]): Node {
  const node = nodes.find((candidate) => candidate.ref === decision.ref);
  if (!node) throw new Error(`Action target ${decision.ref} is missing.`);
  if (node.disabled) throw new Error(`Action target ${decision.ref} is disabled.`);
  if (node.name.trim()) return node;

  // Some storefronts expose a product anchor without its descendant heading as
  // the anchor's accessible name. Keep the anchor's locator, but use that
  // descendant text for policy checks and reporting.
  let label = "";
  for (const candidate of nodes.slice(nodes.indexOf(node) + 1)) {
    if (candidate.depth <= node.depth) break;
    if (candidate.name.trim()) {
      label = candidate.name.trim();
      break;
    }
  }
  if (!label) throw new Error(`Action target ${decision.ref} is unnamed.`);
  return { ...node, name: label };
}

function validate(decision: Decision, nodes: Node[], warnings: string[]): Decision {
  const refs = new Set(nodes.map((node) => node.ref));
  // Action/success evidence remains a hard gate; review quality is independent.
  if (decision.evidence.some((ref) => !refs.has(ref))) {
    throw new Error("Model cited action evidence outside the current snapshot.");
  }
  const observations = decision.observations.filter((observation, index) => {
    try {
      if (!observation.evidence.length || observation.evidence.some((ref) => !refs.has(ref))) {
        throw new Error("Finding requires evidence from the current snapshot.");
      }
      if (observation.review) findingReviewSchema.parse(observation.review);
      return true;
    } catch (error) {
      warnings.push(`Finding ${index + 1} excluded: ${String(error)}`);
      return false;
    }
  });
  let evaluation = decision.evaluation;
  if (evaluation) {
    try {
      validateEvaluation(evaluation, refs);
      for (const heuristic of evaluation.heuristics) {
        if (heuristic.assessment === "Issue" && !observations.some((item) => item.review?.heuristics.includes(heuristic.name))) {
          throw new Error(`Heuristic issue has no corresponding finding and recommendation: ${heuristic.name}`);
        }
      }
    } catch (error) {
      warnings.push(`Step evaluation excluded: ${String(error)}`);
      evaluation = undefined;
    }
  }
  return { ...decision, observations, evaluation };
}

/** Owns the action budget, action policy, and ordered evidence for one attempt. */
export async function runJourney(
  page: Page,
  input: JourneyInput,
  decide: Decide,
  saveScreenshot: (number: number, bytes: Uint8Array) => Promise<string>,
  maxActions = 20,
): Promise<JourneyResult> {
  if (!Number.isInteger(maxActions) || maxActions < 1) throw new Error("Action limit must be a positive integer.");
  const result: JourneyResult = { input, status: "error", reason: "Journey did not finish.", steps: [], notices: [] };
  const finish = (status: JourneyResult["status"], reason: string) => Object.assign(result, { status, reason });
  let afterCartAttempt = false;
  let beforeCartNames = new Set<string>();
  let previousScreenshot: Uint8Array | undefined;
  let previousState = "";
  let unchanged = 0;
  try {
    // One final observation is allowed after the last action, but no extra action.
    for (let actionCount = 0; actionCount <= maxActions; actionCount++) {
      // Product details and cart feedback are often plain text, not controls.
      const nodes = await page.snapshot({ all: true });
      const view = await page.layout();
      const step: JourneyStep = {
        number: actionCount + 1,
        nodes: nodes.map(({ ref, role, name, value }) => ({ ref, role, name, value })),
      };
      result.steps.push(step);
      let screenshot: Uint8Array | undefined;
      try {
        screenshot = await page.screenshot();
        step.screenshot = await saveScreenshot(step.number, screenshot);
      } catch (error) {
        result.notices.push(`Step ${step.number}: screenshot unavailable: ${String(error)}`);
      }
      const state = JSON.stringify([step.nodes, view.scrollY]);
      unchanged = state === previousState ? unchanged + 1 : 0;
      previousState = state;
      const proposed = await decide({ input, nodes, screenshot, previousScreenshot, steps: result.steps.slice(0, -1), afterCartAttempt, atLimit: actionCount === maxActions });
      const warnings: string[] = [];
      const decision = validate(proposed, nodes, warnings);
      if (warnings.length) {
        step.evaluationWarnings = warnings;
        step.unverifiedReview = { evaluation: proposed.evaluation, observations: proposed.observations };
        result.notices.push(...warnings.map((warning) => `Step ${step.number}: ${warning}`));
      }
      step.decision = decision;
      previousScreenshot = screenshot;

      if (decision.action === "added_to_cart") {
        const confirmed = afterCartAttempt && decision.evidence.some((ref) => {
          const node = nodes.find((candidate) => candidate.ref === ref);
          return node && !beforeCartNames.has(node.name) && CART_CONFIRMATION.test(node.name) && !CART_FAILURE.test(node.name);
        });
        return confirmed
          ? finish("added_to_cart", decision.reason)
          : finish("blocked", "The agent claimed success, but an add-to-cart confirmation could not be verified.");
      }
      if (afterCartAttempt) return finish("blocked", "Stopped after the add-to-cart attempt; confirmation was not verified. " + decision.reason);
      if (decision.action === "blocked") return finish("blocked", decision.reason);
      if (actionCount === maxActions) return finish("step_limit", `Stopped after ${maxActions} actions.`);
      if (unchanged >= 3) return finish("blocked", "The page did not change after three consecutive actions.");

      if (decision.action === "scroll") {
        if (!decision.direction) throw new Error("Scroll direction is missing.");
        await page.scrollTo(Math.max(0, Math.min(view.pageHeight - view.height, view.scrollY + (decision.direction === "down" ? 1 : -1) * view.height * 0.8)));
      } else {
        const selected = targetFor(decision, nodes);
        const reportedTarget = step.nodes.find((node) => node.ref === selected.ref);
        if (reportedTarget) reportedTarget.name = selected.name;
        if (FORBIDDEN.test(selected.name)) return finish("blocked", `Stopped before restricted control: ${selected.name}`);
        const target = decision.action === "click" ? clickTarget(selected, nodes) : selected;
        if (FORBIDDEN.test(target.name)) return finish("blocked", `Stopped before restricted control: ${target.name}`);
        if (target.disabled) return finish("blocked", "The containing control is disabled.");
        if (decision.action === "type") {
          if (!["textbox", "searchbox", "combobox"].includes(target.role) || !/search|find/i.test(target.name)) {
            return finish("blocked", "This MVP only types into named search fields.");
          }
          if (!decision.text?.trim() || decision.text.length > 200 || /[\r\n\t]/.test(decision.text)) throw new Error("Invalid search text.");
          if (target.value?.trim()) return finish("blocked", "Search field already contains text; this MVP does not replace it.");
          try {
            await page.type(target, decision.text);
          } catch (error) {
            const reason = String(error);
            if (!/not rendered|no longer on the page/i.test(reason)) throw error;
            step.actionError = reason;
            result.notices.push(`Step ${step.number}: proposed action could not execute: ${reason}`);
            continue;
          }
        } else {
          if (!CLICK_ROLES.has(target.role)) {
            return finish("blocked", `Unsupported click target: ${target.role}`);
          }
          const cartAttempt = ADD_TO_CART.test(target.name);
          try {
            await page.click(target);
          } catch (error) {
            const reason = String(error);
            if (!/not rendered|no longer on the page/i.test(reason)) throw error;
            step.actionError = reason;
            result.notices.push(`Step ${step.number}: proposed action could not execute: ${reason}`);
            continue;
          }
          afterCartAttempt = cartAttempt;
          if (afterCartAttempt) beforeCartNames = new Set(nodes.map((node) => node.name));
        }
        step.executedRef = target.ref;
      }
      step.executed = true;
    }
  } catch (error) {
    return finish("error", `Automation failed: ${String(error)}`);
  }
  return result;
}

const safe = (value: string) => value.replace(/[<>]/g, (char) => char === "<" ? "&lt;" : "&gt;").replace(/([\\`*_[\]#|])/g, "\\$1").replace(/\r?\n/g, " ");

export function journeyMarkdown(result: JourneyResult): string {
  const { input } = result;
  const lines = ["# Shopping journey", "", `**Task:** ${safe(input.task)}`, `**Website:** ${safe(input.url)}`, `**Persona:** ${safe(input.persona)} — ${safe(input.needs)}`, "", `**Outcome:** ${result.status}`, safe(result.reason), "", "Evaluation framework: UX Journey Evaluator. Findings and scores are expert judgments about this observed attempt, not validated user research. Persona, root-cause, effort, and metric impacts are hypotheses; no analytics or numerical uplift are inferred.", ""];
  const seenProblems = new Set<string>();
  const findings = result.steps.flatMap((step) => (step.decision?.observations ?? []).map((observation) => ({ step, observation })))
    .sort((a, b) => (a.observation.review?.priority ?? "P3").localeCompare(b.observation.review?.priority ?? "P3"))
    .filter(({ observation }) => {
      const key = observation.problem.trim().toLowerCase();
      if (seenProblems.has(key)) return false;
      seenProblems.add(key);
      return true;
    });
  lines.push("## Executive summary", "", `Objective: ${safe(input.task)}. ${result.steps.length} page states recorded; ${findings.length} findings.`, "");
  for (const { step, observation } of findings.slice(0, 5)) {
    lines.push(`- **Step ${step.number}:** ${safe(observation.problem)}${observation.review ? ` — ${observation.review.severity}; opportunity: ${safe(observation.review.recommendation)}. Business risk — Expert Hypothesis: ${safe(observation.review.businessImpactHypothesis)}` : ""}`);
  }
  lines.push("", "## Journey assessment", "");
  for (const step of result.steps) {
    const decision = step.decision;
    const assessment = decision?.action === "added_to_cart" || decision?.action === "blocked";
    lines.push(`### Step ${step.number}`, "", decision ? `${assessment ? "Agent assessment: " : ""}${decision.action}${assessment ? "" : step.executed ? " (executed)" : " (not executed)"}: ${safe(decision.reason)}` : "Automation stopped before a decision.", "");
    if (step.actionError) lines.push(`**Action could not execute:** ${safe(step.actionError)}`, "");
    if (decision?.ref !== null && decision?.ref !== undefined) {
      const target = step.nodes.find((node) => node.ref === (step.executedRef ?? decision.ref));
      if (target) lines.push(`Target: ${safe(target.role)} — ${safe(target.name)}`, "");
    }
    if (step.screenshot) lines.push(`![Page at step ${step.number}](${step.screenshot})`, "");
    else lines.push("Screenshot unavailable.", "");
    if (decision?.evaluation) lines.push(...evaluationMarkdown(decision.evaluation, step.nodes, safe));
    else lines.push("Step evaluation unavailable.", "");
    if (step.evaluationWarnings?.length) lines.push("**Evaluation limitations:**", "", ...step.evaluationWarnings.map((warning) => `- ${safe(warning)}`), "");
    for (const observation of decision?.observations ?? []) {
      lines.push(`**Observation:** ${safe(observation.problem)}`, `**Possible persona impact:** ${safe(observation.impact)}`, "");
      if (observation.review) lines.push(...findingReviewMarkdown(observation.review, safe));
      for (const ref of observation.evidence) {
        const node = step.nodes.find((candidate) => candidate.ref === ref);
        if (node) lines.push(`- Evidence: ${safe(node.role)} — ${safe(node.name)}`);
      }
      lines.push("");
    }
  }
  if (!result.steps.some((step) => step.decision?.observations.length)) lines.push("No supported UX observations were recorded.", "");
  lines.push("## Prioritized action plan", "", "Effort and business impact below are expert hypotheses, not measured outcomes.", "", "| Step | Recommendation | Severity | User impact | Business impact hypothesis | Effort | Priority |", "|---|---|---|---|---|---|---|");
  for (const { step, observation } of findings) {
    const review = observation.review;
    if (review) lines.push(`| ${step.number} | ${safe(review.recommendation)} | ${review.severity} | ${review.userImpact} | ${safe(review.businessImpactHypothesis)} | ${review.effort} | ${review.priority} |`);
  }
  const scores = result.steps.flatMap((step) => typeof step.decision?.evaluation?.score === "number" ? [step.decision.evaluation.score] : []);
  lines.push("", "## Final verdict", "", `Outcome: ${result.status}. ${safe(result.reason)}`, "", scores.length ? `Observed-step mean score: **${(scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)}/10** across ${scores.length} assessed states. This is an unweighted mean of subjective step scores, not a score for unvisited parts of the journey or measured business effectiveness.` : "Journey score unavailable: no scored step assessments.", "");
  if (result.notices.length) lines.push("## Coverage limitations", "", ...result.notices.map((notice) => `- ${safe(notice)}`), "");
  return lines.join("\n");
}
