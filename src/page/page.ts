export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Node = {
  /** Position in the Snapshot it came from. Meaningless in any other Snapshot. */
  ref: number;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  focused?: boolean;
  depth: number;
  /** Opaque to callers; only the Page that produced the Node can interpret it. */
  handle: unknown;
};

/** `box` is null when the Node is in the accessibility tree but not rendered. */
export type MeasuredNode = Node & { box: Box | null };

export type Layout = {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  pageHeight: number;
};

/** Page coordinates, not viewport coordinates: stays aligned as the Page scrolls. */
export type Highlight = {
  box: Box;
  color: string;
  label: string;
};

export type SnapshotOptions = {
  boxes?: boolean;
  /** Skip role filtering. Honoured by adapters that have an unfiltered tree to offer. */
  all?: boolean;
};

export interface Page {
  snapshot(opts: SnapshotOptions & { boxes: true }): Promise<MeasuredNode[]>;
  snapshot(opts?: SnapshotOptions): Promise<Node[]>;

  layout(): Promise<Layout>;

  /** Returns once the Page has settled. Throws, naming the Node, if it is not rendered or no longer on the Page. */
  click(node: Node): Promise<Timing>;

  /** Returns once the Page has settled; Highlights move with the content. */
  scrollTo(y: number): Promise<void>;

  /** Scrolls the full Page once so lazy content loads, then returns to the top. */
  prime(): Promise<void>;

  /** Replaces any Highlights already drawn. */
  highlight(highlights: Highlight[]): Promise<void>;

  /** PNG bytes of the current viewport, Highlights included. */
  screenshot(): Promise<Uint8Array>;
  type(node: Node, text: string): Promise<Timing>;
}

export type Timing = {
  respondedMs: number | null;
  settledMs: number | null;
  respondedWith: "mutation" | "focus" | null;
};
