import type { Node } from "./page/page";

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** A Snapshot as indented text: one Node per row, ref first. What the probe's model perceives. */
export function render(nodes: Node[]): string {
  return nodes
    .map((n) => {
      const pad = "  ".repeat(n.depth);
      const name = n.name ? ` "${trunc(n.name, 80)}"` : "  ⟨no accessible name⟩";
      const value = n.value ? ` = "${trunc(String(n.value), 40)}"` : "";
      const flags = [n.disabled && "disabled", n.focused && "focused"].filter(Boolean);
      return (
        `${String(n.ref).padStart(3)}  ${pad}${n.role}${name}${value}` +
        (flags.length ? ` [${flags.join(" ")}]` : "")
      );
    })
    .join("\n");
}
