import { appendFile, mkdir } from "node:fs/promises";
import { withSession, VIEWPORTS } from "./sessions";
import { dismissOverlays } from "./overlay";
import { chooseAction, citedEvidence, reflect } from "./agent";

const url = process.argv[2];
const goal = process.argv[3];

if (!url || !goal) {
  console.error('usage: bun run probe <url> "<goal>" [--mobile]');
  process.exit(1);
}
const mobile = process.argv.includes("--mobile");
const viewport = mobile ? VIEWPORTS.mobile : VIEWPORTS.desktop;

await withSession(
  { url, viewport },
  async (page) => {
    await dismissOverlays(page);
    await page.prime();

    const before = await page.snapshot();

    const choice = await chooseAction(goal, before, viewport);
    const target = before.find((n) => n.ref === choice.ref);
    if (!target) throw new Error(`model chose ref ${choice.ref}, not present in the snapshot`);

    console.log(`goal         ${goal}`);
    console.log(`intent       ${choice.intent}`);
    console.log(`expectation  ${choice.expectation}`);
    console.log(`action       click ${choice.ref} — ${target.role} "${target.name}"`);
    console.log(`why          ${choice.why_this}`);

    const timing = await page.click(target);
    const after = await page.snapshot();
    const result = await reflect(choice, before, after, viewport);

    const responded =
      timing.respondedMs === null
        ? "— nothing responded —"
        : `${timing.respondedMs}ms (${timing.respondedWith})`;
    const settled =
      timing.settledMs !== null
        ? `${timing.settledMs}ms`
        : timing.respondedMs === null
          ? "—"
          : "— still changing when time ran out —";

    console.log(`\noutcome      ${result.outcome}`);
    console.log(`gap          ${result.gap || "— none —"}`);
    console.log(`heuristics   ${result.heuristics.join(", ") || "—"}`);
    console.log(`evidence     ${result.evidence.join(", ") || "— none cited —"}`);
    console.log(`responded    ${responded}`);
    console.log(`settled      ${settled}`);
    await mkdir("out", { recursive: true });
    await appendFile(
      "out/observations.jsonl",
      JSON.stringify({
        ts: new Date().toISOString(),
        url,
        goal,
        intent: choice.intent,
        expectation: choice.expectation,
        action: { ref: choice.ref, role: target.role, name: target.name },
        why_this: choice.why_this,
        outcome: result.outcome,
        gap: result.gap,
        heuristics: result.heuristics,
        responded_ms: timing.respondedMs,
        settled_ms: timing.settledMs,
        evidence_refs: result.evidence,
        evidence: citedEvidence(result, after),
      }) + "\n",
    );
  },
);
