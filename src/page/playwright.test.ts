import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { EventEmitter } from "node:events";
import type { Locator, Page as BrowserPage } from "playwright";
import { launchPage, type PlaywrightSession } from "./playwright";
import type { Node } from "./page";
import { runJourney, type Decision } from "../journey";

const TARGET_CLOSED = "count: Target page, context or browser has been closed";
const fixture = `<title>Storefront</title><body>
  <button onclick="this.remove()">Close cookies</button><h1>Sofas</h1>
  <iframe title="Promotion" srcdoc="<title>Promotion</title><button>Frame control</button>"></iframe>
</body>`;

describe("Playwright target lifecycle", () => {
  let session: PlaywrightSession;
  let browserPage: BrowserPage;
  let nodes: Node[];

  beforeEach(async () => {
    session = await launchPage({
      url: `data:text/html,${encodeURIComponent(fixture)}`,
      viewport: { width: 800, height: 600, mobile: false, dpr: 1 },
      headless: true,
    });
    nodes = await session.page.snapshot();
    browserPage = (nodes[0]!.handle as Locator).page();
  });

  afterEach(async () => { await session?.close(); });

  test("cookie dismissal survives a child frame detaching during the next snapshot", async () => {
    const frame = browserPage.frames().find((frame) => frame !== browserPage.mainFrame())!;
    const body = frame.locator("body");
    const snapshot = body.ariaSnapshotJSON.bind(body);
    let reads = 0;
    spyOn(body, "ariaSnapshotJSON").mockImplementation(async (options) => {
      if (++reads === 2) {
        await (await frame.frameElement()).evaluate((element) => element.parentNode?.removeChild(element));
      }
      return snapshot(options);
    });
    const locator = frame.locator.bind(frame);
    spyOn(frame, "locator").mockImplementation((selector, options) => selector === "body" ? body : locator(selector, options));

    const decision: Decision = { action: "blocked", ref: null, text: null, direction: null, reason: "Fixture complete", evidence: [], observations: [] };
    const result = await runJourney(session.page,
      { url: "local storefront", task: "buy a sofa", persona: "New Mother", needs: "Clear search" },
      async ({ nodes, steps }) => steps.length === 0
        ? { ...decision, action: "click", ref: nodes.find((node) => node.name === "Close cookies")!.ref }
        : decision,
      async () => "fixture.png",
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("Fixture complete");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.executed).toBe(true);
    expect(result.steps[1]?.nodes.some((node) => node.name === "Sofas")).toBe(true);
    expect(result.steps[1]?.nodes.some((node) => node.name === "Promotion")).toBe(false);
    expect(result.steps[1]?.nodes.some((node) => node.name === "Close cookies")).toBe(false);
    result.steps[1]?.nodes.forEach((node, index) => expect(node.ref).toBe(index));
  });

  test("a closed child target is skipped before its detached event arrives", async () => {
    const frame = browserPage.frames().find((frame) => frame !== browserPage.mainFrame())!;
    const body = frame.locator("body");
    spyOn(body, "count").mockRejectedValue(new Error(TARGET_CLOSED));
    spyOn(frame, "locator").mockReturnValue(body);

    const snapshot = await session.page.snapshot();
    expect(frame.isDetached()).toBe(false);
    expect(snapshot.some((node) => node.name === "Sofas")).toBe(true);
    expect(snapshot.filter((node) => node.role === "RootWebArea")).toHaveLength(1);
  });

  test("a main-frame target error cannot become an empty successful snapshot", async () => {
    const frame = browserPage.mainFrame();
    const body = frame.locator("body");
    const failure = new Error(TARGET_CLOSED);
    spyOn(body, "count").mockRejectedValue(failure);
    spyOn(frame, "locator").mockReturnValue(body);

    expect(browserPage.isClosed()).toBe(false);
    await expect(session.page.snapshot()).rejects.toThrow(/session ended/);
  });

  test("an unrelated child inspection failure remains an error", async () => {
    const frame = browserPage.frames().find((frame) => frame !== browserPage.mainFrame())!;
    const body = frame.locator("body");
    const failure = new Error("Inspection protocol failed");
    spyOn(body, "count").mockRejectedValue(failure);
    spyOn(frame, "locator").mockReturnValue(body);
    await expect(session.page.snapshot()).rejects.toBe(failure);
  });

  test("presence handles detachment during the asynchronous visibility check", async () => {
    const node = nodes.find((node) => node.name === "Frame control")!;
    spyOn(node.handle as Locator, "isVisible").mockRejectedValue(new Error("Frame was detached"));
    expect(await session.page.isPresent(node)).toBe(false);
  });

  test("all page operations report an ended browser session after close", async () => {
    const button = nodes.find((node) => node.name === "Close cookies")!;
    await session.close();
    const operations = [
      () => session.page.snapshot(),
      () => session.page.snapshot({ boxes: true }),
      () => session.page.isPresent(button),
      () => session.page.click(button),
      () => session.page.type(button, "sofa"),
      () => session.page.layout(),
      () => session.page.scrollTo(100),
      () => session.page.prime(),
      () => session.page.highlight([]),
      () => session.page.screenshot(),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toThrow(/session ended.*browser disconnected/);
    }
  });

  test("a crash is fatal even while isClosed is false and names only the observed event", async () => {
    (browserPage as BrowserPage & EventEmitter).emit("crash", browserPage);
    expect(browserPage.isClosed()).toBe(false);
    await expect(session.page.snapshot()).rejects.toThrow(/session ended mid-audit: the page crashed$/);
  });

  test("a browser closing after a click preserves the executed step and stops the journey", async () => {
    const click = session.page.click.bind(session.page);
    spyOn(session.page, "click").mockImplementation(async (node) => {
      const timing = await click(node);
      await session.close();
      return timing;
    });
    const decide = async ({ nodes }: { nodes: Node[] }): Promise<Decision> => ({
      action: "click", ref: nodes.find((node) => node.name === "Close cookies")!.ref,
      text: null, direction: null, reason: "Dismiss cookies", evidence: [], observations: [],
    });
    const result = await runJourney(session.page,
      { url: "local storefront", task: "buy a sofa", persona: "New Mother", needs: "Clear search" },
      decide, async () => "fixture.png",
    );
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/session ended/);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.executed).toBe(true);
    expect(result.steps[0]?.actionError).toBeUndefined();
  });
});
