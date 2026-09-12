import type { CDP } from "./cdp";
import { snapshot } from "./snapshot";
import { measureNodes, layout, type MeasuredNode } from "./geometry";

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

export async function clickNode(cdp: CDP, sessionId: string, node: MeasuredNode) {
  if (node.backendDOMNodeId !== undefined) {
    try {
      await cdp.send(
        "DOM.scrollIntoViewIfNeeded",
        { backendNodeId: node.backendDOMNodeId },
        sessionId,
      );
    } catch {
      // not scrollable
    }
  }

  const [fresh] = await measureNodes(cdp, sessionId, [node]);
  if (!fresh || !fresh.box?.rendered) throw new Error(`cannot click "${node.name}" — not rendered`);

  const view = await layout(cdp, sessionId);
  const x = fresh.box.x + fresh.box.width / 2 - view.scrollX;
  const y = fresh.box.y + fresh.box.height / 2 - view.scrollY;

  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x, y, button: "left", clickCount: 1 },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x, y, button: "left", clickCount: 1 },
    sessionId,
  );
}

export async function dismissOverlays(
  cdp: CDP,
  sessionId: string,
  maxRounds = 3,
): Promise<Overlay[]> {
  const dismissed: Overlay[] = [];
  for (let i = 0; i < 10; i++) {
    const probe = await snapshot(cdp, sessionId);
    if (probe.some((n) => n.role === "dialog" || n.role === "alertdialog")) break;
    await Bun.sleep(400);
  }

  for (let round = 0; round < maxRounds; round++) {
    const nodes = await snapshot(cdp, sessionId);
    const dialog = nodes.find((n) => n.role === "dialog" || n.role === "alertdialog");
    if (!dialog) break;

    const measured = await measureNodes(cdp, sessionId, nodes);
    const candidates = measured.filter(
      (n) => (n.role === "button" || n.role === "link") && n.ref > dialog.ref && n.box?.rendered,
    );

    let target: MeasuredNode | undefined;
    for (const pattern of DISMISS) {
      target = candidates.find((c) => pattern.test(c.name));
      if (target) break;
    }
    if (!target) break;

    await clickNode(cdp, sessionId, target);
    dismissed.push({ name: dialog.name || "⟨unnamed dialog⟩", dismissedWith: target.name });
    await Bun.sleep(600);
  }

  return dismissed;
}
