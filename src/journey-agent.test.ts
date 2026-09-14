import { expect, spyOn, test } from "bun:test";
import { decideJourney } from "./journey-agent";
import type { Decision } from "./journey";
import { HEURISTICS } from "./journey-evaluation";
import { PERSONAS } from "./journey";

test("journey screenshots reach the provider as PNG images without deprecated content warnings", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLogger = globalThis.AI_SDK_LOG_WARNINGS;
  const warnings: unknown[] = [];
  process.env.OPENAI_API_KEY = "local-test-only";
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings: emitted }) => warnings.push(...emitted);
  const decision: Decision = {
    action: "blocked", ref: null, text: null, direction: null, reason: "Fixture completed", evidence: [], observations: [],
    evaluation: {
      stage: "Entry", userIntent: "Find a sofa", businessGoalHypothesis: "Support product discovery", expectedPath: "Search, inspect a product, add to cart",
      informationNeeded: ["Product options"], decisionsRequired: [], assumptions: ["No analytics provided"], firstTimeUserRisks: [], experiencedUserFriction: [],
      heuristics: HEURISTICS.map((name) => ({ name, assessment: "Insufficient evidence", rationale: "No page nodes available", evidence: [] })),
      score: null, scoreRationale: "Insufficient evidence",
    },
  };
  const bodies: any[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (_url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    bodies.push(JSON.parse(String(options?.body)));
    return Response.json({
      id: "resp_test", created_at: 0, model: "fixture", status: "completed",
      output: [{ type: "message", role: "assistant", id: "msg_test", content: [{ type: "output_text", text: JSON.stringify(decision), annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  }, { preconnect: () => {} }));
  try {
    const screenshot = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6vGQAAAAASUVORK5CYII=", "base64"));
    const actual = await decideJourney({
      input: { url: "https://shop.example", task: "buy a sofa", persona: "New Mother", needs: PERSONAS["New Mother"]! },
      nodes: [], steps: [], screenshot, previousScreenshot: screenshot, afterCartAttempt: false, atLimit: false,
    });
    expect(actual).toEqual(decision);
    expect(bodies).toHaveLength(1);
    const requestText = JSON.stringify(bodies[0].input);
    expect(requestText).toContain("UX Journey Evaluator");
    expect(requestText).toContain("Never invent numerical improvements");
    expect(requestText).toContain("all ten heuristics exactly once");
    expect(requestText).toContain("no more than $1,500");
    expect(requestText).toContain("October 15, 2026");
    expect(requestText).toContain("hard product-selection constraints");
    const images = bodies[0].input.flatMap((message: any) => message.content ?? []).filter((part: any) => part.type === "input_image");
    expect(images).toHaveLength(2);
    for (const image of images) expect(image.image_url).toBe(`data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`);
    expect(warnings).toEqual([]);
  } finally {
    fetchSpy.mockRestore();
    globalThis.AI_SDK_LOG_WARNINGS = previousLogger;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
