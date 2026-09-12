import { CDP } from "./cdp";
import { launchChrome, openTab, goto, setViewport } from "./browser";
import { snapshot, render } from "./snapshot";
import { rm } from "node:fs/promises";

const url = process.argv[2];
if (!url) {
  console.error("usage: bun run peek <url> [--all] [--mobile]");
  process.exit(1);
}
const all = process.argv.includes("--all");
const mobile = process.argv.includes("--mobile");

const chrome = await launchChrome();
const cdp = await CDP.connect(chrome.wsUrl);
const { sessionId } = await openTab(cdp);

if (mobile) await setViewport(cdp, sessionId, 390, 844, true, 3);
else await setViewport(cdp, sessionId, 1440, 900, false, 2);

await goto(cdp, sessionId, url);

const nodes = await snapshot(cdp, sessionId, { all });
console.log(render(nodes));
console.error(`\n${nodes.length} nodes${all ? " (unfiltered)" : " (filtered)"}`);

const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
await Bun.write("out/peek.png", Buffer.from(data, "base64"));
console.error("screenshot → out/peek.png");

cdp.close();
chrome.proc.kill();
await rm(chrome.profile, { recursive: true, force: true });
