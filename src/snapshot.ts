export type AxNode = {
  ref: number;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  focused?: boolean;
  backendDOMNodeId?: number;
  depth: number;
};

const INTERACTIVE = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "treeitem",
  "DisclosureTriangle",
]);

const STRUCTURAL = new Set([
  "RootWebArea",
  "heading",
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "form",
  "search",
  "dialog",
  "alertdialog",
  "alert",
  "status",
  "list",
  "table",
  "region",
  "tablist",
  "tabpanel",
]);

const prop = (node: any, name: string) =>
  node.properties?.find((p: any) => p.name === name)?.value?.value;

export async function snapshot(
  cdp: import("./cdp").CDP,
  sessionId: string,
  opts: { all?: boolean } = {},
): Promise<AxNode[]> {
  await cdp.send("Accessibility.enable", {}, sessionId);
  const { nodes } = await cdp.send("Accessibility.getFullAXTree", {}, sessionId);

  const byId = new Map<string, any>(nodes.map((n: any) => [n.nodeId, n]));
  const root = nodes.find((n: any) => !n.parentId) ?? nodes[0];

  const out: AxNode[] = [];
  let ref = 0;

  const walk = (node: any, depth: number, parentName: string) => {
    const role = node.role?.value ?? "";
    const name = (node.name?.value ?? "").trim();
    const duplicate = name !== "" && name === parentName;
    const keep =
      !node.ignored && !duplicate && (opts.all || INTERACTIVE.has(role) || STRUCTURAL.has(role));

    let childDepth = depth;
    if (keep) {
      out.push({
        ref: ref++,
        role,
        name,
        value: node.value?.value,
        disabled: prop(node, "disabled"),
        focused: prop(node, "focused"),
        backendDOMNodeId: node.backendDOMNodeId,
        depth,
      });
      childDepth = depth + 1;
    }

    for (const cid of node.childIds ?? []) {
      const child = byId.get(cid);
      if (child) walk(child, childDepth, name || parentName);
    }
  };

  walk(root, 0, "");
  return out;
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function render(nodes: AxNode[]): string {
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
