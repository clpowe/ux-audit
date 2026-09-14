import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureShots } from "./annotate";
import { group, type GroupedFinding } from "./group";
import { FakePage } from "./page/fake";
import type { MeasuredNode } from "./page/page";
import { json, markdown } from "./report";
import { runRules, type Finding } from "./rules";

const context = {
  viewport: { width: 390, height: 844 },
  pageHeight: 844,
  overlayAttempts: [],
};

describe("Finding evidence", () => {
  test("separates unavailable geometry from an observed presentation defect", () => {
    const unavailable: MeasuredNode = {
      ref: 0,
      role: "button",
      name: "Buy",
      depth: 0,
      handle: 1,
      measurement: "unavailable",
      box: null,
      measurementError: "DOM.getBoxModel timed out",
    };
    const hidden: MeasuredNode = {
      ref: 1,
      role: "button",
      name: "Chat",
      depth: 0,
      handle: 2,
      measurement: "not-rendered",
      box: null,
    };

    const result = runRules([unavailable, hidden], context);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("phantom-node");
    expect(result.findings[0]?.name).toBe("Chat");
    expect(result.notices).toEqual([{
      kind: "measurement-unavailable",
      ref: 0,
      role: "button",
      name: "Buy",
      detail: "DOM.getBoxModel timed out",
    }]);
  });

  test("describes inferred groups as similar elements rather than siblings", () => {
    const findings: Finding[] = [0, 1, 2].map((ref) => ({
      rule: "tap-target",
      law: "Fitts's Law",
      severity: 2,
      ref,
      role: "link",
      name: `Link ${ref}`,
      measurement: "30×20px",
      box: { x: ref * 40, y: 0, width: 30, height: 20 },
    }));

    const [finding] = group(findings);
    expect(finding?.kind).toBe("repeated");
    expect(finding?.observations[0]?.detail).toContain("3 similar elements");
    expect(finding?.observations[0]?.detail).not.toContain("sibling");
  });

  test("reports unavailable measurements as coverage, outside severity counts", () => {
    const report = markdown({
      url: "https://example.com",
      viewport: { width: 390, height: 844 },
      findings: [],
      notices: [{
        kind: "measurement-unavailable",
        ref: 4,
        role: "button",
        name: "Buy",
        detail: "inspection timed out",
      }],
      shots: new Map(),
    });

    expect(report).toContain("0 blocker · 0 major · 0 minor · 0 polish");
    expect(report).toContain("**Audit coverage:** 1 measurement unavailable");
    expect(report).toContain('Ref 4, button "Buy": inspection timed out');
  });

  test("summarizes screenshot evidence in JSON without expanding PNG bytes", () => {
    const output = json({
      url: "https://example.com",
      viewport: { scrollX: 0, scrollY: 0, width: 390, height: 844, pageHeight: 844 },
      overlayAttempts: [{
        name: "Cookies",
        attemptedWith: "Accept",
        status: "dismissed",
        shot: new Uint8Array([137, 80, 78, 71]),
      }],
      notices: [],
      findings: [],
    });

    expect(JSON.parse(output).overlays[0].screenshot).toEqual({ captured: true, bytes: 4 });
    expect(output).not.toContain('"0": 137');
    expect(output).not.toContain('"shot"');
  });
});

describe("screenshot placement", () => {
  const finding: GroupedFinding = {
    id: "F-01",
    severity: 2,
    kind: "element",
    role: "button",
    name: "Buy",
    count: 1,
    box: { x: 0, y: 500, width: 80, height: 44 },
    boxes: [{ x: 0, y: 500, width: 80, height: 44 }],
    observations: [{ rule: "tap-target", law: "Fitts's Law", detail: "small", severity: 2 }],
  };

  test("does not associate a screenshot when the actual viewport misses the Finding", async () => {
    const page = new FakePage({
      initial: "page",
      viewport: { width: 390, height: 300 },
      states: { page: { pageHeight: 600, nodes: [] } },
    });
    const scroll = spyOn(page, "scrollTo").mockResolvedValue();
    const screenshot = spyOn(page, "screenshot");
    const dir = await mkdtemp(join(tmpdir(), "ux-audit-placement-"));
    try {
      const shots = await captureShots(page, [finding], dir);
      expect(shots.has("F-01")).toBe(false);
      expect(screenshot).not.toHaveBeenCalled();
      expect(markdown({
        url: "https://example.com",
        viewport: { width: 390, height: 300 },
        findings: [finding],
        shots,
      })).toContain("No verified screenshot placement was available");
    } finally {
      scroll.mockRestore();
      screenshot.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("associates evidence after confirming the actual viewport intersects", async () => {
    const page = new FakePage({
      initial: "page",
      viewport: { width: 390, height: 300 },
      states: { page: { pageHeight: 600, nodes: [] } },
    });
    const dir = await mkdtemp(join(tmpdir(), "ux-audit-placement-"));
    try {
      const shots = await captureShots(page, [finding], dir);
      expect(shots.get("F-01")).toBe("shot-01.png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
