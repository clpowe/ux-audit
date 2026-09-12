import type { CDP } from "./cdp";
import type { AxNode } from "./snapshot";

export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  rendered: boolean;
};

export type MeasuredNode = AxNode & { box: Box | null };

export async function measureNodes(
  cdp: CDP,
  sessionId: string,
  nodes: AxNode[],
): Promise<MeasuredNode[]> {
  await cdp.send("DOM.enable", {}, sessionId);
  await cdp.send("DOM.getDocument", { depth: -1, pierce: true }, sessionId);

  const out: MeasuredNode[] = [];

  for (const node of nodes) {
    if (node.backendDOMNodeId === undefined) {
      out.push({ ...node, box: null });
      continue;
    }

    try {
      const { model } = await cdp.send(
        "DOM.getBoxModel",
        { backendNodeId: node.backendDOMNodeId },
        sessionId,
      );
      const border = model.border;
      out.push({
        ...node,
        box: {
          x: Math.round(border[0]),
          y: Math.round(border[1]),
          width: Math.round(model.width),
          height: Math.round(model.height),
          rendered: model.width > 0 && model.height > 0,
        },
      });
    } catch {
      out.push({
        ...node,
        box: { x: 0, y: 0, width: 0, height: 0, rendered: false },
      });
    }
  }

  return out;
}

export async function layout(cdp: CDP, sessionId: string) {
  const { result } = await cdp.send(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      pageHeight: document.documentElement.scrollHeight,
    })`,
    },
    sessionId,
  );
  return result.value as {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    pageHeight: number;
  };
}
