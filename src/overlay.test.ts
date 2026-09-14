import { describe, expect, test } from "bun:test";
import { dismissOverlays, type Overlay } from "./overlay";
import { FakePage, type FakeNode } from "./page/fake";

const content: FakeNode[] = [
  { role: "heading", name: "Welcome" },
  { role: "link", name: "Close", box: { x: 0, y: 900, width: 80, height: 44 } },
];

const noWait = { waitForDialogMs: 0 };

// Overlays also carry the screenshot taken before dismissal; these assertions are
// about which overlay was found and how, so the bytes are checked separately.
const how = (overlays: Overlay[]) =>
  overlays.map(({ name, dismissedWith }) => ({ name, dismissedWith }));

describe("dismissOverlays", () => {
  test("dismisses a cookie banner and reports how", async () => {
    const page = new FakePage({
      initial: "banner",
      states: {
        banner: {
          nodes: [
            ...content,
            { role: "dialog", name: "We use cookies" },
            { role: "button", name: "Manage preferences", depth: 1 },
            { role: "button", name: "Accept all", depth: 1 },
          ],
        },
        clear: { nodes: content },
      },
      transitions: { banner: { "button:Accept all": "clear" } },
    });

    const dismissed = await dismissOverlays(page, noWait);
    expect(how(dismissed)).toEqual([{ name: "We use cookies", dismissedWith: "Accept all" }]);
    expect(dismissed[0].shot).toBeInstanceOf(Uint8Array);
    expect(page.state).toBe("clear");
  });

  test("returns nothing when no Overlay is present", async () => {
    const page = new FakePage({ initial: "plain", states: { plain: { nodes: content } } });
    expect(await dismissOverlays(page, noWait)).toEqual([]);
  });

  test("works through stacked Overlays one round at a time", async () => {
    const page = new FakePage({
      initial: "consent",
      states: {
        consent: {
          nodes: [
            { role: "dialog", name: "Consent" },
            { role: "button", name: "Agree", depth: 1 },
          ],
        },
        newsletter: {
          nodes: [
            { role: "dialog", name: "Newsletter" },
            { role: "button", name: "No thanks", depth: 1 },
          ],
        },
        clear: { nodes: content },
      },
      transitions: {
        consent: { "button:Agree": "newsletter" },
        newsletter: { "button:No thanks": "clear" },
      },
    });

    expect(how(await dismissOverlays(page, noWait))).toEqual([
      { name: "Consent", dismissedWith: "Agree" },
      { name: "Newsletter", dismissedWith: "No thanks" },
    ]);
  });

  test("leaves an Overlay alone when nothing inside it reads as dismissal", async () => {
    const page = new FakePage({
      initial: "paywall",
      states: {
        paywall: {
          nodes: [
            ...content,
            { role: "dialog", name: "Subscribe" },
            { role: "button", name: "Start trial", depth: 1 },
          ],
        },
      },
    });

    expect(await dismissOverlays(page, noWait)).toEqual([]);
    expect(page.state).toBe("paywall");
  });

  test("ignores dismissal buttons that come before the dialog", async () => {
    const page = new FakePage({
      initial: "banner",
      states: {
        banner: {
          nodes: [
            { role: "button", name: "Close" },
            { role: "dialog", name: "Promo" },
            { role: "button", name: "Shop now", depth: 1 },
          ],
        },
        clear: { nodes: content },
      },
      transitions: { banner: { "button:Close": "clear" } },
    });

    expect(await dismissOverlays(page, noWait)).toEqual([]);
  });

  test("skips unrendered dismissal buttons in favour of rendered ones", async () => {
    const page = new FakePage({
      initial: "banner",
      states: {
        banner: {
          nodes: [
            { role: "dialog", name: "Cookies" },
            { role: "button", name: "Accept all", depth: 1, box: null },
            { role: "button", name: "Got it", depth: 1 },
          ],
        },
        clear: { nodes: content },
      },
      transitions: { banner: { "button:Got it": "clear" } },
    });

    expect(how(await dismissOverlays(page, noWait))).toEqual([
      { name: "Cookies", dismissedWith: "Got it" },
    ]);
  });

  // A third-party lightbox is an iframe: a second document drawn over the page.
  // It carries no dialog role, so role alone never finds it.
  test("dismisses a lightbox that lives in an embedded document", async () => {
    const page = new FakePage({
      initial: "lightbox",
      states: {
        lightbox: {
          nodes: [
            { role: "RootWebArea", name: "Ashley" },
            ...content,
            { role: "RootWebArea", name: "" },
            { role: "StaticText", name: "Please verify your delivery zip code.", depth: 1 },
            { role: "button", name: "Close Modal", depth: 1 },
          ],
        },
        clear: { nodes: [{ role: "RootWebArea", name: "Ashley" }, ...content] },
      },
      transitions: { lightbox: { "button:Close Modal": "clear" } },
    });

    expect(how(await dismissOverlays(page, noWait))).toEqual([
      { name: "⟨unnamed overlay⟩", dismissedWith: "Close Modal" },
    ]);
    expect(page.state).toBe("clear");
  });

  test("looks past an embedded document that holds nothing dismissable", async () => {
    const page = new FakePage({
      initial: "lightbox",
      states: {
        lightbox: {
          nodes: [
            { role: "RootWebArea", name: "Ashley" },
            ...content,
            { role: "RootWebArea", name: "" }, // a tracking pixel, not a lightbox
            { role: "RootWebArea", name: "" },
            { role: "button", name: "Close Modal", depth: 1 },
          ],
        },
        clear: { nodes: [{ role: "RootWebArea", name: "Ashley" }, ...content] },
      },
      transitions: { lightbox: { "button:Close Modal": "clear" } },
    });

    expect(how(await dismissOverlays(page, noWait))).toEqual([
      { name: "⟨unnamed overlay⟩", dismissedWith: "Close Modal" },
    ]);
  });
});
