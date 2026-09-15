import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page as BrowserPage } from "playwright";
import type { Box, Highlight, Layout, MeasuredNode, Node, Page, SnapshotOptions, Timing } from "./page";

export type Viewport = { width: number; height: number; mobile: boolean; dpr: number };
export type LaunchOptions = { url: string; viewport: Viewport; headless?: boolean };
export type PlaywrightSession = { page: Page; goto(url: string): Promise<void>; close(): Promise<void> };

type AriaNode = {
  role?: string; name?: string; value?: string; text?: string; disabled?: boolean; focused?: boolean;
  ref?: string; children?: AriaNode[];
};

const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio", "switch", "slider", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem"]);
const STRUCTURAL = new Set(["heading", "navigation", "main", "banner", "contentinfo", "complementary", "form", "search", "dialog", "alertdialog", "alert", "status", "list", "table", "region", "tablist", "tabpanel"]);
const HIGHLIGHTS = "uxa-highlights";
const TARGET_CLOSED = /Target (?:page, context or browser has been closed|closed|crashed)|(?:page|context|browser) has been closed|page crashed/i;

export async function launchPage(opts: LaunchOptions): Promise<PlaywrightSession> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: opts.headless ?? false });
    context = await browser.newContext({
      viewport: { width: opts.viewport.width, height: opts.viewport.height },
      deviceScaleFactor: opts.viewport.dpr,
      isMobile: opts.viewport.mobile,
      acceptDownloads: false,
    });
    context.setDefaultTimeout(1_500);
    const browserPage = await context.newPage();
    // Preserve the most specific lifecycle event; these events do not establish
    // why the renderer crashed or the browser disconnected.
    let closure: { rank: number; reason: string } | undefined;
    const record = (rank: number, reason: string) => { if (!closure || rank < closure.rank) closure = { rank, reason }; };
    browserPage.on("crash", () => record(0, "the page crashed"));
    browser.on("disconnected", () => record(1, "the browser disconnected"));
    context.on("close", () => record(2, "the browser context was closed"));
    browserPage.on("close", () => record(3, "the page was closed"));
    const goto = async (url: string) => {
      await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await browserPage.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
    };
    await goto(opts.url);
    return {
      page: new PlaywrightPage(browserPage, () => closure?.reason),
      goto,
      close: async () => { await context?.close(); await browser?.close(); },
    };
  } catch (error) {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    throw error;
  }
}

class PlaywrightPage implements Page {
  constructor(private readonly browserPage: BrowserPage, private readonly closure: () => string | undefined = () => undefined) {}

  private closedError(cause?: unknown): Error {
    return new Error(`the browser session ended mid-audit: ${this.closure() ?? "the page, context, or browser was closed"}`, { cause });
  }

  /** Turns Playwright's generic target-closed rejection into one that names the cause. */
  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closure() || this.browserPage.isClosed()) throw this.closedError();
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      if (!this.closure() && !this.browserPage.isClosed() && !TARGET_CLOSED.test(String(error))) throw error;
      throw this.closedError(error);
    }
    if (this.closure() || this.browserPage.isClosed()) throw this.closedError();
    return result;
  }

  snapshot(opts: SnapshotOptions & { boxes: true }): Promise<MeasuredNode[]>;
  snapshot(opts?: SnapshotOptions): Promise<Node[]>;
  snapshot(opts: SnapshotOptions = {}): Promise<Node[] | MeasuredNode[]> {
    return this.guard(() => this.snapshotFrames(opts));
  }

  private async snapshotFrames(opts: SnapshotOptions): Promise<Node[] | MeasuredNode[]> {
    const nodes: Node[] = [];
    for (const frame of this.browserPage.frames()) {
      const start = nodes.length;
      try {
        const body = frame.locator("body");
        if (!await body.count()) continue;
        nodes.push({ ref: nodes.length, role: "RootWebArea", name: await frame.title().catch(() => ""), depth: 0, handle: body });
        const tree = await body.ariaSnapshotJSON({ mode: "ai" }) as AriaNode[];
        this.collect(frame, tree, nodes, opts.all ?? false, 1);
      } catch (error) {
        if (frame === this.browserPage.mainFrame()) throw error;
        // Child targets can close before Playwright marks the frame detached.
        // Discard any partial frame tree, including its root, before continuing.
        // The outer guard still rejects if the whole session ended.
        if (frame.isDetached() || TARGET_CLOSED.test(String(error))) {
          nodes.length = start;
          continue;
        }
        throw error;
      }
    }
    if (!opts.boxes) return nodes;
    const view = await this.layout();
    return Promise.all(nodes.map(async (node): Promise<MeasuredNode> => {
      try {
        const box = await locatorOf(node).boundingBox();
        return box
          ? { ...node, measurement: "measured", box: { x: Math.round(box.x + view.scrollX), y: Math.round(box.y + view.scrollY), width: Math.round(box.width), height: Math.round(box.height) } }
          : { ...node, measurement: "not-rendered", box: null };
      } catch (error) {
        return { ...node, measurement: "unavailable", box: null, measurementError: String(error) };
      }
    }));
  }

  private collect(frame: Frame, items: AriaNode[], out: Node[], all: boolean, depth: number): void {
    for (const item of items) {
      // Child frames are collected separately with their own resolvable references.
      if (item.role === "iframe") continue;
      const role = item.role ?? "";
      const name = item.name?.trim() || item.text?.trim() || "";
      const keep = Boolean(item.ref) && (all || INTERACTIVE.has(role) || STRUCTURAL.has(role));
      const childDepth = keep ? depth + 1 : depth;
      if (keep) out.push({ ref: out.length, role, name, value: item.value ?? item.text, disabled: item.disabled, focused: item.focused, depth, handle: frame.locator(`aria-ref=${item.ref}`) });
      if (item.children) this.collect(frame, item.children, out, all, childDepth);
    }
  }

  layout(): Promise<Layout> {
    return this.guard(() => this.browserPage.evaluate(() => ({ scrollX, scrollY, width: innerWidth, height: innerHeight, pageHeight: document.documentElement.scrollHeight })));
  }

  isPresent(node: Node): Promise<boolean> {
    return this.guard(async () => {
      const locator = locatorOf(node);
      try {
        return await locator.count() > 0 && await locator.isVisible();
      } catch (error) {
        if (/frame.*detached|frame was detached/i.test(String(error))) return false;
        throw error;
      }
    });
  }

  click(node: Node): Promise<Timing> { return this.guard(() => this.act("click", node, (locator) => locator.click())); }
  type(node: Node, text: string): Promise<Timing> { return this.guard(() => this.act("type into", node, (locator) => locator.fill(text))); }

  private async act(verb: string, node: Node, action: (locator: Locator) => Promise<void>): Promise<Timing> {
    const start = performance.now();
    const locator = locatorOf(node);
    try {
      if (!await locator.count() || !await locator.isVisible()) throw new Error("not rendered or no longer on the page");
      await action(locator);
      const elapsed = Math.round(performance.now() - start);
      await this.browserPage.waitForLoadState("domcontentloaded", { timeout: 1_000 }).catch(() => {});
      return { respondedMs: elapsed, settledMs: elapsed, respondedWith: "mutation" };
    } catch (error) {
      // A gone browser must not be reported as a gone element: the journey
      // retries past a missing element, but there is nothing left to retry on.
      if (TARGET_CLOSED.test(String(error)) || this.closure() || this.browserPage.isClosed()) throw error;
      const absent = !await locator.count().catch(() => 0) || !await locator.isVisible().catch(() => false);
      throw new Error(`cannot ${verb} ${node.role} "${node.name}" — ${absent ? "not rendered or no longer on the page" : String(error)}`);
    }
  }

  scrollTo(y: number): Promise<void> {
    return this.guard(async () => {
      await this.browserPage.evaluate((top) => scrollTo(0, top), y);
      await this.browserPage.waitForTimeout(100);
    });
  }

  prime(): Promise<void> {
    return this.guard(async () => {
      await this.browserPage.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
          scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        scrollTo(0, 0);
      });
    });
  }

  highlight(highlights: Highlight[]): Promise<void> {
    return this.guard(async () => {
      await this.browserPage.evaluate(({ id, highlights }) => {
        document.getElementById(id)?.remove();
        const root = document.createElement("div");
        root.id = id;
        root.style.cssText = "position:absolute;inset:0;z-index:2147483647;pointer-events:none";
        for (const mark of highlights) {
          const item = document.createElement("div");
          item.textContent = mark.label;
          item.style.cssText = `position:absolute;left:${mark.box.x}px;top:${mark.box.y}px;width:${mark.box.width}px;height:${mark.box.height}px;outline:2px solid ${mark.color};color:white;background:${mark.color};font:700 11px monospace`;
          root.appendChild(item);
        }
        document.body.appendChild(root);
      }, { id: HIGHLIGHTS, highlights });
    });
  }

  screenshot(): Promise<Uint8Array> { return this.guard(async () => new Uint8Array(await this.browserPage.screenshot({ type: "png" }))); }
}

function locatorOf(node: Node): Locator {
  if (node.handle && typeof node.handle === "object" && "click" in node.handle) return node.handle as Locator;
  throw new Error(`cannot inspect ${node.role} "${node.name}" — no Playwright locator`);
}
