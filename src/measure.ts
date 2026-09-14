import { withSession, VIEWPORTS } from "./sessions";
import { dismissOverlays } from "./overlay";
import { runRules, type Severity } from "./rules";
import { group } from "./group";
import { captureShots } from "./annotate";
import { json, markdown } from "./report";
import { mkdir } from "node:fs/promises";

const url = process.argv[2];
if (!url) {
  console.error("usage: bun run measure <url> [--mobile] [--json] [--report]");
  process.exit(1);
}
const mobile = process.argv.includes("--mobile");
const asJson = process.argv.includes("--json");
const wantReport = process.argv.includes("--report");

await withSession(
  { url, viewport: mobile ? VIEWPORTS.mobile : VIEWPORTS.desktop },
  async (page) => {
    const overlays = await dismissOverlays(page);
    await page.prime();

    // A failed or unverified attempt already ended dismissal for this audit.
    // Only scan again for late Overlays when earlier attempts were confirmed.
    if (!overlays.some((attempt) => attempt.status !== "dismissed")) {
      overlays.push(...(await dismissOverlays(page, { waitForDialogMs: 0 })));
    }

    const measured = await page.snapshot({ boxes: true });
    const view = await page.layout();

    const evaluated = runRules(measured, {
      viewport: { width: view.width, height: view.height },
      pageHeight: view.pageHeight,
      overlayAttempts: overlays,
    });
    const { findings, notices } = evaluated;

    const grouped = group(findings);

    if (wantReport) {
      const dir = "out/report";
      await mkdir(dir, { recursive: true });
      const shots = await captureShots(page, grouped, dir);
      await Bun.write(
        `${dir}/report.md`,
        markdown({
          url,
          viewport: { width: view.width, height: view.height },
          findings: grouped,
          notices,
          shots,
        }),
      );
      console.error(
        `report → ${dir}/report.md · ${shots.size} findings across ${new Set(shots.values()).size} screenshots`,
      );
    }

    if (asJson) {
      console.log(json({ url, viewport: view, overlayAttempts: overlays, notices, findings: grouped }));
    } else {
      const labels: Record<Severity, string> = {
        4: "BLOCKER",
        3: "MAJOR",
        2: "MINOR",
        1: "POLISH",
      };
      for (const s of [4, 3, 2, 1] as Severity[]) {
        const g = grouped.filter((f) => f.severity === s);
        if (!g.length) continue;
        console.log(`\n── ${labels[s]} · ${g.length} ──\n`);
        for (const f of g) {
          console.log(`  ${f.id}  ${f.name || "⟨no name⟩"}`);
          for (const o of f.observations) console.log(`       • ${o.detail}  [${o.law}]`);
          console.log();
        }
      }
      console.error(
        `${grouped.length} findings from ${findings.length} observations · ` +
        `${overlays.filter((o) => o.status === "dismissed").length} Overlay(s) dismissed · ` +
        `${overlays.filter((o) => o.status === "remained").length} remained · ` +
        `${overlays.filter((o) => o.status === "unverified").length} unverified`,
      );
      if (notices.length) console.error(`${notices.length} measurement(s) unavailable; see JSON or report for audit coverage`);
    }
  },
);
