import { describe, expect, test } from "bun:test";
import { dismissOverlays } from "./overlay";
import { FakePage, type FakeNode } from "./page/fake";

const content: FakeNode[] = [
  { role: "heading", name: "Welcome" },
  { role: "link", name: "Close", box: { x: 0, y: 900, width: 80, height: 44 } },
];

const noWait = { waitForDialogMs: 0 };

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

    expect(await dismissOverlays(page, noWait)).toEqual([
      { name: "We use cookies", dismissedWith: "Accept all" },
    ]);
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

    expect(await dismissOverlays(page, noWait)).toEqual([
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

    expect(await dismissOverlays(page, noWait)).toEqual([
      { name: "Cookies", dismissedWith: "Got it" },
    ]);
  });
});
