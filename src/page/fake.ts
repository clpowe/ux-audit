import type {
  Box,
  Highlight,
  Layout,
  MeasuredNode,
  Node,
  Page,
  SnapshotOptions,
  Timing,
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
  /** Simulates a geometry inspection failure rather than an unrendered Node. */
  measurementError?: string;
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
  // Typed text is held here rather than written back into the fixtures: states share
  // Node objects (`...content`), so mutating one would leak into the others.
  readonly #typed = new Map<string, string>();
  // Reuse a fixture object across states to represent the same surviving Node.
  // A new object with the same label represents a replacement, not that Node.
  readonly #fixtures = new WeakMap<object, FakeNode>();

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
        value: this.#typed.get(storeKey(key, occurrence)) ?? fixture.value,
        disabled: fixture.disabled,
        focused: fixture.focused,
        depth: fixture.depth ?? 0,
        handle: { key, occurrence } satisfies FakeHandle,
      };
      this.#fixtures.set(node.handle as FakeHandle, fixture);
      if (!opts.boxes) return node;
      if (fixture.measurementError) {
        return {
          ...node,
          measurement: "unavailable" as const,
          box: null,
          measurementError: fixture.measurementError,
        };
      }
      const box = boxOf(fixture, i);
      return box
        ? { ...node, measurement: "measured" as const, box }
        : { ...node, measurement: "not-rendered" as const, box: null };
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

  async isPresent(node: Node): Promise<boolean> {
    const fixture = typeof node.handle === "object" && node.handle !== null
      ? this.#fixtures.get(node.handle)
      : undefined;
    if (!fixture) throw new Error(`cannot inspect ${node.role} "${node.name}" — unknown Node`);
    const i = this.#current().nodes.indexOf(fixture);
    if (i === -1) return false;
    const box = boxOf(fixture, i);
    return box !== null && box.width > 0 && box.height > 0;
  }

  async click(node: Node): Promise<Timing> {
    const target = this.#resolve(node, "click");

    const next = this.#transitions[this.#state]?.[keyOf(target.fixture)];
    if (next === undefined) return NO_RESPONSE;

    if (!this.#states[next]) throw new Error(`transition to unknown state "${next}"`);
    this.#state = next;
    this.#scrollY = Math.min(this.#scrollY, this.#maxScroll());
    return { respondedMs: 0, settledMs: 0, respondedWith: "mutation" };
  }

  /**
   * Typing changes what the control holds and nothing else. A page that answers
   * keystrokes — typeahead, inline validation — is a page this fixture format cannot
   * describe, so the fake reports no response rather than inventing one.
   */
  async type(node: Node, text: string): Promise<Timing> {
    const target = this.#resolve(node, "type");
    this.#typed.set(storeKey(keyOf(target.fixture), occurrenceOf(node)), text);
    return NO_RESPONSE;
  }

  /** The fixture a Node refers to, or a throw naming it. */
  #resolve(node: Node, verb: string): { fixture: FakeNode; i: number } {
    const handle = node.handle as Partial<FakeHandle> | undefined;
    const matches = this.#current()
      .nodes.map((fixture, i) => ({ fixture, i }))
      .filter(({ fixture }) => keyOf(fixture) === handle?.key);
    const target = matches[handle?.occurrence ?? -1];

    if (!target || boxOf(target.fixture, target.i) === null) {
      throw new Error(
        `cannot ${verb} ${node.role} "${node.name}" — not rendered or no longer on the page`,
      );
    }
    return target;
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

const NO_RESPONSE: Timing = { respondedMs: null, settledMs: null, respondedWith: null };

const keyOf = (n: FakeNode) => `${n.role}:${n.name}`;
const storeKey = (key: string, occurrence: number) => `${key}#${occurrence}`;
const occurrenceOf = (node: Node) => (node.handle as Partial<FakeHandle> | undefined)?.occurrence ?? 0;

const boxOf = (n: FakeNode, i: number): Box | null =>
  n.box === undefined ? { x: 0, y: i * 50, width: 100, height: 44 } : n.box;
