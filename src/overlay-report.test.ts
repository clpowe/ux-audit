import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dismissOverlays } from "./overlay";
import { FakePage } from "./page/fake";
import { runRules } from "./rules";
import { group } from "./group";
import { captureShots } from "./annotate";
import { markdown } from "./report";

describe("Overlay outcomes in reports", () => {
  for (const status of ["dismissed", "remained", "unverified"] as const) {
    test(`generates a report and preserves evidence for ${status}`, async () => {
      const page = new FakePage({
        initial: "overlay",
        states: {
          overlay: { nodes: [
            { role: "dialog", name: "Newsletter" },
            { role: "button", name: "Close", depth: 1 },
          ] },
          clear: { nodes: [] },
        },
        transitions: status === "dismissed" ? { overlay: { "button:Close": "clear" } } : {},
      });
      const presence = status === "unverified"
        ? spyOn(page, "isPresent").mockRejectedValue(new Error("inspection unavailable"))
        : undefined;
      const shot = new Uint8Array([1, 2, 3]);
      const screenshot = spyOn(page, "screenshot").mockResolvedValue(shot);
      const dir = await mkdtemp(join(tmpdir(), "ux-audit-overlay-report-"));
      try {
        const attempts = await dismissOverlays(page, { waitForDialogMs: 0 });
        expect(attempts[0]?.status).toBe(status);
        const evaluated = runRules([], {
          viewport: { width: 390, height: 844 },
          pageHeight: 844,
          overlayAttempts: attempts,
        });
        const findings = group(evaluated.findings);
        const shots = await captureShots(page, findings, dir);
        const report = markdown({ url: "https://example.com", viewport: { width: 390, height: 844 }, findings, notices: evaluated.notices, shots });
        expect(report).toContain("Newsletter");
        expect(report).toContain("overlay-01.png");
        expect(new Uint8Array(await Bun.file(join(dir, "overlay-01.png")).arrayBuffer())).toEqual(shot);
        if (status === "dismissed") {
          expect(report).toContain("dismissal confirmed");
        } else {
          expect(report).toContain("audit continued");
          expect(report).not.toContain("dismissal confirmed");
          expect(report).toContain(status === "remained" ? "Overlay remained rendered" : "inspection unavailable");
        }
      } finally {
        presence?.mockRestore();
        screenshot.mockRestore();
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});
