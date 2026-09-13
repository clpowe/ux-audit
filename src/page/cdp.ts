import { CDP } from "./transport";
import { launchChrome } from "./chrome";
import type { Box, Highlight, Layout, MeasuredNode, Node, Page, SnapshotOptions } from "./page";

export type Viewport = {
  width: number;
  height: number;
  mobile: boolean;
  dpr: number;
};

export type SettleOptions = {
  loadMs: number;
  clickMs: number;
  scrollMs: number;
};

const DEFAULT_SETTLE: SettleOptions = { loadMs: 500, clickMs: 1200, scrollMs: 250 };

export type LaunchOptions = {
  url: string;
  viewport: Viewport;
  headless?: boolean;
  port?: number;
  settle?: Partial<SettleOptions>;
};

/** A running browser showing one Page. Navigation and teardown live here, outside the Page interface. */
export type CdpSession = {
  page: Page;
  goto(url: string): Promise<void>;
  close(): Promise<void>;
};

export async function launchPage(opts: LaunchOptions): Promise<CdpSession> {
  const settle = { ...DEFAULT_SETTLE, ...opts.settle };
  const chrome = await launchChrome({
    port: opts.port ?? Number(process.env.CDP_PORT ?? 9222),
    headless: opts.headless ?? false,
  });

  let cdp: CDP | undefined;
  const close = async () => {
    cdp?.close();
    await chrome.kill();
  };

  try {
    cdp = await CDP.connect(chrome.wsUrl);
    const sessionId = await openTab(cdp, opts.viewport);
    const goto = (url: string) => navigate(cdp!, sessionId, url, settle.loadMs);
    await goto(opts.url);
    return { page: new CdpPage(cdp, sessionId, settle), goto, close };
  } catch (err) {
    await close();
    throw err;
  }
}

async function openTab(cdp: CDP, vp: Viewport): Promise<string> {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile },
    sessionId,
  );
  return sessionId;
}

async function navigate(cdp: CDP, sessionId: string, url: string, settleMs: number) {
  const loaded = cdp.once("Page.loadEventFired", sessionId, 30_000);
  const nav = await cdp.send("Page.navigate", { url }, sessionId);
  if (nav.errorText) throw new Error(`navigation failed: ${url} — ${nav.errorText}`);
  await loaded;
  await Bun.sleep(settleMs);
}

const INTERACTIVE = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "treeitem",
  "DisclosureTriangle",
]);

const STRUCTURAL = new Set([
  "RootWebArea",
  "heading",
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "form",
  "search",
  "dialog",
  "alertdialog",
  "alert",
  "status",
  "list",
  "table",
  "region",
  "tablist",
  "tabpanel",
]);

const HIGHLIGHT_ROOT = "uxa-highlights";

class CdpPage implements Page {
  readonly #cdp: CDP;
  readonly #sessionId: string;
  readonly #settle: SettleOptions;

  constructor(cdp: CDP, sessionId: string, settle: SettleOptions) {
    this.#cdp = cdp;
    this.#sessionId = sessionId;
    this.#settle = settle;
  }

  snapshot(opts: SnapshotOptions & { boxes: true }): Promise<MeasuredNode[]>;
  snapshot(opts?: SnapshotOptions): Promise<Node[]>;
  async snapshot(opts: SnapshotOptions = {}): Promise<Node[] | MeasuredNode[]> {
    const nodes = await this.#walkTree(opts.all ?? false);
    if (!opts.boxes) return nodes;

    await this.#send("DOM.enable");
    await this.#send("DOM.getDocument", { depth: -1, pierce: true });
    const measured: MeasuredNode[] = [];
    for (const node of nodes) measured.push({ ...node, box: await this.#boxOf(node) });
    return measured;
  }

  async layout(): Promise<Layout> {
    return this.#evaluate(`({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      pageHeight: document.documentElement.scrollHeight,
    })`);
  }

  async click(node: Node): Promise<void> {
    const backendNodeId = handleOf(node);
    if (backendNodeId !== undefined) {
      try {
        await this.#send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
      } catch {
        // not scrollable, or gone; measuring below decides which
      }
    }

    const box = await this.#boxOf(node);
    if (!box) {
      throw new Error(
        `cannot click ${node.role} "${node.name}" — not rendered or no longer on the page`,
      );
    }

    const view = await this.layout();
    const x = box.x + box.width / 2 - view.scrollX;
    const y = box.y + box.height / 2 - view.scrollY;
    await this.#send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.#send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await Bun.sleep(this.#settle.clickMs);
  }

  async scrollTo(y: number): Promise<void> {
    await this.#evaluate(`window.scrollTo(0, ${Number(y)})`);
    await Bun.sleep(this.#settle.scrollMs);
    await this.#alignHighlights();
  }

  async prime(): Promise<void> {
    await this.#send(
      "Runtime.evaluate",
      {
        expression: `(async () => {
          const step = window.innerHeight;
          for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise(r => setTimeout(r, 120));
          }
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 300));
        })()`,
        awaitPromise: true,
      },
      60_000,
    );
    await this.#alignHighlights();
  }

  async highlight(highlights: Highlight[]): Promise<void> {
    const marks = highlights.map((h) => ({
      x: h.box.x,
      y: h.box.y,
      w: h.box.width,
      h: h.box.height,
      color: h.color,
      label: h.label,
    }));

    await this.#evaluate(`(() => {
      const marks = ${JSON.stringify(marks)};
      document.getElementById('${HIGHLIGHT_ROOT}')?.remove();
      const root = document.createElement('div');
      root.id = '${HIGHLIGHT_ROOT}';
      root.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none';
      for (const m of marks) {
        const o = document.createElement('div');
        o.style.cssText = 'position:absolute;pointer-events:none;left:' + m.x + 'px;top:' + m.y +
          'px;width:' + m.w + 'px;height:' + m.h + 'px;outline:2px solid ' + m.color +
          ';outline-offset:0;box-shadow:0 0 0 3px rgba(255,255,255,.55)';
        root.appendChild(o);
        if (m.label) {
          const b = document.createElement('div');
          b.textContent = m.label;
          b.style.cssText = 'position:absolute;pointer-events:none;left:' + m.x + 'px;top:' +
            Math.max(0, m.y - 19) + 'px;background:' + m.color +
            ';color:#fff;padding:1px 5px;border-radius:3px;white-space:nowrap;' +
            'font:700 11px/16px ui-monospace,SFMono-Regular,monospace';
          root.appendChild(b);
        }
      }
      document.body.appendChild(root);
    })()`);
    await this.#alignHighlights();
  }

  async screenshot(): Promise<Uint8Array> {
    const { data } = await this.#send("Page.captureScreenshot", { format: "png" });
    return new Uint8Array(Buffer.from(data, "base64"));
  }

  async #walkTree(all: boolean): Promise<Node[]> {
    await this.#send("Accessibility.enable");
    const { nodes } = await this.#send("Accessibility.getFullAXTree");

    const byId = new Map<string, any>(nodes.map((n: any) => [n.nodeId, n]));
    const root = nodes.find((n: any) => !n.parentId) ?? nodes[0];
    const prop = (node: any, name: string) =>
      node.properties?.find((p: any) => p.name === name)?.value?.value;

    const out: Node[] = [];
    const walk = (node: any, depth: number, parentName: string) => {
      const role = node.role?.value ?? "";
      const name = (node.name?.value ?? "").trim();
      // A child that only repeats its parent's name adds nothing a user perceives.
      const duplicate = name !== "" && name === parentName;
      const keep =
        !node.ignored && !duplicate && (all || INTERACTIVE.has(role) || STRUCTURAL.has(role));

      let childDepth = depth;
      if (keep) {
        out.push({
          ref: out.length,
          role,
          name,
          value: node.value?.value,
          disabled: prop(node, "disabled"),
          focused: prop(node, "focused"),
          depth,
          handle: node.backendDOMNodeId,
        });
        childDepth = depth + 1;
      }

      for (const cid of node.childIds ?? []) {
        const child = byId.get(cid);
        if (child) walk(child, childDepth, name || parentName);
      }
    };

    if (root) walk(root, 0, "");
    return out;
  }

  /** Null when the Node has no layout box, a zero-size one, or is no longer in the DOM. */
  async #boxOf(node: Node): Promise<Box | null> {
    const backendNodeId = handleOf(node);
    if (backendNodeId === undefined) return null;
    try {
      const { model } = await this.#send("DOM.getBoxModel", { backendNodeId });
      const width = Math.round(model.width);
      const height = Math.round(model.height);
      if (width <= 0 || height <= 0) return null;
      return { x: Math.round(model.border[0]), y: Math.round(model.border[1]), width, height };
    } catch {
      return null;
    }
  }

  // The highlight root is position:fixed, so marks drawn in page coordinates
  // are shifted by the current scroll offset to stay over their elements.
  #alignHighlights() {
    return this.#evaluate(`(() => {
      const o = document.getElementById('${HIGHLIGHT_ROOT}');
      if (o) o.style.transform =
        'translate(' + (-window.scrollX) + 'px,' + (-window.scrollY) + 'px)';
    })()`);
  }

  async #evaluate(expression: string): Promise<any> {
    const { result } = await this.#send("Runtime.evaluate", { expression, returnByValue: true });
    return result.value;
  }

  #send(method: string, params: object = {}, timeoutMs?: number): Promise<any> {
    return this.#cdp.send(method, params, this.#sessionId, timeoutMs);
  }
}

const handleOf = (node: Node): number | undefined =>
  typeof node.handle === "number" ? node.handle : undefined;
