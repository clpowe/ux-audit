import { expect, test } from "bun:test";
import { FakePage, type FakeNode } from "./page/fake";
import { journeyMarkdown, runJourney, type Decision, type JourneyInput } from "./journey";

const input: JourneyInput = { url: "https://shop.example", task: "buy a sofa", persona: "New Mother", needs: "Clear delivery information" };
const decision = (value: Partial<Decision>): Decision => ({ action: "blocked", ref: null, text: null, direction: null, reason: "Test decision", evidence: [], observations: [], ...value });
const save = async (number: number) => `step-${number}.png`;
const simplePage = (nodes: FakeNode[]) => new FakePage({ initial: "start", states: { start: { nodes } } });

test("confirmed cart addition stops without executing checkout, and retains before/after screenshots", async () => {
  const page = new FakePage({ initial: "product", states: {
    product: { nodes: [{ role: "button", name: "Add to cart" }] },
    cart: { nodes: [{ role: "status", name: "Sofa added to cart" }, { role: "button", name: "Checkout" }] },
    paid: { nodes: [] },
  }, transitions: { product: { "button:Add to cart": "cart" }, cart: { "button:Checkout": "paid" } } });
  const result = await runJourney(page, input, async ({ afterCartAttempt }) => decision(afterCartAttempt
    ? { action: "added_to_cart", evidence: [0] }
    : { action: "click", ref: 0 }), save, 1);
  expect(result.status).toBe("added_to_cart");
  expect(page.state).toBe("cart");
  expect(result.steps.map((step) => step.screenshot)).toEqual(["step-1.png", "step-2.png"]);
  expect(result.steps[0]?.executed).toBe(true);
  expect(result.steps[1]?.executed).toBeUndefined();
});

for (const name of ["Checkout", "Proceed to check out", "Buy now", "Place order", "Confirm order", "PayPal", "Add to cart and checkout", "Sign in"]) {
  test(`does not execute restricted control: ${name}`, async () => {
    const page = new FakePage({ initial: "start", states: { start: { nodes: [{ role: "button", name }] }, unsafe: { nodes: [] } }, transitions: { start: { [`button:${name}`]: "unsafe" } } });
    const result = await runJourney(page, input, async () => decision({ action: "click", ref: 0 }), save);
    expect(result.status).toBe("blocked");
    expect(page.state).toBe("start");
    expect(result.steps[0]?.executed).toBeUndefined();
  });
}

test("cart button presence alone cannot establish success", async () => {
  const result = await runJourney(simplePage([{ role: "button", name: "Add to cart" }]), input,
    async ({ afterCartAttempt }) => decision(afterCartAttempt ? { action: "added_to_cart", evidence: [0] } : { action: "click", ref: 0 }), save);
  expect(result.status).toBe("blocked");
  expect(result.reason).toContain("could not be verified");
});

test("confirmation text before our cart attempt is not success", async () => {
  const result = await runJourney(simplePage([{ role: "status", name: "Added to cart" }]), input,
    async () => decision({ action: "added_to_cart", evidence: [0] }), save);
  expect(result.status).toBe("blocked");
});

test("text labels resolve to their containing button and record the actual target", async () => {
  const page = new FakePage({ initial: "modal", states: {
    modal: { nodes: [{ role: "button", name: "Close Modal", depth: 1 }, { role: "StaticText", name: "No thank you", depth: 2 }] },
    product: { nodes: [{ role: "heading", name: "Sofa" }] },
  }, transitions: { modal: { "button:Close Modal": "product" } } });
  const result = await runJourney(page, input, async ({ steps }) => decision(steps.length ? { action: "blocked" } : { action: "click", ref: 1 }), save);
  expect(page.state).toBe("product");
  expect(result.steps[0]?.executedRef).toBe(0);
  expect(journeyMarkdown(result)).toContain("Target: button — Close Modal");
});

for (const parent of [{ name: "Checkout" }, { name: "Close Modal", disabled: true }]) {
  test(`text labels cannot bypass containing-control policy: ${JSON.stringify(parent)}`, async () => {
    const page = simplePage([{ role: "button", depth: 1, ...parent }, { role: "StaticText", name: "No thank you", depth: 2 }]);
    const result = await runJourney(page, input, async () => decision({ action: "click", ref: 1 }), save);
    expect(result.status).toBe("blocked");
    expect(result.steps[0]?.executed).toBeUndefined();
  });
}

test("unrelated text cannot borrow a previous sibling button", async () => {
  const page = simplePage([{ role: "button", name: "Close Modal", depth: 1 }, { role: "StaticText", name: "No thank you", depth: 1 }]);
  const result = await runJourney(page, input, async () => decision({ action: "click", ref: 1 }), save);
  expect(result.status).toBe("blocked");
  expect(result.steps[0]?.executed).toBeUndefined();
});

test("never performs a second action after attempting cart addition", async () => {
  const result = await runJourney(simplePage([{ role: "button", name: "Add to cart" }]), input,
    async () => decision({ action: "click", ref: 0 }), save);
  expect(result.status).toBe("blocked");
  expect(result.steps.filter((step) => step.executed)).toHaveLength(1);
});

test("unchanged stale confirmation cannot establish success", async () => {
  const page = simplePage([{ role: "button", name: "Add to cart" }, { role: "status", name: "Sofa added to cart" }]);
  const result = await runJourney(page, input, async ({ afterCartAttempt }) => decision(afterCartAttempt
    ? { action: "added_to_cart", evidence: [1] } : { action: "click", ref: 0 }), save);
  expect(result.status).toBe("blocked");
});

test("negative add-to-cart feedback cannot establish success", async () => {
  const page = new FakePage({ initial: "product", states: {
    product: { nodes: [{ role: "button", name: "Add to cart" }] },
    failed: { nodes: [{ role: "status", name: "Sofa was not added to cart" }] },
  }, transitions: { product: { "button:Add to cart": "failed" } } });
  const result = await runJourney(page, input, async ({ afterCartAttempt }) => decision(afterCartAttempt
    ? { action: "added_to_cart", evidence: [0] } : { action: "click", ref: 0 }), save);
  expect(result.status).toBe("blocked");
});

test("typing uses current search refs and journey history", async () => {
  const page = simplePage([{ role: "searchbox", name: "Search products" }]);
  const result = await runJourney(page, input, async ({ steps, nodes }) => {
    if (!steps.length) return decision({ action: "type", ref: 0, text: "sofa" });
    expect(nodes[0]?.value).toBe("sofa");
    expect(steps[0]?.executed).toBe(true);
    return decision({ action: "blocked", reason: "No search submit control" });
  }, save);
  expect(result.reason).toBe("No search submit control");
});

test("personal fields cannot receive typed text", async () => {
  const page = simplePage([{ role: "textbox", name: "Email address" }]);
  const result = await runJourney(page, input, async () => decision({ action: "type", ref: 0, text: "sofa" }), save);
  expect(result.status).toBe("blocked");
  expect((await page.snapshot())[0]?.value).toBeUndefined();
});

test("action budget permits final evidence capture but no extra action", async () => {
  const page = new FakePage({ initial: "start", states: { start: { nodes: [], pageHeight: 9000 } } });
  const result = await runJourney(page, input, async () => decision({ action: "scroll", direction: "down" }), save, 2);
  expect(result.status).toBe("step_limit");
  expect(result.steps.filter((step) => step.executed)).toHaveLength(2);
  expect(result.steps).toHaveLength(3);
});

test("repeated actions without progress terminate", async () => {
  const result = await runJourney(simplePage([{ role: "button", name: "Search" }]), input,
    async () => decision({ action: "click", ref: 0 }), save);
  expect(result.status).toBe("blocked");
  expect(result.reason).toContain("three consecutive actions");
});

test("invalid finding evidence is excluded and disclosed without becoming a UX finding", async () => {
  const result = await runJourney(simplePage([]), input, async () => decision({ observations: [{ problem: "Invented issue", impact: "Friction", evidence: [99] }] }), save);
  expect(result.status).toBe("blocked");
  expect(result.notices[0]).toContain("Finding 1 excluded");
  expect(result.steps[0]?.unverifiedReview?.observations[0]?.problem).toBe("Invented issue");
  expect(journeyMarkdown(result)).not.toContain("Invented issue");
  expect(result.steps[0]?.screenshot).toBe("step-1.png");
});

test("model failure preserves evidence already captured", async () => {
  const result = await runJourney(simplePage([]), input, async () => { throw new Error("API unavailable"); }, save);
  expect(result.status).toBe("error");
  expect(result.steps).toHaveLength(1);
  expect(journeyMarkdown(result)).toContain("API unavailable");
});

test("an unrendered target is recorded and the agent can choose another route", async () => {
  const page = new FakePage({ initial: "listing", states: {
    listing: { nodes: [{ role: "link", name: "Performance Fabric sofas", box: null }, { role: "link", name: "Washable sofa" }] },
    product: { nodes: [{ role: "button", name: "Add to cart" }] },
    cart: { nodes: [{ role: "status", name: "Sofa added to cart" }] },
  }, transitions: { listing: { "link:Washable sofa": "product" }, product: { "button:Add to cart": "cart" } } });
  const result = await runJourney(page, input, async ({ steps, afterCartAttempt, nodes }) => {
    if (afterCartAttempt) return decision({ action: "added_to_cart", evidence: [0] });
    if (nodes[0]?.name === "Add to cart") return decision({ action: "click", ref: 0 });
    if (!steps.length) return decision({ action: "click", ref: 0 });
    if (steps[0]?.actionError) return decision({ action: "click", ref: 1 });
    return decision({ action: "click", ref: 0 });
  }, save);
  expect(result.status).toBe("added_to_cart");
  expect(result.steps[0]?.executed).toBeUndefined();
  expect(result.steps[0]?.actionError).toContain("not rendered");
  expect(result.steps[1]?.executed).toBe(true);
  expect(result.notices[0]).toContain("proposed action could not execute");
  expect(journeyMarkdown(result)).toContain("Action could not execute");
});

test("a failed add-to-cart click does not trigger the post-cart stop", async () => {
  const page = new FakePage({ initial: "product", states: { product: { nodes: [{ role: "button", name: "Add to cart", box: null }, { role: "link", name: "Another sofa" }] } } });
  let sawAfterCartAttempt = false;
  const result = await runJourney(page, input, async ({ steps, afterCartAttempt }) => {
    if (steps.length) sawAfterCartAttempt = afterCartAttempt;
    return decision(steps.length ? { action: "blocked", reason: "No usable cart control" } : { action: "click", ref: 0 });
  }, save);
  expect(result.status).toBe("blocked");
  expect(sawAfterCartAttempt).toBe(false);
  expect(result.reason).toBe("No usable cart control");
});

test("screenshot failure is disclosed while the report still records observations", async () => {
  const result = await runJourney(simplePage([{ role: "status", name: "Search unavailable" }]), input,
    async () => decision({ observations: [{ problem: "Search unavailable", impact: "Prevents finding a sofa", evidence: [0] }] }),
    async () => { throw new Error("Disk unavailable"); });
  const report = journeyMarkdown(result);
  expect(report).toContain("Screenshot unavailable");
  expect(report).toContain("Disk unavailable");
  expect(report).toContain("Prevents finding a sofa");
  expect(report).not.toContain("![");
});

test("observation report includes the exact step screenshot and escapes website markup", async () => {
  const result = await runJourney(simplePage([{ role: "status", name: "Search unavailable" }]), input,
    async () => decision({ observations: [{ problem: "<script>alert(1)</script>", impact: "Limited shopping time", evidence: [0] }] }), save);
  const report = journeyMarkdown(result);
  expect(report).toContain("![Page at step 1](step-1.png)");
  expect(report).toContain("Evidence: status — Search unavailable");
  expect(report).not.toContain("<script>");
});
