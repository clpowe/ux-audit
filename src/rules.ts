import type { MeasuredNode, Box } from "./page/page";
import type { DismissalResult } from "./overlay";

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
  /**
   * Evidence captured at the moment the finding occurred. Only for findings that
   * cannot be photographed afterwards, because acting on them destroyed the view.
   */
  shot?: Uint8Array;
};

export type AuditNotice = {
  kind: "measurement-unavailable";
  ref: number;
  role: string;
  name: string;
  detail: string;
};

export type RuleResult = { findings: Finding[]; notices: AuditNotice[] };

export type PageContext = {
  viewport: { width: number; height: number };
  pageHeight: number;
  overlayAttempts: DismissalResult[];
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

// A skip link is positioned at negative coordinates until it receives focus.
// Its box is deliberately tiny and out of frame, so size rules don't apply.
const offscreenByDesign = (name: string, box: Box) =>
  /^skip to/i.test(name) || box.y + box.height <= 0 || box.x + box.width <= 0;

// A control clipped down to a few pixels is not a small target — it is a control
// nobody is shown. Ashley's "Promo 1" is a 2×12 button inside a 1×1 parent.
const unpresented = (box: Box) =>
  Math.min(box.width, box.height) < 4 || box.width * box.height < 64;

export function runRules(nodes: MeasuredNode[], ctx: PageContext): RuleResult {
  const findings: Finding[] = [];
  const notices: AuditNotice[] = [];

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

  for (const o of ctx.overlayAttempts) {
    findings.push({
      rule: o.status === "dismissed" ? "blocking-overlay" : `overlay-${o.status}`,
      law: "User control and freedom",
      severity: 2,
      ref: null,
      role: "dialog",
      name: o.name,
      box: null,
      shot: o.shot,
      measurement: o.status === "dismissed"
        ? `dismissal confirmed after clicking "${o.attemptedWith}"`
        : o.status === "remained"
          ? `Overlay remained rendered after clicking "${o.attemptedWith}"; audit continued with a potentially obstructed Page`
          : `dismissal unverified after attempting "${o.attemptedWith}": ${o.reason}; audit continued; the Overlay may still obstruct the Page`,
    });
  }

  for (const node of nodes) {
    if (!TARGET_ROLES.has(node.role)) continue;

    if (node.measurement === "unavailable") {
      notices.push({
        kind: "measurement-unavailable",
        ref: node.ref,
        role: node.role,
        name: node.name,
        detail: node.measurementError,
      });
      continue;
    }

    // Both branches are observed presentation defects. Inspection failures were
    // separated above and must never become UX Findings.
    if (node.measurement === "not-rendered" || unpresented(node.box)) {
      findings.push({
        rule: "phantom-node",
        law: "Visibility of system status",
        severity: 3,
        ref: node.ref,
        role: node.role,
        name: node.name,
        box: null,
        measurement: node.measurement === "measured"
          ? `${node.box.width}×${node.box.height}px — clipped out of the presentation, announced but not visible`
          : "in the accessibility tree but not rendered — announced, not visible",
      });
      continue;
    }

    const { x, y, width, height } = node.box;

    if (!offscreenByDesign(node.name, node.box) && (width < MIN_TARGET || height < MIN_TARGET)) {
      findings.push({
        rule: "tap-target",
        law: "Fitts's Law · WCAG 2.5.5 Target Size",
        severity: targetSeverity(width, height),
        ref: node.ref,
        role: node.role,
        name: node.name,
        box: node.box,
        measurement: `${width}×${height}px against a ${MIN_TARGET}×${MIN_TARGET} minimum`,
      });
    }

    // Fix 2: horizontal reach.
    if (x >= ctx.viewport.width) {
      findings.push({
        rule: "offscreen-horizontal",
        law: "Discoverability · Hick's Law",
        severity: 2,
        ref: node.ref,
        role: node.role,
        name: node.name,
        box: node.box,
        measurement: `starts at x=${x} on a ${ctx.viewport.width}px viewport — reachable only by swiping`,
      });
    } else if (x + width > ctx.viewport.width) {
      findings.push({
        rule: "clipped-horizontal",
        law: "Aesthetic and minimalist design",
        severity: 1,
        ref: node.ref,
        role: node.role,
        name: node.name,
        box: node.box,
        measurement: `extends ${x + width - ctx.viewport.width}px past the viewport edge`,
      });
    }

    for (const p of nameProblems(node.name)) {
      findings.push({
        rule: "name-quality",
        law: "Match between system and the real world",
        severity: p.severity,
        ref: node.ref,
        role: node.role,
        name: node.name,
        box: node.box,
        measurement: p.why,
      });
    }
  }

  findings.push(...labelInconsistencies(nodes));
  return { findings: findings.sort((a, b) => b.severity - a.severity), notices };
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

  for (const node of nodes) {
    if (!node.name || !TARGET_ROLES.has(node.role)) continue;
    const key = node.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(node);
  }

  const out: Finding[] = [];
  const FORM_PAIR = new Set(["combobox", "textbox", "searchbox", "button"]);
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const names = new Set(group.map((n) => n.name));
    const roles = new Set(group.map((n) => n.role));
    if (names.size < 2 && roles.size < 2) continue;

    if (names.size === 1 && [...roles].every((r) => FORM_PAIR.has(r))) continue;

    out.push({
      rule: "label-inconsistency",
      law: "Consistency and standards · Jakob's Law",
      severity: 2,
      ref: first.ref,
      role: [...roles].join(" / "),
      name: [...names].join("  ·  "),
      box: first.box,
      measurement: `one target, ${names.size} label(s) across ${roles.size} role(s)`,
    });
  }
  return out;
}

/**
 * No measured rule returns 4. A blocker means the task could not be completed, and
 * geometry alone cannot observe that — only a mission that failed can.
 */
function targetSeverity(w: number, h: number): Severity {
  const min = Math.min(w, h);
  if (min < 16) return 3; // hittable only with precise aim
  if (min < 40) return 2; // imprecise, but reliably hittable
  return 1; // 40–43px, a near miss
}
