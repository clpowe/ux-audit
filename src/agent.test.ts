import { describe, expect, test } from "bun:test";
import {
  actionPrompt,
  citedEvidence,
  reflectionPrompt,
  validateChoice,
  validateReflection,
  type Choice,
  type Reflection,
} from "./agent";
import type { Node } from "./page/page";

const nodes: Node[] = [
  { ref: 2, role: "button", name: "Search", depth: 0, handle: 1 },
  { ref: 7, role: "status", name: "Results loaded", depth: 0, handle: 2 },
];
const choice: Choice = {
  intent: "Search",
  expectation: "Results appear",
  ref: 2,
  why_this: "It is the search control",
};
const reflection: Reflection = {
  outcome: "Results loaded",
  gap: "",
  evidence: [7],
  heuristics: [],
};

describe("model judgment boundaries", () => {
  test("describes the actual desktop and mobile viewport in prompts", () => {
    expect(actionPrompt("Search", nodes, { width: 1440, height: 900, mobile: false }))
      .toContain("desktop viewport (1440×900 CSS pixels)");
    expect(actionPrompt("Search", nodes, { width: 390, height: 844, mobile: true }))
      .toContain("mobile viewport (390×844 CSS pixels)");
    expect(reflectionPrompt(choice, nodes, nodes, { width: 1440, height: 900, mobile: false }))
      .toContain("desktop viewport (1440×900 CSS pixels)");
  });

  test("rejects action refs outside the before Snapshot", () => {
    expect(() => validateChoice({ ...choice, ref: 99 }, nodes)).toThrow("not present in the before Snapshot");
  });

  test("rejects evidence refs outside the after Snapshot", () => {
    expect(() => validateReflection({ ...reflection, evidence: [7, 99] }, nodes))
      .toThrow("ref 99, not present in the after Snapshot");
  });

  test("rejects heuristics when the model reports no gap", () => {
    expect(() => validateReflection({ ...reflection, heuristics: ["Visibility"] }, nodes))
      .toThrow("without reporting a gap");
  });

  test("resolves validated evidence refs into inspectable rows", () => {
    expect(citedEvidence(validateReflection(reflection, nodes), nodes)).toEqual([
      { ref: 7, role: "status", name: "Results loaded", value: undefined },
    ]);
  });
});
