import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { launchPage, type PlaywrightSession } from "./playwright";
import { FakePage, type FakeNode } from "./fake";
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

const consentFake = () => {
  const query: FakeNode = { role: "searchbox", name: "Query" };
  const ghost: FakeNode = { role: "button", name: "Ghost", box: null };
  return new FakePage({
    initial: "consent",
    states: {
      consent: {
        pageHeight: 3000,
        nodes: [
          { role: "dialog", name: "Cookies" },
          { role: "button", name: "Accept all", depth: 1 },
          { role: "button", name: "Read more", depth: 1 },
          query,
          ghost,
        ],
      },
      accepted: {
        pageHeight: 3000,
        nodes: [
          query,
          ghost,
        ],
      },
    },
    transitions: { consent: { "button:Accept all": "accepted" } },
  });
};

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
      expect(accept.measurement).toBe("measured");
      expect(accept.box).not.toBeNull();
      expect(accept.box!.width).toBeGreaterThan(0);
      const ghost = nodes.find((node) => node.name === "Ghost");
      if (label === "FakePage") {
        expect(ghost?.measurement).toBe("not-rendered");
        expect(ghost?.box).toBeNull();
      } else {
        expect(ghost).toBeUndefined();
      }
    });

    test("click changes what the page perceives", async () => {
      await page.click(find(await page.snapshot(), "button", "Accept all"));
      const after = await page.snapshot();
      expect(after.some((n) => n.role === "dialog")).toBe(false);
    });

    test("presence detects a dialog that remains after a click", async () => {
      const nodes = await page.snapshot();
      const dialog = find(nodes, "dialog", "Cookies");
      await page.click(find(nodes, "button", "Read more"));
      expect(await page.isPresent(dialog)).toBe(true);
    });

    test("presence follows original Nodes when Snapshot positions change", async () => {
      const before = await page.snapshot();
      const dialog = find(before, "dialog", "Cookies");
      const query = find(before, "searchbox", "Query");
      await page.click(find(before, "button", "Accept all"));
      const after = await page.snapshot();
      expect(find(after, "searchbox", "Query").ref).not.toBe(query.ref);
      expect(await page.isPresent(dialog)).toBe(false);
      expect(await page.isPresent(query)).toBe(true);
    });

    test("presence is false for an unrendered Node", async () => {
      if (label === "FakePage") {
        expect(await page.isPresent(find(await page.snapshot(), "button", "Ghost"))).toBe(false);
      } else {
        expect((await page.snapshot()).some((node) => node.name === "Ghost")).toBe(false);
      }
    });

    test("presence does not classify an invalid handle as absence", async () => {
      const dialog = find(await page.snapshot(), "dialog", "Cookies");
      await expect(page.isPresent({ ...dialog, handle: undefined })).rejects.toThrow();
    });

    test("presence does not require a Node to be in the viewport", async () => {
      const query = find(await page.snapshot(), "searchbox", "Query");
      await page.scrollTo(1500);
      expect(await page.isPresent(query)).toBe(true);
    });

    test("click on a node that is no longer on the page throws, naming it", async () => {
      const accept = find(await page.snapshot(), "button", "Accept all");
      await page.click(accept);
      await expect(page.click(accept)).rejects.toThrow(/Accept all/);
    });

    test("click on an unrendered node throws, naming it", async () => {
      if (label === "FakePage") {
        const ghost = find(await page.snapshot(), "button", "Ghost");
        await expect(page.click(ghost)).rejects.toThrow(/Ghost/);
      }
    });

    test("scrollTo moves the viewport", async () => {
      await page.scrollTo(300);
      const view = await page.layout();
      expect(view.scrollY).toBe(300);
      expect(view.pageHeight).toBeGreaterThanOrEqual(3000);
    });

    test("non-fixed Node boxes retain document coordinates after scrolling", async () => {
      const before = find(await page.snapshot({ boxes: true }), "searchbox", "Query");
      await page.scrollTo(800);
      const after = find(await page.snapshot({ boxes: true }), "searchbox", "Query");
      expect(before.box).not.toBeNull();
      expect(after.box).toEqual(before.box);
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
      if (label === "FakePage") {
        expect(timing.respondedMs).toBeNull();
        expect(timing.settledMs).toBeNull();
        expect(timing.respondedWith).toBeNull();
      } else {
        expect(timing.respondedMs).not.toBeNull();
      }
    });

    test("type on an unrendered node throws, naming it", async () => {
      if (label === "FakePage") {
        const ghost = find(await page.snapshot(), "button", "Ghost");
        await expect(page.type(ghost, "sofa")).rejects.toThrow(/Ghost/);
      }
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

test("FakePage represents a measurement failure separately from an unrendered Node", async () => {
  const page = new FakePage({
    initial: "page",
    states: { page: { nodes: [{ role: "button", name: "Buy", measurementError: "inspection failed" }] } },
  });
  expect(await page.snapshot({ boxes: true })).toEqual([expect.objectContaining({
    measurement: "unavailable",
    box: null,
    measurementError: "inspection failed",
  })]);
});

describe("PlaywrightPage", () => {
  let server: ReturnType<typeof Bun.serve>;
  let session: PlaywrightSession;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const hide = new URL(request.url).searchParams.get("hide");
        const html = hide === "display" || hide === "visibility"
          ? CONSENT_HTML.replace(".remove()", hide === "display" ? ".style.display='none'" : ".style.visibility='hidden'")
          : CONSENT_HTML;
        return new Response(html, { headers: { "content-type": "text/html" } });
      },
    });
    session = await launchPage({
      url: "about:blank",
      viewport: { width: 390, height: 844, mobile: true, dpr: 1 },
      headless: true,
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

  for (const hide of ["display", "visibility"]) {
    test(`presence detects an Overlay hidden with ${hide}`, async () => {
      await session.goto(`${server.url.href}?hide=${hide}`);
      const nodes = await session.page.snapshot();
      const dialog = find(nodes, "dialog", "Cookies");
      await session.page.click(find(nodes, "button", "Accept all"));
      expect(await session.page.isPresent(dialog)).toBe(false);
    });
  }

});
