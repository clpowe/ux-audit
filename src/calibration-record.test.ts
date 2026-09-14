import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCalibrationRecord, saveCalibration } from "./calibration-record";
import type { Choice, Reflection } from "./agent";
import type { Node } from "./page/page";

test("preserves calibration inputs, outputs, and cited evidence in a JSON artifact", async () => {
  const before: Node[] = [{ ref: 0, role: "button", name: "Search", depth: 0, handle: 1 }];
  const after: Node[] = [{ ref: 3, role: "status", name: "Results loaded", depth: 0, handle: 2 }];
  const choice: Choice = {
    intent: "Search",
    expectation: "Results appear",
    ref: 0,
    why_this: "It starts search",
  };
  const reflection: Reflection = {
    outcome: "Results loaded",
    gap: "",
    evidence: [3],
    heuristics: [],
  };
  const record = makeCalibrationRecord({
    url: "https://example.com",
    goal: "Search",
    model: "test-model",
    viewport: { width: 1440, height: 900, mobile: false },
    before,
    choices: [choice],
    selectedAction: {
      choice,
      node: before[0]!,
      timing: { respondedMs: 10, settledMs: 20, respondedWith: "mutation" },
    },
    after,
    reflections: [reflection],
  });
  const root = await mkdtemp(join(tmpdir(), "ux-audit-calibration-"));
  try {
    const file = await saveCalibration(record, join(root, "records"));
    const saved = await Bun.file(file).json();
    expect(saved.viewport).toEqual({ width: 1440, height: 900, mobile: false });
    expect(saved.beforeSnapshot).toContain('button "Search"');
    expect(saved.afterSnapshot).toContain('status "Results loaded"');
    expect(saved.reflections[0].citedEvidence).toEqual([
      { ref: 3, role: "status", name: "Results loaded" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
