import type {
  Box,
  Highlight,
  Layout,
  MeasuredNode,
  Node,
  Page,
  SnapshotOptions,
} from "./page";

/**
 * A Node as written in a fixture. `ref` and `handle` are assigned by the FakePage.
 * `box` defaults to a rendered 100×44 box stacked by position; pass `null` for a Node
 * that is in the accessibility tree but not rendered.
 */
export type FakeNode = {
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  focused?: boolean;
  depth?: number;
  box?: Box | null;
};

export type FakeState = {
  nodes: FakeNode[];
  pageHeight?: number;
};

export type FakePageOptions = {
  initial: string;
  states: Record<string, FakeState>;
  /** state → "role:name" of the clicked Node → next state. Clicks with no entry leave the state unchanged. */
  transitions?: Record<string, Record<string, string>>;
  viewport?: { width: number; height: number };
};

type FakeHandle = { key: string; occurrence: number };

export class FakePage implements Page {
  readonly #states: Record<string, FakeState>;
  readonly #transitions: Record<string, Record<string, string>>;
  readonly #viewport: { width: number; height: number };
  #state: string;
  #scrollY = 0;
  #highlights: Highlight[] = [];

  constructor(opts: FakePageOptions) {
    if (!opts.states[opts.initial]) throw new Error(`unknown initial state "${opts.initial}"`);
    this.#states = opts.states;
    this.#transitions = opts.transitions ?? {};
    this.#viewport = opts.viewport ?? { width: 390, height: 844 };
    this.#state = opts.initial;
  }

  /** Name of the current state, for assertions. */
  get state(): string {
    return this.#state;
  }

  /** Highlights currently drawn, for assertions. */
  get highlights(): readonly Highlight[] {
    return this.#highlights;
  }

  snapshot(opts: SnapshotOptions & { boxes: true }): Promise<MeasuredNode[]>;
  snapshot(opts?: SnapshotOptions): Promise<Node[]>;
  async snapshot(opts: SnapshotOptions = {}): Promise<Node[] | MeasuredNode[]> {
    const seen = new Map<string, number>();

    return this.#current().nodes.map((fixture, i) => {
      const key = keyOf(fixture);
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);

      const node: Node = {
        ref: i,
        role: fixture.role,
        name: fixture.name,
        value: fixture.value,
        disabled: fixture.disabled,
        focused: fixture.focused,
        depth: fixture.depth ?? 0,
        handle: { key, occurrence } satisfies FakeHandle,
      };
      return opts.boxes ? { ...node, box: boxOf(fixture, i) } : node;
    });
  }

  async layout(): Promise<Layout> {
    return {
      scrollX: 0,
      scrollY: this.#scrollY,
      width: this.#viewport.width,
      height: this.#viewport.height,
      pageHeight: this.#pageHeight(),
    };
  }

  async click(node: Node): Promise<void> {
    const handle = node.handle as Partial<FakeHandle> | undefined;
    const matches = this.#current().nodes
      .map((fixture, i) => ({ fixture, i }))
      .filter(({ fixture }) => keyOf(fixture) === handle?.key);
    const target = matches[handle?.occurrence ?? -1];

    if (!target || boxOf(target.fixture, target.i) === null) {
      throw new Error(
        `cannot click ${node.role} "${node.name}" — not rendered or no longer on the page`,
      );
    }

    const next = this.#transitions[this.#state]?.[target.fixture.role + ":" + target.fixture.name];
    if (next !== undefined) {
      if (!this.#states[next]) throw new Error(`transition to unknown state "${next}"`);
      this.#state = next;
      this.#scrollY = Math.min(this.#scrollY, this.#maxScroll());
    }
  }

  async scrollTo(y: number): Promise<void> {
    this.#scrollY = Math.max(0, Math.min(y, this.#maxScroll()));
  }

  async prime(): Promise<void> {
    this.#scrollY = 0;
  }

  async highlight(highlights: Highlight[]): Promise<void> {
    this.#highlights = [...highlights];
  }

  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array();
  }

  #current(): FakeState {
    return this.#states[this.#state]!;
  }

  #pageHeight(): number {
    const { nodes, pageHeight } = this.#current();
    if (pageHeight !== undefined) return pageHeight;
    const bottom = nodes.reduce((max, n, i) => {
      const box = boxOf(n, i);
      return box ? Math.max(max, box.y + box.height) : max;
    }, 0);
    return Math.max(bottom, this.#viewport.height);
  }

  #maxScroll(): number {
    return Math.max(0, this.#pageHeight() - this.#viewport.height);
  }
}

const keyOf = (n: FakeNode) => `${n.role}:${n.name}`;

const boxOf = (n: FakeNode, i: number): Box | null =>
  n.box === undefined ? { x: 0, y: i * 50, width: 100, height: 44 } : n.box;
