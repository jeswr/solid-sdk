// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChangeEvent, Subscription, SubscriptionState } from "./types.js";

type Listeners = {
  change: (event: ChangeEvent) => void;
  state: (state: SubscriptionState, reason?: string) => void;
  resync: (since: Date) => void;
};
const transitions: Record<SubscriptionState, readonly SubscriptionState[]> = {
  connecting: ["live", "degraded", "closed"],
  live: ["degraded", "closed"],
  degraded: ["live", "closed"],
  closed: [],
};

/** Internal controller shared by channels; closed is terminal and cleanup is idempotent. */
export class SubscriptionController implements Subscription {
  readonly topics: readonly string[];
  state: SubscriptionState = "connecting";
  channel: ChangeEvent["via"] | null = null;
  private readonly listeners = {
    change: new Set<Listeners["change"]>(),
    state: new Set<Listeners["state"]>(),
    resync: new Set<Listeners["resync"]>(),
  };
  private readonly finish = new Set<() => void>();
  private closing?: Promise<void>;
  cleanup: () => void = () => {};

  constructor(topics: readonly string[]) {
    this.topics = Object.freeze([...topics]);
  }

  on<K extends keyof Listeners>(event: K, handler: Listeners[K]): () => void {
    if (this.state === "closed") return () => {};
    const listeners = this.listeners[event] as Set<Listeners[K]>;
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }

  transition(state: SubscriptionState, reason?: string): void {
    if (!transitions[this.state].includes(state)) return;
    this.state = state;
    for (const handler of this.listeners.state) handler(state, reason);
  }

  change(event: ChangeEvent): void {
    if (this.state === "closed") return;
    for (const handler of this.listeners.change) handler(event);
  }

  resync(since: Date): void {
    if (this.state === "closed") return;
    for (const handler of this.listeners.resync) handler(since);
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = Promise.resolve();
      this.transition("closed");
      this.cleanup();
      for (const finish of this.finish) finish();
      for (const listeners of Object.values(this.listeners)) listeners.clear();
    }
    return this.closing;
  }

  [Symbol.asyncIterator](): AsyncIterator<ChangeEvent> {
    const queue: ChangeEvent[] = [];
    const waiters: ((result: IteratorResult<ChangeEvent>) => void)[] = [];
    let ended = this.state === "closed";
    const off = this.on("change", (value) => {
      const waiter = waiters.shift();
      if (waiter) waiter({ value, done: false });
      else queue.push(value);
    });
    const finish = () => {
      ended = true;
      queue.length = 0;
      off();
      this.finish.delete(finish);
      for (const resolve of waiters.splice(0)) resolve({ value: undefined, done: true });
    };
    if (!ended) this.finish.add(finish);
    return {
      next: () => {
        if (ended) return Promise.resolve({ value: undefined, done: true });
        const value = queue.shift();
        if (value) return Promise.resolve({ value, done: false });
        return new Promise((resolve) => {
          waiters.push(resolve);
        });
      },
      return: async () => {
        finish();
        return { value: undefined, done: true };
      },
    };
  }
}
