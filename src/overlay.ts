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

/** One dismissal attempt, with evidence and an explicitly verified outcome. */
export type DismissalResult = {
  name: string;
  attemptedWith: string;
  /** Evidence captured before the dismissal attempt. */
  shot: Uint8Array;
} & (
  | { status: "dismissed" }
  | { status: "remained" }
  | { status: "unverified"; reason: string }
);

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

/** Rendered descendant controls, stopping before a nested candidate Overlay. */
function controlsWithin(nodes: MeasuredNode[], root: MeasuredNode, roots: MeasuredNode[]) {
  const next = roots.find((r) => r.ref > root.ref);
  const outside = nodes.find((n) => n.ref > root.ref && n.depth <= root.depth);
  const end = Math.min(next?.ref ?? Infinity, outside?.ref ?? Infinity);
  return nodes.filter(
    (n) => (n.role === "button" || n.role === "link") && n.ref > root.ref && n.ref < end && n.box,
  );
}

async function verifyDismissal(
  page: Page,
  originalOverlay: Node,
  attempt: Pick<DismissalResult, "name" | "attemptedWith" | "shot">,
): Promise<DismissalResult> {
  try {
    const present = await page.isPresent(originalOverlay);
    return { ...attempt, status: present ? "remained" : "dismissed" };
  } catch (error) {
    let reason = "Inspection failed with an unreadable error";
    try {
      reason = error instanceof Error ? error.message : String(error);
    } catch {
      // Even a thrown value with no string representation must not abort the audit.
    }
    return { ...attempt, status: "unverified", reason };
  }
}

export async function dismissOverlays(page: Page, opts: DismissOptions = {}): Promise<DismissalResult[]> {
  const { maxRounds = 3, waitForDialogMs = 4000 } = opts;

  const deadline = Date.now() + waitForDialogMs;
  while (!(await page.snapshot()).some(isDialog) && Date.now() < deadline) {
    await Bun.sleep(400);
  }

  const attempts: DismissalResult[] = [];
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
    const attempt = {
      name: overlay.name || "⟨unnamed overlay⟩",
      attemptedWith: target.name,
      shot,
    };
    try {
      await page.click(target);
    } catch (error) {
      let reason = "Click failed with an unreadable error";
      try {
        reason = `Click failed: ${error instanceof Error ? error.message : String(error)}`;
      } catch {
        // Preserve the evidence even when the thrown value cannot be formatted.
      }
      attempts.push({ ...attempt, status: "unverified", reason });
      break;
    }
    const result = await verifyDismissal(page, overlay, attempt);
    attempts.push(result);
    // Stop dismissal attempts, not the audit. Repeated clicks on a control whose
    // outcome is unsuccessful or unknown can cause unintended actions.
    if (result.status !== "dismissed") break;
  }

  return attempts;
}
