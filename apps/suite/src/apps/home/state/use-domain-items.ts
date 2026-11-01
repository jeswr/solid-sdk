// AUTHORED-BY Codex GPT-6
"use client";
import type { TypedViewData } from "@jeswr/suite-ui";
import { useEffect, useSyncExternalStore } from "react";
import { typedViewData } from "../../../components/typed-view-data";
import type { PodSession } from "../../../lib/session/pod-session";
import { type DomainItem, discoverDomainItems } from "../lib/model/discovery";
import { DiscoveryBudget } from "../lib/model/discovery-budget";
import { DOMAINS, UNCATEGORISED } from "../lib/model/domains";
import { readResource, subjectOf } from "../lib/model/rdf";
import { type DiscoveryFailure, readTypeIndexes } from "../lib/model/type-index";
import { cardView } from "./presentation";

interface Snapshot {
  status: "loading" | "ready" | "error";
  items: readonly DomainItem[];
  views: ReadonlyMap<DomainItem, TypedViewData>;
  failures: readonly DiscoveryFailure[];
  counts: ReadonlyMap<string, number>;
  truncated: boolean;
  refreshing: boolean;
  used: number;
  updated: number;
}
const initial: Snapshot = {
  status: "loading",
  items: [],
  views: new Map(),
  failures: [],
  counts: new Map(),
  truncated: false,
  refreshing: false,
  used: 0,
  updated: 0,
};
export interface HomeSession extends PodSession {
  readonly caps?: { readonly liveUpdates: boolean };
}

const stores = new WeakMap<HomeSession, ReturnType<typeof createDomainStore>>();

/** One store per session object: navigation shares requests; another account never shares data. */
export function domainStore(session: HomeSession) {
  let store = stores.get(session);
  if (!store) {
    store = createDomainStore(session);
    stores.set(session, store);
  }
  return store;
}

function createDomainStore(session: HomeSession) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let pending: Promise<void> | undefined;
  let indexes: Awaited<ReturnType<typeof readTypeIndexes>> | undefined;
  let dirty = false;
  let lastFocus = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detach: (() => void) | undefined;
  const publish = (next: Snapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const refresh = (): Promise<void> => {
    if (pending) {
      dirty = true;
      return pending;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve();
    const background = snapshot.status !== "loading";
    publish({ ...snapshot, refreshing: background });
    pending = (async () => {
      try {
        const sizes = new Map<string, number>();
        const fetch: typeof globalThis.fetch = async (input, init) => {
          const response = await session.fetch(input, init);
          const length = response.headers.get("content-length");
          if (response.ok && length !== null) sizes.set(String(input), Number(length));
          return response;
        };
        const budget = new DiscoveryBudget();
        const profileUrl = session.webId.split("#")[0] as string;
        const profile = (await readResource(fetch, profileUrl, budget.signal)).dataset;
        if (!indexes || indexes.failures.length || indexes.truncated)
          indexes = await readTypeIndexes(fetch, session.webId, profile, session.storageUrl, {
            budget,
          });
        const result = await discoverDomainItems("all", {
          fetch,
          storage: session.storageUrl,
          webId: session.webId,
          profile,
          typeIndex: indexes.locations,
          budget,
        });
        for (const item of result.items) {
          // Listing sizes include binaries that discovery deliberately does not download.
          for (const quad of item.dataset) {
            const node = subjectOf(item.dataset, quad.subject);
            const size = Number(node.texts("http://www.w3.org/ns/posix/stat#size")[0]);
            if (Number.isFinite(size) && size >= 0) sizes.set(quad.subject.value, size);
          }
        }
        const views = new Map(
          await Promise.all(
            result.items.map(
              async (item) =>
                [
                  item,
                  cardView(
                    item,
                    await typedViewData(item.dataset, item.subject, {
                      storage: session.storageUrl,
                    }),
                  ),
                ] as const,
            ),
          ),
        );
        const failures = [...indexes.failures, ...result.failures];
        const counts = new Map(
          [...DOMAINS, UNCATEGORISED].map((domain) => [
            domain.id,
            result.items.filter((item) => item.domain.id === domain.id).length,
          ]),
        );
        publish({
          status: failures.length && !result.items.length ? "error" : "ready",
          items: result.items,
          views,
          failures,
          counts,
          truncated: indexes.truncated || result.truncated,
          refreshing: false,
          used: [...sizes.values()].reduce((sum, size) => sum + size, 0),
          updated: background ? snapshot.updated + 1 : snapshot.updated,
        });
      } catch (error) {
        publish({
          ...snapshot,
          status: snapshot.items.length ? "ready" : "error",
          refreshing: false,
          failures: [{ url: session.storageUrl, error }],
        });
      } finally {
        pending = undefined;
        if (dirty) {
          dirty = false;
          void refresh();
        }
      }
    })();
    return pending;
  };
  const invalidate = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 300);
  };
  const focus = () => {
    if (Date.now() - lastFocus >= 60_000) {
      lastFocus = Date.now();
      void refresh();
    }
  };
  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        // Demo subscribe is its liveUpdates capability. Future sessions can omit it via caps.
        detach = session.caps?.liveUpdates === false ? undefined : session.subscribe(invalidate);
        if (typeof window !== "undefined") {
          window.addEventListener("focus", focus);
          window.addEventListener("online", invalidate);
        }
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          detach?.();
          clearTimeout(timer);
          if (typeof window !== "undefined") {
            window.removeEventListener("focus", focus);
            window.removeEventListener("online", invalidate);
          }
        }
      };
    },
    ensureLoaded: () => {
      if (snapshot.status === "loading" && !pending) void refresh();
    },
  };
}

export function useDomainItems(session: HomeSession) {
  const store = domainStore(session);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initial);
  useEffect(() => store.ensureLoaded(), [store]);
  return { ...snapshot, refresh: store.refresh };
}
