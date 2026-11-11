// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createQueue, type RecordValue } from "./cache.js";
import { createRemote, type PreferencesOptions } from "./remote.js";
import { assertSize, encode, PreferencesError, validateKey } from "./value.js";

export type { PreferencesOptions, PreferencesTypeIndex } from "./remote.js";
export { PreferencesError } from "./value.js";

export interface PreferencesSchema<T> {
  parse(value: unknown): T;
}
export interface UsePreferencesResult<T> {
  value: T;
  set(next: T | ((current: T) => T)): Promise<void>;
  loading: boolean;
  pending: boolean;
  error: unknown;
}
export interface PreferencesHook {
  <T>(key: string, schema: PreferencesSchema<T>, defaultValue: T): UsePreferencesResult<T>;
  /** Retry pending values in their original per-key order. Failures populate hook error state. */
  flush(): Promise<void>;
  /** Revoke retained setters and abort storage operations on logout/session replacement. */
  dispose(): void;
}
interface Snapshot {
  json: string | undefined;
  loading: boolean;
  pending: boolean;
  error: unknown;
}
interface Entry {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  revision: number;
  order: number;
  load?: Promise<void>;
}

/** One factory per authenticated account session. Construction performs no I/O. */
export function createPreferences(options: PreferencesOptions): PreferencesHook {
  const { webId, storage } = options;
  const lifetime = new AbortController();
  const remote = createRemote(options, lifetime.signal);
  const queue = createQueue(webId, storage.root);
  const entries = new Map<string, Entry>();
  const pending = new Map<string, RecordValue>();
  const warned = new Set<string>();
  let channel: BroadcastChannel | undefined;
  let started: Promise<void> | undefined;
  let flight: Promise<void> | undefined;
  let serial: Promise<unknown> = Promise.resolve();
  let order = Date.now();
  const online = () => typeof navigator === "undefined" || navigator.onLine;
  function active() {
    if (lifetime.signal.aborted) throw new PreferencesError("session-changed");
  }
  function entry(key: string): Entry {
    let item = entries.get(key);
    if (!item) {
      item = {
        snapshot: { json: undefined, loading: true, pending: false, error: undefined },
        listeners: new Set(),
        revision: 0,
        order: 0,
      };
      entries.set(key, item);
    }
    return item;
  }
  function update(item: Entry, patch: Partial<Snapshot>) {
    if (lifetime.signal.aborted) return;
    item.snapshot = { ...item.snapshot, ...patch };
    for (const listener of item.listeners) listener();
  }
  function persist(work: () => Promise<void>) {
    const result = serial
      .catch(() => {})
      .then(() => {
        active();
        return work();
      });
    serial = result;
    return result;
  }
  function valid(record: RecordValue): boolean {
    if (
      record?.v !== 1 ||
      record.webId !== webId ||
      record.root !== storage.root ||
      typeof record.key !== "string" ||
      typeof record.json !== "string" ||
      typeof record.pending !== "boolean" ||
      !Number.isSafeInteger(record.order) ||
      record.order < 0 ||
      typeof record.token !== "string" ||
      !record.token
    )
      return false;
    try {
      validateKey(record.key);
      assertSize(record.json);
      encode(JSON.parse(record.json));
      return true;
    } catch {
      return false;
    }
  }
  function receive(event: MessageEvent<RecordValue>) {
    const record = event.data;
    if (!valid(record) || lifetime.signal.aborted) return;
    order = Math.max(order, record.order);
    const item = entry(record.key);
    if (pending.has(record.key) || record.order < item.order) return;
    item.order = record.order;
    item.revision++;
    remote.invalidate(record.key);
    update(item, { json: record.json, loading: false, error: undefined });
  }
  function start() {
    active();
    if (!started) {
      if (!channel && typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("suite-prefs");
        channel.onmessage = receive;
      }
      globalThis.addEventListener?.("online", onOnline);
      started = queue
        .list()
        .then((records) => {
          active();
          for (const record of records) {
            if (!valid(record)) continue;
            const item = entry(record.key);
            order = Math.max(order, record.order);
            if (item.revision) continue;
            item.order = record.order;
            if (record.pending) pending.set(record.key, record);
            update(item, { json: record.json, loading: false, pending: record.pending });
          }
        })
        .catch((error) => {
          started = undefined;
          throw error;
        });
    }
    return started;
  }
  async function load(key: string, item: Entry) {
    let revision = item.revision;
    try {
      await start();
      active();
      if (pending.has(key)) {
        await flush();
        return;
      }
      revision = item.revision;
      if (online()) {
        const json = await remote.read(key);
        active();
        if (revision !== item.revision) return;
        if (json !== undefined) {
          assertSize(json);
          // Bad schema/JSON remains visible to the hook's single-warning fallback parser.
          await persist(() =>
            queue.put({
              v: 1,
              webId,
              root: storage.root,
              key,
              json,
              pending: false,
              order: item.order,
              token: crypto.randomUUID(),
            }),
          );
          if (revision !== item.revision) return;
        }
        update(item, { json, loading: false });
      } else update(item, { loading: false });
      await flush(); // Also replay cached keys with no mounted consumer.
    } catch (error) {
      if (revision === item.revision) update(item, { error, loading: false });
    }
  }
  async function drain() {
    try {
      await start();
    } catch (error) {
      for (const item of entries.values()) update(item, { error, loading: false });
      return;
    }
    while (!lifetime.signal.aborted && online() && pending.size) {
      const record = [...pending.values()].sort((a, b) => a.order - b.order)[0] as RecordValue;
      const item = entry(record.key);
      try {
        await persist(() => queue.put(record));
        active();
        await remote.put(record.key, record.json);
        active();
        await persist(() => queue.acknowledge(record));
        active();
        if (pending.get(record.key)?.token === record.token) {
          pending.delete(record.key);
          update(item, { pending: false, error: undefined, loading: false });
          channel?.postMessage({ ...record, pending: false });
        }
      } catch (error) {
        update(item, { error, loading: false });
        return;
      }
    }
  }
  function flush(): Promise<void> {
    active();
    flight ??= drain().finally(() => {
      flight = undefined;
    });
    return flight;
  }
  function onOnline() {
    void flush();
  }
  function parse<T>(
    key: string,
    json: string | undefined,
    schema: PreferencesSchema<T>,
    fallback: T,
  ): T {
    if (json === undefined) return fallback;
    try {
      return schema.parse(JSON.parse(json));
    } catch {
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`Invalid preference schema for ${key}; using default`);
      }
      return fallback;
    }
  }
  const usePreferences = <T>(
    key: string,
    schema: PreferencesSchema<T>,
    defaultValue: T,
  ): UsePreferencesResult<T> => {
    validateKey(key);
    encode(defaultValue);
    const item = entry(key);
    const committed = useRef<object | null>(null);
    const session = useMemo(() => ({ item }), [item]);
    useLayoutEffect(() => {
      committed.current = session;
      return () => {
        committed.current = null;
      };
    }, [session]);
    const subscribe = useMemo(
      () => (listener: () => void) => {
        item.listeners.add(listener);
        // A speculative render never opens a database, channel or authenticated request.
        queueMicrotask(() => {
          if (committed.current === session && !lifetime.signal.aborted)
            item.load ??= load(key, item);
        });
        return () => {
          item.listeners.delete(listener);
        };
      },
      [item, key, session],
    );
    const snapshot = useSyncExternalStore(
      subscribe,
      () => item.snapshot,
      () => item.snapshot,
    );
    const set = useMemo(
      () => async (next: T | ((current: T) => T)) => {
        active();
        if (committed.current !== session) throw new PreferencesError("session-changed");
        const value =
          typeof next === "function"
            ? (next as (current: T) => T)(parse(key, item.snapshot.json, schema, defaultValue))
            : next;
        const json = encode(schema.parse(value));
        const record: RecordValue = {
          v: 1,
          webId,
          root: storage.root,
          key,
          json,
          pending: true,
          order: ++order,
          token: crypto.randomUUID(),
        };
        item.revision++;
        item.order = record.order;
        pending.set(key, record);
        update(item, { json, pending: true, loading: false, error: undefined });
        try {
          await start();
          // Hydration may have observed a sequence from before a clock change/restart.
          record.order = ++order;
          if (pending.get(key)?.token === record.token) item.order = record.order;
          await persist(() => queue.put(record));
          active();
          channel?.postMessage(record);
          await flush();
        } catch (error) {
          update(item, { error });
        }
      },
      [item, key, schema, defaultValue, session],
    );
    return {
      value: parse(key, snapshot.json, schema, defaultValue),
      set,
      loading: snapshot.loading,
      pending: snapshot.pending,
      error: snapshot.error,
    };
  };
  return Object.assign(usePreferences, {
    flush,
    dispose() {
      lifetime.abort();
      globalThis.removeEventListener?.("online", onOnline);
      channel?.close();
      entries.clear();
      pending.clear();
    },
  });
}
