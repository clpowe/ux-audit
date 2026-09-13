import { withSession, VIEWPORTS } from "./sessions";
import { dismissOverlays } from "./overlay";
import { runRules, type Severity } from "./rules";
import { group } from "./group";
import { captureShots } from "./annotate";
import { markdown } from "./report";
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

    const measured = await page.snapshot({ boxes: true });
    const view = await page.layout();

    const findings = runRules(measured, {
      viewport: { width: view.width, height: view.height },
      pageHeight: view.pageHeight,
      overlaysDismissed: overlays,
    });

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
          shots,
        }),
      );
      console.error(
        `report → ${dir}/report.md · ${shots.size} findings across ${new Set(shots.values()).size} screenshots`,
      );
    }

    if (asJson) {
      console.log(JSON.stringify({ url, viewport: view, overlays, findings: grouped }, null, 2));
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
        `${grouped.length} findings from ${findings.length} observations · ${overlays.length} overlay(s) dismissed`,
      );
    }
  },
);
