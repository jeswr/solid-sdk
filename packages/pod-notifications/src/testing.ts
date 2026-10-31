// AUTHORED-BY Codex GPT-6.1-Sol
import type { Timers, TransportEvents, WebSocketLike } from "./types.js";

/** Deterministic clock/scheduler; advancing awaits asynchronous channel callbacks. */
export class FakeTimers implements Timers {
  private time: number;
  private sequence = 0;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  constructor(start = 0) {
    this.time = start;
  }
  readonly now = (): number => this.time;
  get pending(): number {
    return this.tasks.size;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = ++this.sequence;
    this.tasks.set(handle, { at: this.time + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  /** Run due callbacks in deadline/insertion order; newly scheduled timers also participate. */
  async advanceBy(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0)
      throw new TypeError("Advance must be finite and nonnegative");
    const end = this.time + ms;
    while (true) {
      const next = [...this.tasks]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.time = next[1].at;
      this.tasks.delete(next[0]);
      await next[1].callback();
    }
    this.time = end;
  }
}

/** Manual transport with explicit open/message/error/close events and listener cleanup checks. */
export class FakeEventSource {
  readyState = 0;
  private lastEventId = "";
  readonly url: string;
  private readonly listeners = new Map<keyof TransportEvents, Set<(event: never) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((count, handlers) => count + handlers.size, 0);
  }

  addEventListener<K extends keyof TransportEvents>(
    type: K,
    handler: (event: TransportEvents[K]) => void,
  ): void {
    let handlers = this.listeners.get(type);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(type, handlers);
    }
    handlers.add(handler as (event: never) => void);
  }

  removeEventListener<K extends keyof TransportEvents>(
    type: K,
    handler: (event: TransportEvents[K]) => void,
  ): void {
    this.listeners.get(type)?.delete(handler as (event: never) => void);
  }

  /** Deliver an event exactly as a channel's browser adapter would. */
  dispatch<K extends keyof TransportEvents>(type: K, event: TransportEvents[K]): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event as never);
  }

  open(): void {
    this.readyState = 1;
    this.dispatch("open", {});
  }
  message(data: unknown, lastEventId = ""): void {
    this.lastEventId = lastEventId;
    this.dispatch("message", { data, lastEventId });
  }
  /** Model a native recoverable drop and expose the next request's replay header. */
  reconnect(): Record<string, string> {
    this.readyState = 0;
    this.error();
    return this.lastEventId ? { "Last-Event-ID": this.lastEventId } : {};
  }
  error(): void {
    this.dispatch("error", {});
  }
  close(): void {
    this.readyState = 2;
    this.dispatch("close", {});
  }
}

/** Fake socket records sent text and fails sends before open or after close. */
export class FakeWebSocket extends FakeEventSource implements WebSocketLike {
  readonly sent: string[] = [];
  constructor(
    url: string,
    readonly protocols: string[] = [],
  ) {
    super(url);
  }
  send(data: string): void {
    if (this.readyState !== 1) throw new Error("Socket is not open");
    this.sent.push(data);
  }
  override close(): void {
    this.readyState = 3;
    this.dispatch("close", {});
  }
}
