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

  // Preserve each Overlay's evidence from before its dismissal attempt, whether
  // the attempt succeeded or not. A later screenshot would describe a new state.
  let captured = 0;
  for (const f of findings) {
    if (!f.shot) continue;
    const file = `overlay-${String(++captured).padStart(2, "0")}.png`;
    await Bun.write(`${dir}/${file}`, f.shot);
    shots.set(f.id, file);
  }

  await page.highlight(highlightsFor(findings));

  const done = new Set<string>();

  const ordered = findings.filter((f) => f.box !== null).sort((a, b) => a.box!.y - b.box!.y);

  let n = 0;
  for (const anchor of ordered) {
    if (done.has(anchor.id)) continue;

    const top = Math.max(0, anchor.box!.y - 120);
    await page.scrollTo(top);

    // The Page may clamp the requested position near its end. Associate evidence
    // only after reading the actual viewport that the screenshot will capture.
    const view = await page.layout();
    const visible = ordered.filter((f) => {
      if (done.has(f.id) || !f.box) return false;
      const horizontallyVisible =
        f.box.x < view.scrollX + view.width && f.box.x + f.box.width > view.scrollX;
      const verticallyVisible =
        f.box.y < view.scrollY + view.height && f.box.y + f.box.height > view.scrollY;
      return horizontallyVisible && verticallyVisible;
    });
    if (!visible.length) continue;

    const file = `shot-${String(++n).padStart(2, "0")}.png`;
    await Bun.write(`${dir}/${file}`, await page.screenshot());

    for (const f of visible) {
      shots.set(f.id, file);
      done.add(f.id);
    }
  }

  await page.scrollTo(0);
  return shots;
}
