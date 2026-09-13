type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class CDP {
  #ws: WebSocket;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #listeners = new Map<string, Set<(params: any) => void>>();

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", (ev) => this.#onMessage(String(ev.data)));
  }

  static async connect(wsUrl: string): Promise<CDP> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`CDP connect failed: ${wsUrl}`)), {
        once: true,
      });
    });
    return new CDP(ws);
  }

  #onMessage(raw: string) {
    const msg = JSON.parse(raw);

    if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.method ?? "cdp"}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }

    if (msg.method) {
      const keys = msg.sessionId ? [`${msg.sessionId}:${msg.method}`, msg.method] : [msg.method];
      for (const k of keys) for (const fn of this.#listeners.get(k) ?? []) fn(msg.params);
    }
  }

  send(method: string, params: any = {}, sessionId?: string, timeoutMs = 15_000): Promise<any> {
    const id = this.#nextId++;
    const payload: any = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.#ws.send(JSON.stringify(payload));
    });
  }

  on(method: string, fn: (params: any) => void, sessionId?: string) {
    const key = sessionId ? `${sessionId}:${method}` : method;
    if (!this.#listeners.has(key)) this.#listeners.set(key, new Set());
    this.#listeners.get(key)!.add(fn);
    return () => {
      this.#listeners.get(key)!.delete(fn);
    };
  }

  once(method: string, sessionId?: string, timeoutMs = 30_000): Promise<any> {
    return new Promise((resolve, reject) => {
      let off: () => void;
      const timer = setTimeout(() => {
        off?.();
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      off = this.on(
        method,
        (params) => {
          clearTimeout(timer);
          off();
          resolve(params);
        },
        sessionId,
      );
    });
  }

  close() {
    this.#ws.close();
  }
}
