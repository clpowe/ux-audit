import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const MODEL = process.env.UXA_MODEL ?? "gpt-5.6-terra";

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

export async function chooseAction(goal: string, tree: string): Promise<Choice> {
  const { output } = await generateText({
    model: openai(MODEL),
    output: Output.object({ schema: ChoiceSchema }),
    prompt:
      `You are using a website on a phone. Your goal: ${goal}\n\n` +
      `Below is everything you can perceive. Each row is one element; the leading ` +
      `number is its ref, then its role, then its label.\n\n${tree}\n\n` +
      `Choose exactly one element to click. State what you expect to happen before ` +
      `you act — you will be shown the actual result afterwards and asked whether it matched.`,
  });

  if (!output) throw new Error("model produced no structured output for the action choice");
  return output;
}

export async function reflect(choice: Choice, before: string, after: string): Promise<Reflection> {
  const { output } = await generateText({
    model: openai(MODEL),
    output: Output.object({ schema: ReflectionSchema }),
    prompt:
      `You were pursuing this goal: ${choice.intent}\n\n` +
      `Before acting you expected: "${choice.expectation}"\n\n` +
      `You clicked ref ${choice.ref}. Here is what you could perceive before:\n\n${before}\n\n` +
      `And here is what you can perceive now:\n\n${after}\n\n` +
      `Report the outcome and the gap. Describe only what these two lists show — if you cannot ` +
      `point to a row in the after list that supports a claim, do not make the claim. If your ` +
      `expectation was met, say so plainly and leave gap as an empty string. An honest "no gap" ` +
      `is more useful than a manufactured one.`,
  });

  if (!output) throw new Error("model produced no structured output for the reflection");
  return output;
}
