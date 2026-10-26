import type { KeyValueStore } from "@key-value-kit/core";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { contextKey, withLock } from "./locks.js";
import { SessionFence } from "./SessionFence.js";

/** A cached value with the session generation it was committed under. */
export type Stamped<T> = { generation: number; value: T };

export interface FencedCacheOptions<T> {
  /** Isolates keys and locks; required when a store is supplied. */
  readonly namespace?: string;
  /**
   * Defaults to a private memory store. A supplied store may be shared with other instances or persisted,
   * so it requires a supplied {@link fence} shared with them (with a durable generation store when the
   * store is persistent): otherwise another instance could repopulate it after this one logged out, or a
   * reload could accept records from before a logout.
   */
  readonly store?: KeyValueStore<Stamped<T>>;
  /** Defaults to a private in-memory fence (this instance only); required with a supplied store. */
  readonly fence?: SessionFence;
}

/** Captured once per operation: the generation and signal every later step is checked against. */
export interface FenceTicket {
  readonly generation: number;
  readonly signal: AbortSignal;
}

/**
 * The logout invariants of {@link OidcSession}, for providers with simpler credentials (LWS access tokens,
 * client credentials): values are stamped with the fence generation and only returned for the same
 * generation; writes happen through {@link SessionFence.commit} after re-checking the caller's signal;
 * {@link forget} supersedes the fence before clearing, so in-flight work cannot repopulate the cache.
 */
export class FencedCache<T extends {}> {
  readonly #kind: string;
  readonly #namespace: string;
  readonly #store: KeyValueStore<Stamped<T>>;
  readonly #fence: SessionFence;
  readonly #keys = new Set<string>();

  constructor(kind: string, options: FencedCacheOptions<T> = {}) {
    if (options.store !== undefined && !options.namespace)
      throw new TypeError("A namespace is required when supplying a store");
    if (options.store !== undefined && options.fence === undefined)
      throw new TypeError(
        "A supplied credential store requires a SessionFence shared by every instance using it",
      );
    this.#kind = kind;
    this.#namespace = options.namespace ?? "default";
    this.#store = options.store ?? createMemoryStore();
    this.#fence =
      options.fence ?? new SessionFence(`local-${crypto.randomUUID()}`, { broadcast: false });
  }

  /** The fence shared by credential acquisition and the client's pre-send validation. */
  get fence(): SessionFence {
    return this.#fence;
  }

  /** Captures the generation and a signal that aborts on supersession. */
  async ticket(signal: AbortSignal): Promise<FenceTicket> {
    const generation = await this.#fence.generation();
    const combined = AbortSignal.any([signal, this.#fence.signalFor(generation)]);
    return { generation, signal: combined };
  }

  async key(parts: readonly (string | undefined)[]): Promise<string> {
    return await contextKey(this.#kind, [this.#namespace, ...parts]);
  }

  /** Runs `callback` under the key's Web Lock after checking the ticket is still current. */
  async locked<R>(key: string, ticket: FenceTicket, callback: () => Promise<R>): Promise<R> {
    return await withLock(
      `reactive-authentication:${key}`,
      async () => {
        await this.assertCurrent(ticket);
        return await callback();
      },
      { signal: ticket.signal },
    );
  }

  /** The value for `key` if it was committed under the ticket's generation. */
  async read(key: string, ticket: FenceTicket): Promise<T | undefined> {
    await this.assertCurrent(ticket);
    const stamped = await this.#store.getItem(key);
    return stamped !== null && stamped.generation === ticket.generation ? stamped.value : undefined;
  }

  async write(key: string, value: T, ticket: FenceTicket): Promise<T> {
    return await this.#fence.commit(
      ticket.generation,
      async () => {
        ticket.signal.throwIfAborted();
        this.#keys.add(key);
        await this.#store.setItem(key, { generation: ticket.generation, value });
        return value;
      },
      ticket.signal,
    );
  }

  async remove(key: string): Promise<void> {
    await this.#store.removeItem(key);
  }

  /**
   * Removes the value under `key` only if `matches` accepts it, under the key's lock — so a late
   * invalidation of an old credential never deletes a replacement committed meanwhile.
   */
  async removeIf(key: string, matches: (value: T) => boolean): Promise<boolean> {
    return await withLock(`reactive-authentication:${key}`, async () => {
      const stamped = await this.#store.getItem(key);
      if (stamped === null || !matches(stamped.value)) return false;
      await this.#store.removeItem(key);
      return true;
    });
  }

  /** Throws if the ticket was aborted or the generation moved on. */
  async assertCurrent(ticket: FenceTicket): Promise<void> {
    ticket.signal.throwIfAborted();
    await this.#fence.assertCurrent(ticket.generation);
    ticket.signal.throwIfAborted();
  }

  /** Supersedes the fence (aborting in-flight work), then clears the store (or the keys written here). */
  async forget(): Promise<void> {
    await this.#fence.supersede(async () => {
      const clearable = this.#store as KeyValueStore<Stamped<T>> & { clear?: () => Promise<void> };
      if (typeof clearable.clear === "function") {
        await clearable.clear();
      } else {
        for (const key of this.#keys) await this.#store.removeItem(key);
      }
      this.#keys.clear();
    });
  }
}
