import type { Finding, Severity } from "./rules";
import type { Box } from "./geometry";

export type Observation = { rule: string; law: string; detail: string; severity: Severity };

export type GroupedFinding = {
  id: string;
  severity: Severity;
  kind: "page" | "repeated" | "element";
  role: string;
  name: string;
  count: number;
  box: Box | null;
  boxes: Box[];
  observations: Observation[];
};

const obs = (f: Finding): Observation => ({
  rule: f.rule,
  law: f.law,
  detail: f.measurement,
  severity: f.severity,
});

export function group(findings: Finding[]): GroupedFinding[] {
  const out: GroupedFinding[] = [];
  const rest: Finding[] = [];

  for (const f of findings) {
    if (f.ref === null) {
      out.push({
        id: "",
        severity: f.severity,
        kind: "page",
        role: f.role,
        name: f.name,
        count: 1,
        box: null,
        boxes: [],
        observations: [obs(f)],
      });
    } else {
      rest.push(f);
    }
  }

  // Repeated components: same rule, role, height and severity.
  // Height rather than full box, so a row of text links groups even at different widths.
  const buckets = new Map<string, Finding[]>();
  for (const f of rest) {
    const band = f.box ? Math.round(f.box.height / 4) * 4 : "none";
    const key = `${f.rule}|${f.role}|${band}|${f.severity}`;

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(f);
  }

  const singles: Finding[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 3) {
      singles.push(...bucket);
      continue;
    }
    const first = bucket[0];
    if (!first) continue;
    const sample = bucket
      .slice(0, 3)
      .map((b) => b.name || "⟨no name⟩")
      .join(", ");

    const details = new Set(bucket.map((b) => b.measurement));
    const detail =
      details.size === 1
        ? `${bucket.length} sibling elements, each: ${first.measurement}`
        : `${bucket.length} sibling elements, e.g. ${first.measurement}`;

    out.push({
      id: "",
      severity: first.severity,
      kind: "repeated",
      role: first.role,
      name: `${bucket.length} × ${first.role} — ${sample}${bucket.length > 3 ? ", …" : ""}`,
      count: bucket.length,
      box: first.box,
      boxes: bucket.map((b) => b.box).filter((b): b is Box => !!b && b.rendered),
      observations: [
        {
          rule: first.rule,
          law: first.law,
          severity: first.severity,
          detail,
        },
      ],
    });
  }

  // Everything left: one finding per element, observations merged.
  const byRef = new Map<number, Finding[]>();
  for (const f of singles) {
    if (!byRef.has(f.ref!)) byRef.set(f.ref!, []);
    byRef.get(f.ref!)!.push(f);
  }

  for (const bucket of byRef.values()) {
    const first = bucket[0];
    out.push({
      id: "",
      severity: Math.max(...bucket.map((b) => b.severity)) as Severity,
      kind: "element",
      role: first.role,
      name: first.name,
      count: 1,
      box: first.box,
      boxes: first.box?.rendered ? [first.box] : [],
      observations: bucket.map(obs),
    });
  }

  out.sort((a, b) => b.severity - a.severity || b.observations.length - a.observations.length);
  out.forEach((f, i) => {
    f.id = `F-${String(i + 1).padStart(2, "0")}`;
  });
  return out;
}
