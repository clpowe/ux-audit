import { expect, test } from "bun:test";
import { journeyMarkdown, PERSONAS, type JourneyResult } from "./journey";

test("New Mother carries her profile, style, budget, and delivery constraints into reports", () => {
  const needs = PERSONAS["New Mother"]!;
  expect(needs).toContain("34-year-old married mother based in Atlanta");
  expect(needs).toContain("warm, contemporary, family-friendly style");
  expect(needs).toContain("no specific color is required");
  expect(needs).toContain("no more than $1,500");
  expect(needs).toContain("October 15, 2026");
  const result: JourneyResult = {
    input: { url: "https://shop.example", task: "buy a sofa", persona: "New Mother", needs },
    status: "blocked", reason: "Fixture", steps: [], notices: [],
  };
  const report = journeyMarkdown(result);
  expect(report).toContain("34-year-old married mother based in Atlanta");
  expect(report).toContain("warm, contemporary, family-friendly style");
  expect(report).toContain("no specific color is required");
  expect(report).toContain("no more than $1,500");
  expect(report).toContain("October 15, 2026");
});
