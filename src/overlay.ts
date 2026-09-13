import type { MeasuredNode, Node, Page } from "./page/page";

const DISMISS = [
  /^accept all/i,
  /^accept\b/i,
  /^agree/i,
  /^allow all/i,
  /^got it/i,
  /^ok$/i,
  /^close$/i,
  /^dismiss/i,
  /^no thanks/i,
];

export type Overlay = { name: string; dismissedWith: string };

export type DismissOptions = {
  maxRounds?: number;
  /** How long to keep looking for an Overlay that appears after load. */
  waitForDialogMs?: number;
};

const isDialog = (n: Node) => n.role === "dialog" || n.role === "alertdialog";

export async function dismissOverlays(page: Page, opts: DismissOptions = {}): Promise<Overlay[]> {
  const { maxRounds = 3, waitForDialogMs = 4000 } = opts;

  const deadline = Date.now() + waitForDialogMs;
  while (!(await page.snapshot()).some(isDialog) && Date.now() < deadline) {
    await Bun.sleep(400);
  }

  const dismissed: Overlay[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const nodes = await page.snapshot({ boxes: true });
    const dialog = nodes.find(isDialog);
    if (!dialog) break;

    const candidates = nodes.filter(
      (n) => (n.role === "button" || n.role === "link") && n.ref > dialog.ref && n.box,
    );

    let target: MeasuredNode | undefined;
    for (const pattern of DISMISS) {
      target = candidates.find((c) => pattern.test(c.name));
      if (target) break;
    }
    if (!target) break;

    await page.click(target);
    dismissed.push({ name: dialog.name || "⟨unnamed dialog⟩", dismissedWith: target.name });
  }

  return dismissed;
}
