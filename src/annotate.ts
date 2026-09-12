import type { CDP } from "./cdp";
import { layout } from "./geometry";
import type { GroupedFinding } from "./group";

const COLOR: Record<number, string> = {
  4: "#dc2626",
  3: "#ea580c",
  2: "#ca8a04",
  1: "#6b7280",
};

export async function drawOverlay(cdp: CDP, sessionId: string, findings: GroupedFinding[]) {
  const marks = findings.flatMap((f) =>
    f.boxes.map((b, i) => ({
      x: b.x,
      y: b.y,
      w: b.width,
      h: b.height,
      color: COLOR[f.severity],
      label: i === 0 ? f.id : "",
    })),
  );

  await cdp.send(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
      const marks = ${JSON.stringify(marks)};
      document.getElementById('uxa-overlay')?.remove();
      const root = document.createElement('div');
      root.id = 'uxa-overlay';
      root.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none';
      for (const m of marks) {
        const o = document.createElement('div');
        o.style.cssText = 'position:absolute;pointer-events:none;left:' + m.x + 'px;top:' + m.y +
          'px;width:' + m.w + 'px;height:' + m.h + 'px;outline:2px solid ' + m.color +
          ';outline-offset:0;box-shadow:0 0 0 3px rgba(255,255,255,.55)';        root.appendChild(o);
        if (m.label) {
          const b = document.createElement('div');
          b.textContent = m.label;
          b.style.cssText = 'position:absolute;pointer-events:none;left:' + m.x + 'px;top:' +
            Math.max(0, m.y - 19) + 'px;background:' + m.color +
            ';color:#fff;padding:1px 5px;border-radius:3px;white-space:nowrap;' +
            'font:700 11px/16px ui-monospace,SFMono-Regular,monospace';
          root.appendChild(b);
        }
      }
      document.body.appendChild(root);
      return marks.length;
    })()`,
    },
    sessionId,
  );
}

export async function captureShots(
  cdp: CDP,
  sessionId: string,
  findings: GroupedFinding[],
  dir: string,
): Promise<Map<string, string>> {
  const view = await layout(cdp, sessionId);
  const shots = new Map<string, string>();
  const done = new Set<string>();

  const ordered = findings.filter((f) => f.box !== null).sort((a, b) => a.box!.y - b.box!.y);

  let n = 0;
  for (const anchor of ordered) {
    if (done.has(anchor.id)) continue;

    const top = Math.max(0, anchor.box!.y - 120);
    await cdp.send("Runtime.evaluate", { expression: `window.scrollTo(0, ${top})` }, sessionId);
    await Bun.sleep(250);
    await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
        const o = document.getElementById('uxa-overlay');
        if (o) o.style.transform =
          'translate(' + (-window.scrollX) + 'px,' + (-window.scrollY) + 'px)';
      })()`,
      },
      sessionId,
    );

    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const file = `shot-${String(++n).padStart(2, "0")}.png`;
    await Bun.write(`${dir}/${file}`, Buffer.from(data, "base64"));

    for (const f of ordered) {
      if (done.has(f.id) || !f.box) continue;
      if (f.box.y >= top && f.box.y + f.box.height <= top + view.height) {
        shots.set(f.id, file);
        done.add(f.id);
      }
    }
    if (!done.has(anchor.id)) {
      shots.set(anchor.id, file);
      done.add(anchor.id);
    }
  }

  await cdp.send("Runtime.evaluate", { expression: "window.scrollTo(0,0)" }, sessionId);
  return shots;
}
