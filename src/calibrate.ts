/**
 * Measures how much the judged lane wobbles when nothing about the evidence changes.
 *
 * Two questions, asked separately:
 *   1. Given one snapshot, does the agent keep choosing the same element?
 *   2. Given one before/after pair, does it keep reporting the same gap?
 *
 * The second is the one that decides whether a report can be trusted. A model that
 * invents a different grievance each time is not evaluating, it is improvising, and
 * no amount of aggregation downstream will fix that.
 */
import { withSession, VIEWPORTS } from "./sessions";
import { dismissOverlays } from "./overlay";
import { chooseAction, modelName, reflect } from "./agent";
import { makeCalibrationRecord, saveCalibration } from "./calibration-record";

const url = process.argv[2];
const goal = process.argv[3];
if (!url || !goal) {
  console.error('usage: bun run calibrate <url> "<goal>" [--mobile] [--runs=10]');
  process.exit(1);
}
const mobile = process.argv.includes("--mobile");
const viewport = mobile ? VIEWPORTS.mobile : VIEWPORTS.desktop;
const runs = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? 10);
if (!Number.isInteger(runs) || runs < 1) {
  console.error("--runs must be a positive integer");
  process.exit(1);
}

const times = <T>(n: number, fn: () => Promise<T>) => Promise.all(Array.from({ length: n }, fn));

/** value → how many runs produced it, most frequent first. */
function tally<T>(values: T[], key: (v: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(key(v), (counts.get(key(v)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const pct = (n: number) => `${Math.round((n / runs) * 100)}%`;

await withSession(
  { url, viewport },
  async (page) => {
    await dismissOverlays(page);
    await page.prime();

    const before = await page.snapshot();
    console.log(`goal   ${goal}`);
    console.log(`runs   ${runs}\n`);

    // 1. One snapshot, many choices.
    const choices = await times(runs, () => chooseAction(goal, before, viewport));

    console.log("── which element it picks ──\n");
    for (const [ref, n] of tally(choices, (c) => String(c.ref))) {
      const node = before.find((b) => b.ref === Number(ref));
      console.log(`  ${String(n).padStart(3)}  ${pct(n).padStart(4)}  ref ${ref} — ${node?.role} "${node?.name}"`);
    }

    // 2. One real action, many reflections on identical evidence.
    const choice = choices[0]!;
    const target = before.find((n) => n.ref === choice.ref);
    if (!target) throw new Error(`model chose ref ${choice.ref}, not present in the snapshot`);

    const timing = await page.click(target);
    const after = await page.snapshot();
    const reflections = await times(runs, () => reflect(choice, before, after, viewport));
    const withGap = reflections.filter((r) => r.gap.trim() !== "");

    console.log(`\n── whether it reports a gap ──\n`);
    console.log(`  ${withGap.length}/${runs} (${pct(withGap.length)}) reported a gap on identical evidence\n`);

    console.log("── which heuristics it names ──\n");
    const named = reflections.flatMap((r) => r.heuristics);
    if (!named.length) console.log("  — none —");
    for (const [h, n] of tally(named, (h) => h)) {
      console.log(`  ${String(n).padStart(3)}  ${pct(n).padStart(4)}  ${h}`);
    }

    console.log("\n── the gaps themselves ──\n");
    if (!withGap.length) console.log("  — none —");
    for (const r of withGap) {
      console.log(`  • ${r.gap.replace(/\s+/g, " ").slice(0, 140)}`);
      console.log(`    evidence: ${r.evidence.join(", ") || "— none cited —"}`);
    }

    const file = await saveCalibration(makeCalibrationRecord({
      url,
      goal,
      model: modelName(),
      viewport,
      before,
      choices,
      selectedAction: { choice, node: target, timing },
      after,
      reflections,
    }));
    console.error(`\ncalibration evidence → ${file}`);
  },
);
