import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { render } from "./render";
import type { Node } from "./page/page";

const MODEL = process.env.UXA_MODEL ?? "gpt-5.6-terra";
export const modelName = () => MODEL;

export type AgentViewport = { width: number; height: number; mobile: boolean };

const ChoiceSchema = z.object({
  intent: z
    .string()
    .describe("What you are trying to accomplish right now. One sentence, first person."),
  expectation: z
    .string()
    .describe(
      "What you expect to happen when you take this action. Specific and concrete enough to be wrong. You are committing to this before you see the result.",
    ),
  ref: z.number().int().describe("The ref number of the element you will click, from the list."),
  why_this: z.string().describe("Why this element rather than another."),
});

const ReflectionSchema = z.object({
  outcome: z
    .string()
    .describe("What actually happened, described only from what you can now perceive."),
  gap: z
    .string()
    .describe(
      "How the outcome differed from your stated expectation. Empty string if it matched. Do not invent a gap that was not there.",
    ),
  evidence: z
    .array(z.number().int())
    .describe(
      "Refs from the AFTER list that justify your outcome. Cite only rows you can actually see there. " +
        "If nothing in the after list supports your outcome, return an empty array — that is itself the finding.",
    ),
  heuristics: z
    .array(z.string())
    .describe("Usability heuristics the gap touches, by name. Empty array if there was no gap."),
});

export type Choice = z.infer<typeof ChoiceSchema>;
export type Reflection = z.infer<typeof ReflectionSchema>;

const viewportDescription = (viewport: AgentViewport) =>
  `${viewport.mobile ? "mobile" : "desktop"} viewport (${viewport.width}×${viewport.height} CSS pixels)`;

export function actionPrompt(goal: string, nodes: Node[], viewport: AgentViewport): string {
  return (
    `You are using a website in a ${viewportDescription(viewport)}. Your goal: ${goal}\n\n` +
    `Below is everything you can perceive. Each row is one element; the leading ` +
    `number is its ref, then its role, then its label.\n\n${render(nodes)}\n\n` +
    `Choose exactly one element to click. State what you expect to happen before ` +
    `you act — you will be shown the actual result afterwards and asked whether it matched.`
  );
}

export function validateChoice(choice: Choice, nodes: Node[]): Choice {
  if (!nodes.some((node) => node.ref === choice.ref)) {
    throw new Error(`model chose ref ${choice.ref}, not present in the before Snapshot`);
  }
  return choice;
}

export function validateReflection(reflection: Reflection, after: Node[]): Reflection {
  const refs = new Set(after.map((node) => node.ref));
  const invalid = [...new Set(reflection.evidence.filter((ref) => !refs.has(ref)))];
  if (invalid.length) {
    throw new Error(`model cited ref${invalid.length === 1 ? "" : "s"} ${invalid.join(", ")}, not present in the after Snapshot`);
  }
  if (!reflection.gap.trim() && reflection.heuristics.length) {
    throw new Error("model named usability heuristics without reporting a gap");
  }
  return reflection;
}

export function reflectionPrompt(
  choice: Choice,
  before: Node[],
  after: Node[],
  viewport: AgentViewport,
): string {
  return (
    `You were pursuing this goal: ${choice.intent}\n\n` +
    `You were using a ${viewportDescription(viewport)}.\n\n` +
    `Before acting you expected: "${choice.expectation}"\n\n` +
    `You clicked ref ${choice.ref}. Here is what you could perceive before:\n\n${render(before)}\n\n` +
    `And here is what you can perceive now:\n\n${render(after)}\n\n` +
    `Report the outcome and the gap. Describe only what these two lists show — if you cannot ` +
    `point to a row in the after list that supports a claim, do not make the claim. If your ` +
    `expectation was met, say so plainly and leave gap as an empty string. An honest "no gap" ` +
    `is more useful than a manufactured one.`
  );
}

export function citedEvidence(reflection: Reflection, after: Node[]) {
  const byRef = new Map(after.map((node) => [node.ref, node]));
  return reflection.evidence.map((ref) => {
    const node = byRef.get(ref);
    if (!node) throw new Error(`validated evidence ref ${ref} is missing from the after Snapshot`);
    return { ref, role: node.role, name: node.name, value: node.value };
  });
}

export async function chooseAction(goal: string, nodes: Node[], viewport: AgentViewport): Promise<Choice> {
  const { output } = await generateText({
    model: openai(MODEL),
    output: Output.object({ schema: ChoiceSchema }),
    prompt: actionPrompt(goal, nodes, viewport),
  });

  if (!output) throw new Error("model produced no structured output for the action choice");
  return validateChoice(output, nodes);
}

export async function reflect(
  choice: Choice,
  before: Node[],
  after: Node[],
  viewport: AgentViewport,
): Promise<Reflection> {
  const { output } = await generateText({
    model: openai(MODEL),
    output: Output.object({ schema: ReflectionSchema }),
    prompt: reflectionPrompt(choice, before, after, viewport),
  });

  if (!output) throw new Error("model produced no structured output for the reflection");
  return validateReflection(output, after);
}
