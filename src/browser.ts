import { CDP } from "./cdp";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean) as string[];

async function findChrome(): Promise<string> {
  for (const path of CANDIDATES) {
    if (await Bun.file(path).exists()) return path;
  }
  throw new Error(
    "No Chrome-family browser found. Looked in:\n" +
      CANDIDATES.map((c) => `  ${c}`).join("\n") +
      "\nSet CHROME_PATH=/path/to/binary and re-run.",
  );
}

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launchChrome(port = Number(process.env.CDP_PORT ?? 9222)) {
  const bin = await findChrome();
  const profile = `/tmp/ux-audit-profile-${port}-${Date.now()}`;

  const proc = Bun.spawn(
    [
      CHROME,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,MediaRouter",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const info = await res.json();
        return { proc, bin, port, profile, wsUrl: info.webSocketDebuggerUrl as string };
      }
    } catch {}
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error("Chrome never opened its debugging port");
}

export async function openTab(cdp: CDP, url = "about:blank") {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  return { targetId, sessionId: sessionId as string };
}

export async function setViewport(
  cdp: CDP,
  sessionId: string,
  width: number,
  height: number,
  mobile = false,
  deviceScaleFactor = 2,
) {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor, mobile },
    sessionId,
  );
}

export async function goto(cdp: CDP, sessionId: string, url: string) {
  const loaded = cdp.once("Page.loadEventFired", sessionId, 30_000);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  await Bun.sleep(500);
}

export async function primePage(cdp: CDP, sessionId: string) {
  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 300));
    })()`,
      awaitPromise: true,
    },
    sessionId,
    60_000,
  );
}
