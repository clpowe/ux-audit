import type { MeasuredNode, Box } from "./geometry";

export type Severity = 1 | 2 | 3 | 4;

export type Finding = {
  rule: string;
  law: string;
  severity: Severity;
  ref: number | null | undefined;
  role: string;
  name: string;
  measurement: string;
  box: Box | null | undefined;
};

export type PageContext = {
  viewport: { width: number; height: number };
  pageHeight: number;
  overlaysDismissed: { name: string; dismissedWith: string }[];
};

const MIN_TARGET = 44;

const TARGET_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "tab",
  "option",
]);

// Fix 3: skip links and other deliberately-offscreen affordances are exempt.
const offscreenByDesign = (n: MeasuredNode) =>
  /^skip to/i.test(n.name) ||
  (n.box !== null && (n.box.y + n.box.height <= 0 || n.box.x + n.box.width <= 0));

export function runRules(nodes: MeasuredNode[], ctx: PageContext): Finding[] {
  const findings: Finding[] = [];

  const screens = ctx.pageHeight / ctx.viewport.height;
  if (screens > 8) {
    findings.push({
      rule: "scroll-depth",
      law: "Information scent",
      severity: screens > 12 ? 3 : 2,
      ref: null,
      role: "page",
      name: "(whole page)",
      box: null,
      measurement: `${Math.round(ctx.pageHeight)}px — ${screens.toFixed(1)} screens at ${ctx.viewport.height}px tall`,
    });
  }

  for (const o of ctx.overlaysDismissed) {
    findings.push({
      rule: "blocking-overlay",
      law: "User control and freedom",
      severity: 2,
      ref: null,
      role: "dialog",
      name: o.name,
      box: null,
      measurement: `blocked the first view; dismissed via "${o.dismissedWith}"`,
    });
  }

  for (const n of nodes) {
    if (!TARGET_ROLES.has(n.role)) continue;

    if (!n.box || !n.box.rendered) {
      findings.push({
        rule: "phantom-node",
        law: "Visibility of system status",
        severity: 3,
        ref: n.ref,
        role: n.role,
        name: n.name,
        box: n.box,
        measurement: "in the accessibility tree but not rendered — announced, not visible",
      });
      continue;
    }

    const { x, y, width, height } = n.box;

    if (!offscreenByDesign(n) && (width < MIN_TARGET || height < MIN_TARGET)) {
      const area = width * height;
      findings.push({
        rule: "tap-target",
        law: "Fitts's Law · WCAG 2.5.5 Target Size",
        severity: targetSeverity(width, height),
        ref: n.ref,
        role: n.role,
        name: n.name,
        box: n.box,
        measurement: `${width}×${height}px against a ${MIN_TARGET}×${MIN_TARGET} minimum`,
      });
    }

    // Fix 2: horizontal reach.
    if (x >= ctx.viewport.width) {
      findings.push({
        rule: "offscreen-horizontal",
        law: "Discoverability · Hick's Law",
        severity: 2,
        ref: n.ref,
        role: n.role,
        name: n.name,
        box: n.box,
        measurement: `starts at x=${x} on a ${ctx.viewport.width}px viewport — reachable only by swiping`,
      });
    } else if (x + width > ctx.viewport.width) {
      findings.push({
        rule: "clipped-horizontal",
        law: "Aesthetic and minimalist design",
        severity: 1,
        ref: n.ref,
        role: n.role,
        name: n.name,
        box: n.box,
        measurement: `extends ${x + width - ctx.viewport.width}px past the viewport edge`,
      });
    }

    for (const p of nameProblems(n.name)) {
      findings.push({
        rule: "name-quality",
        law: "Match between system and the real world",
        severity: p.severity,
        ref: n.ref,
        role: n.role,
        name: n.name,
        box: n.box,
        measurement: p.why,
      });
    }
  }

  findings.push(...labelInconsistencies(nodes));
  return findings.sort((a, b) => b.severity - a.severity);
}

function nameProblems(name: string): { why: string; severity: Severity }[] {
  const out: { why: string; severity: Severity }[] = [];
  if (!name) return out;

  if (/^[a-z0-9]+([-_][a-z0-9]+)+$/.test(name))
    out.push({ why: `"${name}" is a developer identifier, announced literally`, severity: 3 });

  if (/\[[^\]]+\]\([^)]+\)/.test(name))
    out.push({ why: "raw Markdown link syntax is the visible label", severity: 3 });

  const markers = name.match(/\*\*|\^[°†*]|[<>]$/g);
  if (markers)
    out.push({ why: `decoration read aloud: ${[...new Set(markers)].join(" ")}`, severity: 2 });

  if (name.length > 60)
    out.push({ why: `${name.length} characters — a paragraph, not a label`, severity: 2 });

  return out;
}

function labelInconsistencies(nodes: MeasuredNode[]): Finding[] {
  const groups = new Map<string, MeasuredNode[]>();

  for (const n of nodes) {
    if (!n.name || !TARGET_ROLES.has(n.role)) continue;
    const key = n.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  const out: Finding[] = [];
  const FORM_PAIR = new Set(["combobox", "textbox", "searchbox", "button"]);
  for (const group of groups.values()) {
    const names = new Set(group.map((n) => n.name));
    const roles = new Set(group.map((n) => n.role));
    if (names.size < 2 && roles.size < 2) continue;

    if (names.size === 1 && [...roles].every((r) => FORM_PAIR.has(r))) continue;

    out.push({
      rule: "label-inconsistency",
      law: "Consistency and standards · Jakob's Law",
      severity: 2,
      ref: group[0].ref,
      role: [...roles].join(" / "),
      name: [...names].join("  ·  "),
      box: group[0].box,
      measurement: `one target, ${names.size} label(s) across ${roles.size} role(s)`,
    });
  }
  return out;
}

function targetSeverity(w: number, h: number): Severity {
  const min = Math.min(w, h);
  const area = w * h;
  if (min < 16) return 4; // cannot be hit reliably at all
  if (min < 28 && area < 1500) return 3; // small in both directions
  if (min < 40) return 2; // short but wide — imprecise, hittable
  return 1; // 40–43px, a near miss
}
