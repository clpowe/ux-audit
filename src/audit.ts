import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withSession, VIEWPORTS } from "./sessions";
import { PERSONAS, journeyMarkdown, runJourney, type JourneyInput, type JourneyResult } from "./journey";
import { decideJourney } from "./journey-agent";

const [url, task, flag, persona, ...extra] = process.argv.slice(2);
if (!url || !task?.trim() || flag !== "--persona" || !persona || extra.length || !Object.hasOwn(PERSONAS, persona)) {
  console.error('usage: bun run audit <url> "<task>" --persona "New Mother"');
  console.error(`Personas: ${Object.keys(PERSONAS).join(", ")}`);
  process.exit(1);
}
let parsed: URL;
try {
  parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Use an http(s) URL without credentials.");
} catch {
  console.error("Provide a valid http(s) website URL without credentials.");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY in your environment or .env file.");
  process.exit(1);
}

const input: JourneyInput = { url: parsed.href, task, persona, needs: PERSONAS[persona]! };
const directory = resolve("out", "journeys", `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`);
await mkdir(directory, { recursive: true });
console.log(`Attempting: ${task}\nPersona: ${persona}\nConstraints: ${input.needs}\nReport directory: ${directory}`);
let result: JourneyResult | undefined;
try {
  await withSession({ url: input.url, viewport: VIEWPORTS.desktop }, async (page) => {
    result = await runJourney(page, input, async (context) => {
      console.log(`Step ${context.steps.length + 1}: inspecting page…`);
      const decision = await decideJourney(context);
      console.log(`Proposed ${decision.action}: ${decision.reason}`);
      return decision;
    }, async (number, bytes) => {
      const name = `step-${String(number).padStart(2, "0")}.png`;
      await writeFile(resolve(directory, name), bytes);
      return name;
    });
  });
} catch (error) {
  if (result) result.notices.push(`Browser cleanup failed: ${String(error)}`);
  else result = { input, status: "error", reason: `Browser session failed: ${String(error)}`, steps: [], notices: [] };
}
if (!result) throw new Error("Browser session returned no journey result.");
await writeFile(resolve(directory, "report.json"), JSON.stringify(result, null, 2));
await writeFile(resolve(directory, "report.md"), journeyMarkdown(result));
console.log(`${result.status}: ${result.reason}\nReport: ${resolve(directory, "report.md")}`);
if (result.status === "error") process.exitCode = 1;
