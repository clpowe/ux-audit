import type { MeasuredNode, Node, Page } from "./page/page";

const DISMISS = [
  /^accept all/i,
  /^accept\b/i,
  /^agree/i,
  /^allow all/i,
  /^got it/i,
  /^ok$/i,
  /^close\b/i,
  /^dismiss/i,
  /^no thanks/i,
];

export type Overlay = {
  name: string;
  dismissedWith: string;
  shot: Uint8Array;
};

export type DismissOptions = {
  maxRounds?: number;
  /** How long to keep looking for an Overlay that appears after load. */
  waitForDialogMs?: number;
};

const isDialog = (n: Node) => n.role === "dialog" || n.role === "alertdialog";

/**
 * Containers that hold something laid over the page: declared dialogs, and embedded
 * documents. A RootWebArea after the first one is an iframe — a separate document
 * drawn on top of the page, which is what a third-party lightbox or widget is.
 * Returned in snapshot order, outermost first.
 */
function overlayRoots(nodes: MeasuredNode[]): MeasuredNode[] {
  let seenPage = false;
  return nodes.filter((n) => {
    if (isDialog(n)) return true;
    if (n.role !== "RootWebArea") return false;
    if (!seenPage) {
      seenPage = true; // the page's own document, not an overlay
      return false;
    }
    return true;
  });
}

/** The rendered controls belonging to `root`, up to wherever the next overlay begins. */
function controlsWithin(nodes: MeasuredNode[], root: MeasuredNode, roots: MeasuredNode[]) {
  const next = roots.find((r) => r.ref > root.ref);
  const end = next ? next.ref : Infinity;
  return nodes.filter(
    (n) => (n.role === "button" || n.role === "link") && n.ref > root.ref && n.ref < end && n.box,
  );
}

export async function dismissOverlays(page: Page, opts: DismissOptions = {}): Promise<Overlay[]> {
  const { maxRounds = 3, waitForDialogMs = 4000 } = opts;

  const deadline = Date.now() + waitForDialogMs;
  while (!(await page.snapshot()).some(isDialog) && Date.now() < deadline) {
    await Bun.sleep(400);
  }

  const dismissed: Overlay[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const nodes = await page.snapshot({ boxes: true });
    const roots = overlayRoots(nodes);

    // An embedded document may be a tracking pixel rather than a lightbox, so an
    // overlay with nothing dismissable in it is skipped, not taken as the end.
    let overlay: MeasuredNode | undefined;
    let target: MeasuredNode | undefined;
    for (const root of roots) {
      const controls = controlsWithin(nodes, root, roots);
      for (const pattern of DISMISS) {
        target = controls.find((c) => pattern.test(c.name));
        if (target) break;
      }
      if (target) {
        overlay = root;
        break;
      }
    }
    if (!overlay || !target) break;

    const shot = await page.screenshot();
    await page.click(target);
    dismissed.push({
      name: overlay.name || "⟨unnamed overlay⟩",
      dismissedWith: target.name,
      shot,
    });
  }

  return dismissed;
}
