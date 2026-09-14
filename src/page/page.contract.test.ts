import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { findChrome } from "./chrome";
import { launchPage, type CdpSession } from "./cdp";
import { FakePage } from "./fake";
import type { Node, Page } from "./page";

// One scenario, expressed once as real HTML and once as FakePage fixtures.
// Both adapters must pass the same suite, or tests written against FakePage lie.

const CONSENT_HTML = `<!doctype html>
<html><body style="margin:0;height:3000px">
  <div id="banner" role="dialog" aria-label="Cookies"
       style="position:fixed;top:0;left:0;width:300px;padding:10px;background:#eee">
    <button style="width:120px;height:44px" onclick="document.getElementById('banner').remove()">Accept all</button>
    <button style="width:120px;height:44px">Read more</button>
  </div>
  <input type="search" aria-label="Query" autocomplete="off"
         style="position:absolute;top:300px;width:200px;height:44px">
  <button style="position:absolute;top:200px;width:0;height:0;overflow:hidden;padding:0;border:0">Ghost</button>
</body></html>`;

const consentFake = () =>
  new FakePage({
    initial: "consent",
    states: {
      consent: {
        pageHeight: 3000,
        nodes: [
          { role: "dialog", name: "Cookies" },
          { role: "button", name: "Accept all", depth: 1 },
          { role: "button", name: "Read more", depth: 1 },
          { role: "searchbox", name: "Query" },
          { role: "button", name: "Ghost", box: null },
        ],
      },
      accepted: {
        pageHeight: 3000,
        nodes: [
          { role: "searchbox", name: "Query" },
          { role: "button", name: "Ghost", box: null },
        ],
      },
    },
    transitions: { consent: { "button:Accept all": "accepted" } },
  });

function find<N extends Node>(nodes: N[], role: string, name: string): N {
  const node = nodes.find((n) => n.role === role && n.name === name);
  if (!node) throw new Error(`no ${role} "${name}" in snapshot`);
  return node;
}

function contract(label: string, makePage: () => Promise<Page>) {
  describe(label, () => {
    let page: Page;
    beforeEach(async () => {
      page = await makePage();
    });

    test("snapshot perceives the dialog and its buttons", async () => {
      const nodes = await page.snapshot();
      find(nodes, "dialog", "Cookies");
      find(nodes, "button", "Accept all");
      find(nodes, "button", "Read more");
    });

    test("refs are positions within the snapshot", async () => {
      const nodes = await page.snapshot();
      nodes.forEach((n, i) => expect(n.ref).toBe(i));
    });

    test("snapshot without boxes carries no box", async () => {
      const accept = find(await page.snapshot(), "button", "Accept all");
      expect("box" in accept).toBe(false);
    });

    test("snapshot with boxes measures rendered nodes and nulls unrendered ones", async () => {
      const nodes = await page.snapshot({ boxes: true });
      const accept = find(nodes, "button", "Accept all");
      expect(accept.box).not.toBeNull();
      expect(accept.box!.width).toBeGreaterThan(0);
      expect(find(nodes, "button", "Ghost").box).toBeNull();
    });

    test("click changes what the page perceives", async () => {
      await page.click(find(await page.snapshot(), "button", "Accept all"));
      const after = await page.snapshot();
      expect(after.some((n) => n.role === "dialog")).toBe(false);
    });

    test("click on a node that is no longer on the page throws, naming it", async () => {
      const accept = find(await page.snapshot(), "button", "Accept all");
      await page.click(accept);
      await expect(page.click(accept)).rejects.toThrow(/Accept all/);
    });

    test("click on an unrendered node throws, naming it", async () => {
      const ghost = find(await page.snapshot(), "button", "Ghost");
      await expect(page.click(ghost)).rejects.toThrow(/Ghost/);
    });

    test("scrollTo moves the viewport", async () => {
      await page.scrollTo(300);
      const view = await page.layout();
      expect(view.scrollY).toBe(300);
      expect(view.pageHeight).toBeGreaterThanOrEqual(3000);
    });

    test("prime returns to the top", async () => {
      await page.scrollTo(300);
      await page.prime();
      expect((await page.layout()).scrollY).toBe(0);
    });

    test("highlight and screenshot do not disturb perception", async () => {
      const accept = find(await page.snapshot({ boxes: true }), "button", "Accept all");
      await page.highlight([{ box: accept.box!, color: "#dc2626", label: "F-01" }]);
      const shot = await page.screenshot();
      expect(shot).toBeInstanceOf(Uint8Array);
      find(await page.snapshot(), "button", "Accept all");
    });

    // The negative case — a click that provokes nothing — is deliberately not in the
    // contract. On a real browser any focusable target fires focusin, so "no response"
    // depends on Chrome's focus fallback rather than on the Page interface.
    test("type puts the text into the control", async () => {
      const query = find(await page.snapshot(), "searchbox", "Query");
      await page.type(query, "sofa");
      expect(find(await page.snapshot(), "searchbox", "Query").value).toBe("sofa");
    });

    // The counterpart that click cannot have: a bare input answers keystrokes with
    // nothing at all, so "no response" is observable here rather than browser-dependent.
    test("typing into a control that does not answer reports no response", async () => {
      const query = find(await page.snapshot(), "searchbox", "Query");
      const timing = await page.type(query, "sofa");
      expect(timing.respondedMs).toBeNull();
      expect(timing.settledMs).toBeNull();
      expect(timing.respondedWith).toBeNull();
    });

    test("type on an unrendered node throws, naming it", async () => {
      const ghost = find(await page.snapshot(), "button", "Ghost");
      await expect(page.type(ghost, "sofa")).rejects.toThrow(/Ghost/);
    });

    test("click reports that the page responded, and with what", async () => {
      const timing = await page.click(find(await page.snapshot(), "button", "Accept all"));
      expect(timing.respondedMs).not.toBeNull();
      expect(timing.respondedMs!).toBeGreaterThanOrEqual(0);
      expect(timing.respondedWith).not.toBeNull();
    });
  });
}

contract("FakePage", async () => consentFake());

const chromePath = await findChrome().catch(() => null);

describe.skipIf(!chromePath)("CdpPage", () => {
  let server: ReturnType<typeof Bun.serve>;
  let session: CdpSession;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response(CONSENT_HTML, { headers: { "content-type": "text/html" } }),
    });
    session = await launchPage({
      url: "about:blank",
      viewport: { width: 390, height: 844, mobile: true, dpr: 1 },
      headless: true,
      port: 9333,
      settle: { loadMs: 50, clickMs: 150, scrollMs: 50 },
    });
  });

  afterAll(async () => {
    await session?.close();
    server?.stop(true);
  });

  contract("contract", async () => {
    await session.goto(server.url.href);
    return session.page;
  });
});
