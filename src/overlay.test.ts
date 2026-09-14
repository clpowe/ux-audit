import { describe, expect, spyOn, test } from "bun:test";
import { dismissOverlays, type DismissalResult } from "./overlay";
import { FakePage, type FakeNode } from "./page/fake";

const content: FakeNode[] = [
  { role: "heading", name: "Welcome" },
  { role: "link", name: "Close", box: { x: 0, y: 900, width: 80, height: 44 } },
];

const noWait = { waitForDialogMs: 0 };

// Overlays also carry the screenshot taken before dismissal; these assertions are
// about which overlay was found and how, so the bytes are checked separately.
const how = (overlays: DismissalResult[]) =>
  overlays.map(({ name, attemptedWith, status }) => ({ name, attemptedWith, status }));

describe("dismissOverlays", () => {
  test("records a remaining Overlay once and preserves pre-click evidence", async () => {
    const page = new FakePage({
      initial: "stuck",
      states: { stuck: { nodes: [
        { role: "dialog", name: "Newsletter" },
        { role: "button", name: "Close", depth: 1 },
      ] } },
    });
    const shot = new Uint8Array([1, 2, 3]);
    const screenshot = spyOn(page, "screenshot").mockResolvedValue(shot);
    const click = spyOn(page, "click");
    try {
      const results = await dismissOverlays(page, noWait);
      expect(results).toEqual([{ name: "Newsletter", attemptedWith: "Close", shot, status: "remained" }]);
      expect(results[0]?.shot).toBe(shot);
      expect(click).toHaveBeenCalledTimes(1);
      expect(screenshot.mock.invocationCallOrder[0]).toBeLessThan(click.mock.invocationCallOrder[0]!);
    } finally {
      click.mockRestore();
      screenshot.mockRestore();
    }
  });

  for (const failure of [new Error("inspection unavailable"), "inspection unavailable", Object.create(null)]) {
    test("returns unverified when inspection throws, including non-Error values", async () => {
      const page = new FakePage({
        initial: "stuck",
        states: { stuck: { nodes: [
          { role: "dialog", name: "Newsletter" },
          { role: "button", name: "Close", depth: 1 },
        ] } },
      });
      const presence = spyOn(page, "isPresent").mockRejectedValue(failure);
      const click = spyOn(page, "click");
      try {
        const results = await dismissOverlays(page, noWait);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ status: "unverified", attemptedWith: "Close" });
        if (results[0]?.status !== "unverified") throw new Error("expected unverified outcome");
        expect(results[0].reason.length).toBeGreaterThan(0);
        expect(click).toHaveBeenCalledTimes(1);
      } finally {
        click.mockRestore();
        presence.mockRestore();
      }
    });
  }

  test("a click failure becomes an unverified attempt without aborting", async () => {
    const page = new FakePage({
      initial: "stuck",
      states: { stuck: { nodes: [
        { role: "dialog", name: "Newsletter" },
        { role: "button", name: "Close", depth: 1 },
      ] } },
    });
    const click = spyOn(page, "click").mockRejectedValue(new Error("control disappeared"));
    try {
      const results = await dismissOverlays(page, noWait);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ status: "unverified", reason: "Click failed: control disappeared" });
    } finally {
      click.mockRestore();
    }
  });

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
    expect(how(dismissed)).toEqual([{ name: "We use cookies", attemptedWith: "Accept all", status: "dismissed" }]);
    expect(dismissed[0]?.shot).toBeInstanceOf(Uint8Array);
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
      { name: "Consent", attemptedWith: "Agree", status: "dismissed" },
      { name: "Newsletter", attemptedWith: "No thanks", status: "dismissed" },
    ]);
  });

  test("preserves ordered evidence when a second Overlay remains", async () => {
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
            { role: "button", name: "Close", depth: 1 },
          ],
        },
      },
      transitions: { consent: { "button:Agree": "newsletter" } },
    });
    const consentShot = new Uint8Array([1]);
    const newsletterShot = new Uint8Array([2]);
    const screenshot = spyOn(page, "screenshot")
      .mockResolvedValueOnce(consentShot)
      .mockResolvedValueOnce(newsletterShot);

    try {
      const results = await dismissOverlays(page, noWait);

      expect(how(results)).toEqual([
        { name: "Consent", attemptedWith: "Agree", status: "dismissed" },
        { name: "Newsletter", attemptedWith: "Close", status: "remained" },
      ]);
      expect(results[0]?.shot).toBe(consentShot);
      expect(results[1]?.shot).toBe(newsletterShot);
      expect(screenshot).toHaveBeenCalledTimes(2);
      expect(page.state).toBe("newsletter");
    } finally {
      screenshot.mockRestore();
    }
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
      { name: "Cookies", attemptedWith: "Got it", status: "dismissed" },
    ]);
  });

  test("does not click an unrelated Close after the dialog's descendants", async () => {
    const page = new FakePage({
      initial: "promo",
      states: {
        promo: {
          nodes: [
            { role: "dialog", name: "Promo" },
            { role: "button", name: "Shop now", depth: 1 },
            { role: "button", name: "Close", depth: 0 },
          ],
        },
        unrelatedAction: { nodes: [] },
      },
      transitions: { promo: { "button:Close": "unrelatedAction" } },
    });

    expect(await dismissOverlays(page, noWait)).toEqual([]);
    expect(page.state).toBe("promo");
  });

  test("does not borrow a control from a sibling section before the next Overlay", async () => {
    const page = new FakePage({
      initial: "promo",
      states: {
        promo: {
          nodes: [
            { role: "dialog", name: "Promo" },
            { role: "button", name: "Shop now", depth: 1 },
            { role: "region", name: "Account", depth: 0 },
            { role: "button", name: "Accept", depth: 1 },
            { role: "dialog", name: "Subscription", depth: 0 },
            { role: "button", name: "Subscribe", depth: 1 },
          ],
        },
        unrelatedAction: { nodes: [] },
      },
      transitions: { promo: { "button:Accept": "unrelatedAction" } },
    });

    expect(await dismissOverlays(page, noWait)).toEqual([]);
    expect(page.state).toBe("promo");
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
      { name: "⟨unnamed overlay⟩", attemptedWith: "Close Modal", status: "dismissed" },
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
      { name: "⟨unnamed overlay⟩", attemptedWith: "Close Modal", status: "dismissed" },
    ]);
  });
});
