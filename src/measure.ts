import { CDP } from "./cdp";
import { launchChrome, openTab, goto, setViewport, primePage } from "./browser";
import { snapshot } from "./snapshot";
import { measureNodes, layout } from "./geometry";
import { dismissOverlays } from "./overlay";
import { runRules, type Severity } from "./rules";
import { group } from "./group";
import { rm } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { drawOverlay, captureShots } from "./annotate";
import { markdown } from "./report";

const wantReport = process.argv.includes("--report");

const url = process.argv[2];
if (!url) {
  console.error("usage: bun run measure <url> [--mobile] [--json]");
  process.exit(1);
}
const mobile = process.argv.includes("--mobile");
const asJson = process.argv.includes("--json");

const chrome = await launchChrome();
const cdp = await CDP.connect(chrome.wsUrl);
const { sessionId } = await openTab(cdp);

if (mobile) await setViewport(cdp, sessionId, 390, 844, true, 3);
else await setViewport(cdp, sessionId, 1440, 900, false, 2);

await goto(cdp, sessionId, url);

const overlays = await dismissOverlays(cdp, sessionId);
await primePage(cdp, sessionId);

const nodes = await snapshot(cdp, sessionId);
const measured = await measureNodes(cdp, sessionId, nodes);
const view = await layout(cdp, sessionId);

const findings = runRules(measured, {
  viewport: { width: view.width, height: view.height },
  pageHeight: view.pageHeight,
  overlaysDismissed: overlays,
});

const grouped = group(findings);

if (wantReport) {
  const dir = "out/report";
  await mkdir(dir, { recursive: true });
  await drawOverlay(cdp, sessionId, grouped);
  const shots = await captureShots(cdp, sessionId, grouped, dir);
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
  const labels: Record<Severity, string> = { 4: "BLOCKER", 3: "MAJOR", 2: "MINOR", 1: "POLISH" };
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

cdp.close();
chrome.proc.kill();
await rm(chrome.profile, { recursive: true, force: true });
