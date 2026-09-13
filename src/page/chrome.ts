import { rm } from "node:fs/promises";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean) as string[];

export async function findChrome(): Promise<string> {
  for (const path of CANDIDATES) {
    if (await Bun.file(path).exists()) return path;
  }
  throw new Error(
    "No Chrome-family browser found. Looked in:\n" +
      CANDIDATES.map((c) => `  ${c}`).join("\n") +
      "\nSet CHROME_PATH=/path/to/binary and re-run.",
  );
}

export type Chrome = {
  wsUrl: string;
  /** Stops the browser and removes its throwaway profile. */
  kill(): Promise<void>;
};

export async function launchChrome(opts: { port: number; headless: boolean }): Promise<Chrome> {
  const bin = await findChrome();
  const profile = `/tmp/ux-audit-profile-${opts.port}-${Date.now()}`;

  const proc = Bun.spawn(
    [
      bin,
      `--remote-debugging-port=${opts.port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,MediaRouter",
      ...(opts.headless ? ["--headless=new"] : []),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const kill = async () => {
    proc.kill();
    await Promise.race([proc.exited, Bun.sleep(3000)]);
    if (proc.exitCode === null) proc.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true });
  };

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/json/version`);
      if (res.ok) {
        const info = (await res.json()) as { webSocketDebuggerUrl: string };
        return { wsUrl: info.webSocketDebuggerUrl, kill };
      }
    } catch {}
    await Bun.sleep(100);
  }
  await kill();
  throw new Error("Chrome never opened its debugging port");
}
