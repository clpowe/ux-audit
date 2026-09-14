import type { GroupedFinding } from "./group";
import type { Highlight, Page } from "./page/page";

const COLOR: Record<number, string> = {
  4: "#dc2626",
  3: "#ea580c",
  2: "#ca8a04",
  1: "#6b7280",
};

const highlightsFor = (findings: GroupedFinding[]): Highlight[] =>
  findings.flatMap((f) =>
    f.boxes.map((box, i) => ({
      box,
      color: COLOR[f.severity] ?? "#6b7280",
      label: i === 0 ? f.id : "",
    })),
  );

/**
 * Writes out any evidence captured earlier, then highlights every Finding and
 * screenshots the Page top to bottom so each Finding with a box lands in one shot.
 * Returns Finding id → screenshot file name.
 */
export async function captureShots(
  page: Page,
  findings: GroupedFinding[],
  dir: string,
): Promise<Map<string, string>> {
  const shots = new Map<string, string>();

  // An overlay was photographed before it was dismissed. Nothing on the page shows
  // it now, so these bytes are the only record of it and cannot be re-taken here.
  let captured = 0;
  for (const f of findings) {
    if (!f.shot) continue;
    const file = `overlay-${String(++captured).padStart(2, "0")}.png`;
    await Bun.write(`${dir}/${file}`, f.shot);
    shots.set(f.id, file);
  }

  await page.highlight(highlightsFor(findings));

  const view = await page.layout();
  const done = new Set<string>();

  const ordered = findings.filter((f) => f.box !== null).sort((a, b) => a.box!.y - b.box!.y);

  let n = 0;
  for (const anchor of ordered) {
    if (done.has(anchor.id)) continue;

    const top = Math.max(0, anchor.box!.y - 120);
    await page.scrollTo(top);

    const file = `shot-${String(++n).padStart(2, "0")}.png`;
    await Bun.write(`${dir}/${file}`, await page.screenshot());

    for (const f of ordered) {
      if (done.has(f.id) || !f.box) continue;
      if (f.box.y >= top && f.box.y + f.box.height <= top + view.height) {
        shots.set(f.id, file);
        done.add(f.id);
      }
    }
    if (!done.has(anchor.id)) {
      shots.set(anchor.id, file);
      done.add(anchor.id);
    }
  }

  await page.scrollTo(0);
  return shots;
}
