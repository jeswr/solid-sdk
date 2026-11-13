// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createBrowserCaches, nonReactiveFetch, withLock } from "@jeswr/reactive-authentication";
import { createPodAuth } from "./index.js";
import { protectStore, scopedStore } from "./kv.js";
import { validateOptions } from "./options.js";
import { memoryStore } from "./sessions.js";
import type { Identity, LoginHint, LoginOptions, PodAuth, PodAuthOptions } from "./types.js";

/** A WebID that has no live session in this manager. */
export class UnknownAccountError extends Error {
  constructor(readonly webId: string) {
    super("Unknown account");
    this.name = "UnknownAccountError";
  }
}

interface Pointer {
  webId: string;
  scope: string;
}
interface Remembered {
  entries: Pointer[];
  active: string | null;
}
interface Entry extends Pointer {
  auth: PodAuth;
  identity: Identity;
  stops: (() => void)[];
}
interface Events {
  change: undefined;
  expired: string;
}

/** Independent account sessions with public snapshots and no credential transfer on switching. */
export interface AccountManager {
  accounts(): Identity[];
  active(): Identity | null;
  switchTo(webId: string): Promise<void>;
  add(hint?: LoginHint, options?: LoginOptions): Promise<Identity>;
  remove(webId: string): Promise<void>;
  restoreAll(): Promise<Identity[]>;
  fetchFor(webId: string): typeof fetch;
  fetch: typeof fetch;
  /** The actual core for a live account; null supplies an anonymous React lifecycle adapter. */
  authFor(webId: string | null): PodAuth;
  on<E extends keyof Events>(event: E, handler: (value: Events[E]) => void): () => void;
  /** Cancel pending work and release instances/listeners, retaining remembered sessions. */
  dispose(): void;
}

const snapshot = (identity: Identity): Identity => ({
  ...identity,
  storages: [...identity.storages],
});

/** Create one manager per application. Session scopes keep keys, refresh locks and fences separate. */
export function createAccountManager(options: PodAuthOptions): AccountManager {
  validateOptions(options);
  if (options.lws !== undefined && options.lws.subject !== "oidc-id-token")
    throw new TypeError("Account managers require WebID sessions");
  const namespace = JSON.stringify(["pod-auth-accounts", options.clientId, options.redirectUri]);
  const browser =
    options.storage === undefined && typeof indexedDB !== "undefined"
      ? createBrowserCaches(namespace, { persistSessions: true, wrapFenceStore: protectStore })
      : undefined;
  // The manager uses each account's own core fence, rather than the browser cache's default fence.
  browser?.fence.close();
  const storage = options.storage ?? {
    sessions: browser?.sessions ?? memoryStore(),
    caches: memoryStore(),
  };
  const store = protectStore(scopedStore<Remembered>(storage.sessions, namespace));
  const transport = nonReactiveFetch() as typeof fetch;
  const lifetime = new AbortController();
  let entries = new Map<string, Entry>();
  let active: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const ownedAuths = new Set<PodAuth>();
  const listeners = new Map<keyof Events, Set<(value: never) => void>>();
  const assertOpen = () => lifetime.signal.throwIfAborted();
  const emit = <E extends keyof Events>(event: E, value: Events[E]) => {
    for (const handler of [...(listeners.get(event) ?? [])]) {
      try {
        handler(value as never);
      } catch {
        // Observers cannot interrupt account isolation or each other.
      }
    }
  };
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(async () => {
      assertOpen();
      return await withLock(namespace + ":manager", work, { signal: lifetime.signal });
    });
    tail = result.catch(() => undefined);
    return result;
  };
  const read = async (): Promise<Remembered> => {
    const value = await store.getItem("remembered");
    // Pointers never establish identity. Validate their structure, then let the core verify credentials.
    if (
      value === null ||
      !Array.isArray(value.entries) ||
      !Array.from(value.entries).every(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          typeof entry.webId === "string" &&
          typeof entry.scope === "string" &&
          /^[a-zA-Z0-9-]{1,128}$/.test(entry.scope),
      ) ||
      new Set(value.entries.map((entry) => entry.webId)).size !== value.entries.length ||
      new Set(value.entries.map((entry) => entry.scope)).size !== value.entries.length ||
      !(value.active === null || typeof value.active === "string")
    )
      return { entries: [], active: null };
    return value;
  };
  const persist = async (
    pointers: Pointer[],
    selected: string | null,
    signal = lifetime.signal,
  ) => {
    assertOpen();
    const previous = await store.getItem("remembered");
    signal.throwIfAborted();
    try {
      await store.setItem("remembered", {
        entries: pointers.map(({ webId, scope }) => ({ webId, scope })),
        active: selected,
      });
      signal.throwIfAborted();
    } catch (error) {
      if (previous === null) await store.removeItem("remembered");
      else await store.setItem("remembered", previous);
      throw error;
    }
  };
  const disposeCore = (auth: PodAuth) => {
    if (ownedAuths.delete(auth)) auth.dispose?.();
  };
  const release = (entry: Entry) => {
    for (const stop of entry.stops) stop();
    disposeCore(entry.auth);
  };
  const requireEntry = (webId: string) => {
    assertOpen();
    const entry = entries.get(webId);
    if (entry === undefined) throw new UnknownAccountError(webId);
    return entry;
  };
  const removeEntry = async (entry: Entry) => {
    const remaining = new Map(entries);
    remaining.delete(entry.webId);
    const selected = active === entry.webId ? (remaining.keys().next().value ?? null) : active;
    const remembered = await read();
    const pointers = remembered.entries.filter(
      (pointer) => pointer.webId !== entry.webId || pointer.scope !== entry.scope,
    );
    const rememberedActive = pointers.some((pointer) => pointer.webId === remembered.active)
      ? remembered.active
      : selected;
    await persist(pointers, rememberedActive);
    entries = remaining;
    active = selected;
    for (const stop of entry.stops) stop();
    try {
      await entry.auth.logout({ scope: "session" });
    } finally {
      release(entry);
      emit("change", undefined);
    }
  };
  const attach = (pointer: Pointer, auth: PodAuth, identity: Identity): Entry => {
    const entry: Entry = { ...pointer, auth, identity, stops: [] };
    const removeThisSession = () => {
      void enqueue(async () => {
        // A delayed event from a replaced core must never remove its replacement.
        if (entries.get(entry.webId) === entry) await removeEntry(entry);
      }).catch(() => undefined);
    };
    entry.stops.push(
      auth.on("expired", () => {
        emit("expired", entry.webId);
        removeThisSession();
      }),
      auth.on("logout", removeThisSession),
    );
    return entry;
  };
  const create = (scope: string) => {
    const auth = createPodAuth({ ...options, storage, sessionScope: scope });
    ownedAuths.add(auth);
    return auth;
  };
  const anonymous: PodAuth = {
    fetch: transport,
    identity: async () => null,
    restore: async () => null,
    remembered: async () => [],
    login: (hint, loginOptions) => api.add(hint, loginOptions),
    logout: async () => {},
    retireIfOwnedBy: async () => ({ retired: false, reason: "no-grant" }),
    on: () => () => {},
  };
  const api: AccountManager = {
    accounts: () => [...entries.values()].map((entry) => snapshot(entry.identity)),
    active: () => (active === null ? null : snapshot(requireEntry(active).identity)),
    authFor: (webId) => (webId === null ? anonymous : requireEntry(webId).auth),
    fetchFor: (webId) => requireEntry(webId).auth.fetch,
    fetch: (input, init) => {
      assertOpen();
      return (active === null ? transport : requireEntry(active).auth.fetch)(input, init);
    },
    switchTo: (webId) =>
      enqueue(async () => {
        requireEntry(webId);
        const remembered = await read();
        await persist(remembered.entries, webId);
        active = webId;
        emit("change", undefined);
      }),
    add: async (hint, loginOptions) => {
      assertOpen();
      const signal = AbortSignal.any([
        lifetime.signal,
        ...(loginOptions?.signal === undefined ? [] : [loginOptions.signal]),
      ]);
      signal.throwIfAborted();
      const scope = crypto.randomUUID();
      const auth = create(scope);
      try {
        const identity = await auth.login(hint, { signal });
        if (identity.webId === null) throw new TypeError("Account managers require a WebID");
        const webId = identity.webId;
        return await enqueue(async () => {
          signal.throwIfAborted();
          const remembered = await read();
          signal.throwIfAborted();
          const pointers = new Map(remembered.entries.map((entry) => [entry.webId, entry]));
          const previousPointer = pointers.get(webId);
          pointers.set(webId, { webId, scope });
          await persist([...pointers.values()], webId, signal);
          const previous = entries.get(webId);
          const retired = new Set<PodAuth>();
          if (previous !== undefined) {
            for (const stop of previous.stops) stop();
            retired.add(previous.auth);
          }
          if (previousPointer !== undefined && previousPointer.scope !== previous?.scope)
            retired.add(create(previousPointer.scope));
          entries.set(webId, attach({ webId, scope }, auth, identity));
          active = webId;
          for (const core of retired) {
            // The new scope owns different keys. A failed OP revocation cannot undo the new login.
            await core.logout({ scope: "session" }).catch(() => undefined);
            disposeCore(core);
          }
          assertOpen();
          emit("change", undefined);
          return snapshot(identity);
        });
      } catch (error) {
        if (!lifetime.signal.aborted)
          await auth.logout({ scope: "session" }).catch(() => undefined);
        disposeCore(auth);
        throw error;
      }
    },
    remove: (webId) => enqueue(async () => await removeEntry(requireEntry(webId))),
    restoreAll: () =>
      enqueue(async () => {
        const remembered = await read();
        assertOpen();
        const restored = await Promise.all(
          remembered.entries.map(async (pointer) => {
            assertOpen();
            const candidate = entries.get(pointer.webId);
            const existing = candidate?.scope === pointer.scope ? candidate : undefined;
            const auth = existing?.auth ?? create(pointer.scope);
            // Observe expiry during restore too, before the entry has a verified identity.
            let accepted = false;
            const stop = auth.on("expired", () => {
              if (existing === undefined) emit("expired", pointer.webId);
            });
            try {
              const identity = await auth.restore({ signal: lifetime.signal });
              assertOpen();
              if (identity === null || identity.webId !== pointer.webId) return null;
              accepted = true;
              return existing ?? attach(pointer, auth, identity);
            } catch {
              return null;
            } finally {
              stop();
              if (!accepted && existing === undefined) disposeCore(auth);
            }
          }),
        );
        const next = new Map(
          restored.filter((entry) => entry !== null).map((entry) => [entry.webId, entry]),
        );
        const selected =
          remembered.active !== null && next.has(remembered.active)
            ? remembered.active
            : (next.keys().next().value ?? null);
        try {
          await persist(remembered.entries, selected);
        } catch (error) {
          for (const entry of next.values()) if (entries.get(entry.webId) !== entry) release(entry);
          throw error;
        }
        for (const entry of entries.values()) if (next.get(entry.webId) !== entry) release(entry);
        entries = next;
        active = selected;
        emit("change", undefined);
        return api.accounts();
      }),
    on: (event, handler) => {
      const handlers = listeners.get(event) ?? new Set();
      listeners.set(event, handlers);
      handlers.add(handler as (value: never) => void);
      return () => {
        handlers.delete(handler as (value: never) => void);
      };
    },
    dispose: () => {
      lifetime.abort(new Error("Account manager disposed"));
      for (const entry of entries.values()) release(entry);
      for (const auth of ownedAuths) disposeCore(auth);
      entries.clear();
      active = null;
      listeners.clear();
    },
  };
  return api;
}
