import type { GroupedFinding } from "./group";

const LABEL: Record<number, string> = { 4: "Blocker", 3: "Major", 2: "Minor", 1: "Polish" };
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function markdown(opts: {
  url: string;
  viewport: { width: number; height: number };
  findings: GroupedFinding[];
  shots: Map<string, string>;
}): string {
  const { url, viewport, findings, shots } = opts;
  const n = (s: number) => findings.filter((f) => f.severity === s).length;

  const lines = [
    `# UX audit — ${url}`,
    "",
    `${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${viewport.width}×${viewport.height} viewport`,
    "",
    `**${n(4)} blocker · ${n(3)} major · ${n(2)} minor · ${n(1)} polish**`,
    "",
    "| # | Finding | Severity | Measured |",
    "|---|---|---|---|",
    ...findings.map(
      (f) =>
        `| ${f.id} | ${esc(f.name)} | ${LABEL[f.severity]} | ${esc(f.observations[0].detail)} |`,
    ),
    "",
    "---",
    "",
  ];

  for (const f of findings) {
    lines.push(`## ${f.id} · ${esc(f.name)}`, "");
    lines.push(`**${LABEL[f.severity]}**${f.count > 1 ? ` · ${f.count} elements` : ""}`, "");
    const shot = shots.get(f.id);
    if (shot) lines.push(`![${f.id}](${shot})`, "");
    for (const o of f.observations) lines.push(`- ${esc(o.detail)}  `, `  *${o.law}*`);
    lines.push("");
  }

  return lines.join("\n");
}
