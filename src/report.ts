import type { GroupedFinding } from "./group";
import type { AuditNotice } from "./rules";
import type { DismissalResult } from "./overlay";
import type { Layout } from "./page/page";

const LABEL: Record<number, string> = { 4: "Blocker", 3: "Major", 2: "Minor", 1: "Polish" };
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const describeScreenshot = <T extends { shot?: Uint8Array }>(value: T) => {
  const { shot, ...rest } = value;
  return shot
    ? { ...rest, screenshot: { captured: true, bytes: shot.byteLength } }
    : rest;
};

/** JSON output keeps evidence metadata without expanding binary PNG bytes. */
export function json(opts: {
  url: string;
  viewport: Layout;
  overlayAttempts: DismissalResult[];
  notices: AuditNotice[];
  findings: GroupedFinding[];
}): string {
  return JSON.stringify({
    url: opts.url,
    viewport: opts.viewport,
    overlays: opts.overlayAttempts.map(describeScreenshot),
    notices: opts.notices,
    findings: opts.findings.map(describeScreenshot),
  }, null, 2);
}

export function markdown(opts: {
  url: string;
  viewport: { width: number; height: number };
  findings: GroupedFinding[];
  notices?: AuditNotice[];
  shots: Map<string, string>;
}): string {
  const { url, viewport, findings, notices = [], shots } = opts;
  const n = (s: number) => findings.filter((f) => f.severity === s).length;

  const lines = [
    `# UX audit — ${url}`,
    "",
    `${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${viewport.width}×${viewport.height} viewport`,
    "",
    `**${n(4)} blocker · ${n(3)} major · ${n(2)} minor · ${n(1)} polish**`,
    notices.length ? `**Audit coverage:** ${notices.length} measurement${notices.length === 1 ? "" : "s"} unavailable` : "",
    "",
    "| # | Finding | Severity | Measured |",
    "|---|---|---|---|",
    ...findings.map((f) => {
      const first = f.observations[0];
      if (!first) throw new Error(`Finding ${f.id} has no observations`);
      return `| ${f.id} | ${esc(f.name)} | ${LABEL[f.severity]} | ${esc(first.detail)} |`;
    }),
    "",
    "---",
    "",
  ];

  if (notices.length) {
    lines.push("## Audit coverage", "");
    for (const notice of notices) {
      const label = notice.name || "⟨no accessible name⟩";
      lines.push(`- Ref ${notice.ref}, ${notice.role} "${esc(label)}": ${esc(notice.detail)}`);
    }
    lines.push("", "---", "");
  }

  for (const f of findings) {
    lines.push(`## ${f.id} · ${esc(f.name)}`, "");
    lines.push(`**${LABEL[f.severity]}**${f.count > 1 ? ` · ${f.count} elements` : ""}`, "");
    const shot = shots.get(f.id);
    if (shot) lines.push(`![${f.id}](${shot})`, "");
    else if (f.boxes.length) lines.push("*No verified screenshot placement was available.*", "");
    for (const o of f.observations) lines.push(`- ${esc(o.detail)}  `, `  *${o.law}*`);
    lines.push("");
  }

  return lines.join("\n");
}
