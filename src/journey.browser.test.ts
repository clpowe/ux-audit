import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { launchPage } from "./page/playwright";
import { VIEWPORTS } from "./sessions";
import { journeyMarkdown, runJourney, type Decision, type JourneyInput } from "./journey";
import { dismissOverlays } from "./overlay";

const html = `<!doctype html><html lang="en"><title>Journey test shop</title>
<body style="font:20px system-ui;padding:40px">
<h1>Test furniture shop</h1>
<input type="search" aria-label="Search products">
<button onclick="document.querySelector('#product').hidden=false">Search</button>
<section id="product" hidden><h2>Washable sofa</h2><p>Listed price $999</p><p>Delivery October 1, 2026</p>
<p role="note" aria-label="Delivery date unavailable">Delivery date unavailable</p>
<button onclick="document.querySelector('#cart').hidden=false">Add to cart</button></section>
<section id="cart" hidden><h2>Sofa added to cart</h2>
<button onclick="document.body.innerHTML='<h1>Checkout entered</h1>'">Checkout</button></section>
</body></html>`;

test("real browser: search, add to cart, save an illustrated report, and stop", async () => {
  const session = await launchPage({ url: `data:text/html,${encodeURIComponent(html)}`, viewport: VIEWPORTS.desktop, headless: true });
  const input: JourneyInput = { url: "local test storefront", task: "buy a sofa", persona: "New Mother", needs: "Clear delivery information" };
  const directory = resolve("out", "journeys", "browser-smoke");
  await mkdir(directory, { recursive: true });
  try {
    const result = await runJourney(session.page, input, async ({ nodes, steps, screenshot }) => {
      expect(screenshot?.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      const ref = (name: string) => {
        const node = nodes.find((candidate) => candidate.name === name);
        if (!node) throw new Error(`Missing fixture control: ${name}`);
        return node.ref;
      };
      const base: Decision = { action: "blocked", ref: null, text: null, direction: null, reason: "Controlled browser test", evidence: [], observations: [] };
      if (steps.length === 0) return { ...base, action: "type", ref: ref("Search products"), text: "sofa" };
      if (steps.length === 1) {
        expect(nodes.find((node) => node.name === "Search products")?.value).toBe("sofa");
        return { ...base, action: "click", ref: ref("Search") };
      }
      if (steps.length === 2) {
        expect(nodes.some((node) => node.name === "Listed price $999")).toBe(true);
        expect(nodes.some((node) => node.name === "Delivery October 1, 2026")).toBe(true);
        return { ...base, action: "click", ref: ref("Add to cart"), observations: [{ problem: "Delivery date is unavailable on the product view.", impact: "Makes delivery planning uncertain.", evidence: [ref("Delivery date unavailable")] }] };
      }
      return { ...base, action: "added_to_cart", evidence: [ref("Sofa added to cart")] };
    }, async (number, bytes) => {
      const name = `step-${number}.png`;
      await writeFile(resolve(directory, name), bytes);
      return name;
    });
    if (result.status === "error") throw new Error(result.reason);
    expect(result.status).toBe("added_to_cart");
    expect(result.steps.filter((step) => step.executed)).toHaveLength(3);
    expect(result.steps).toHaveLength(4);
    expect((await session.page.snapshot()).some((node) => node.name === "Checkout entered")).toBe(false);
    const report = journeyMarkdown(result);
    expect(report).toContain("Delivery date is unavailable");
    expect(report).toContain("![Page at step 3](step-3.png)");
    await writeFile(resolve(directory, "report.md"), report);
    await writeFile(resolve(directory, "report.json"), JSON.stringify(result, null, 2));
  } finally {
    await session.close();
  }
}, 30_000);

test("real browser: dismisses an iframe modal after scrolling the main page", async () => {
  const frame = `<body style="margin:0"><button aria-label="Close Modal" style="margin:40px;width:160px;height:50px" onclick="parent.document.querySelector('iframe').remove()"><span>No thank you</span></button></body>`;
  const fixture = `<body style="height:3000px;margin:0"><h1>Product</h1><iframe title="Promotion" style="position:fixed;left:150px;top:120px;width:400px;height:300px" srcdoc="${frame.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></body>`;
  const session = await launchPage({ url: `data:text/html,${encodeURIComponent(fixture)}`, viewport: VIEWPORTS.desktop, headless: true });
  try {
    await session.page.scrollTo(900);
    const nodes = await session.page.snapshot({ all: true });
    const close = nodes.find((node) => node.role === "button" && node.name === "Close Modal");
    expect(close).toBeDefined();
    await session.page.click(close!);
    expect((await session.page.snapshot({ all: true })).some((node) => node.name === "Close Modal")).toBe(false);
  } finally {
    await session.close();
  }
}, 30_000);

test("real browser: overlay workflow verifies iframe dismissal", async () => {
  const frame = `<body><button aria-label="Close Modal" onclick="parent.document.querySelector('iframe').remove()">Close</button></body>`;
  const fixture = `<body><h1>Product</h1><iframe title="Promotion" srcdoc="${frame.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></body>`;
  const session = await launchPage({ url: `data:text/html,${encodeURIComponent(fixture)}`, viewport: VIEWPORTS.desktop, headless: true });
  try {
    const results = await dismissOverlays(session.page, { waitForDialogMs: 0 });
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("dismissed");
  } finally {
    await session.close();
  }
}, 30_000);
