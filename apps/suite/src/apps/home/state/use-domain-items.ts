// AUTHORED-BY Codex GPT-6
"use client";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { TypedViewData } from "@jeswr/suite-ui";
import { useEffect, useSyncExternalStore } from "react";
import { typedViewData } from "../../../components/typed-view-data";
import type { PodSession } from "../../../lib/session/pod-session";
import {
  type DomainItem,
  type DomainItems,
  discoverDomainItems,
  sortItems,
} from "../lib/model/discovery";
import { DiscoveryBudget } from "../lib/model/discovery-budget";
import { DOMAINS, UNCATEGORISED } from "../lib/model/domains";
import { inStorage, readResource, subjectOf } from "../lib/model/rdf";
import { type DiscoveryFailure, readTypeIndexes } from "../lib/model/type-index";
import { cardView } from "./presentation";

interface Snapshot {
  status: "loading" | "ready" | "error" | "offline";
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
export interface HomeSession extends Omit<PodSession, "mode"> {
  readonly mode: "demo" | "solid";
  readonly caps?: { readonly liveUpdates: boolean };
}

function affectsItem(url: string, item: DomainItem): boolean {
  return url === item.url || (url.endsWith("/") && inStorage(item.url, url));
}

function confirmedUnavailable(error: unknown): boolean {
  return error instanceof RdfFetchError && [401, 403, 404, 410].includes(error.status ?? 0);
}

function countItems(items: readonly DomainItem[]) {
  return new Map(
    [...DOMAINS, UNCATEGORISED].map((domain) => [
      domain.id,
      items.filter((item) => item.domain.id === domain.id).length,
    ]),
  );
}

/** Fresh cards win; retain a saved card only where a transient failure prevented its read. */
function reconcileItems(
  previous: readonly DomainItem[],
  result: DomainItems,
  failures: readonly DiscoveryFailure[],
  unavailable: readonly string[],
  preserveUnvisited: boolean,
): DomainItem[] {
  const key = (item: DomainItem) => `${item.url}|${item.dataType?.id}`;
  const items = new Map(result.items.map((item) => [key(item), item]));
  for (const item of previous) {
    const failedRead = failures.some((failure) => affectsItem(failure.url, item));
    const unvisited =
      preserveUnvisited && !result.etags.has(item.url) && !result.etags.has(item.containerUrl);
    if (
      !items.has(key(item)) &&
      (failedRead || unvisited) &&
      !unavailable.some((url) => affectsItem(url, item))
    )
      items.set(key(item), item);
  }
  return sortItems([...items.values()]);
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
    if (typeof navigator !== "undefined" && !navigator.onLine && session.mode !== "demo") {
      publish({
        ...snapshot,
        status: snapshot.items.length ? "ready" : "offline",
        refreshing: false,
      });
      return Promise.resolve();
    }
    const background = snapshot.status !== "loading";
    publish({ ...snapshot, refreshing: background });
    const profileUrl = session.webId.split("#")[0] as string;
    pending = (async () => {
      try {
        const sizes = new Map<string, number>();
        const unavailable: string[] = [];
        const fetch: typeof globalThis.fetch = async (input, init) => {
          const response = await session.fetch(input, init);
          // Discovery omits expected 404s; retain their outcome for cache eviction.
          if ([401, 403, 404, 410].includes(response.status)) unavailable.push(String(input));
          const length = response.headers.get("content-length");
          if (response.ok && length !== null) sizes.set(String(input), Number(length));
          return response;
        };
        const budget = new DiscoveryBudget();
        const profileFetch: typeof globalThis.fetch = inStorage(profileUrl, session.storageUrl)
          ? fetch
          : (input, init) =>
              globalThis.fetch(input, { ...init, credentials: "omit", redirect: "error" });
        const profile = (await readResource(profileFetch, profileUrl, budget.signal)).dataset;
        const indexes = await readTypeIndexes(fetch, session.webId, profile, session.storageUrl, {
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
        const failures = [...indexes.failures, ...result.failures];
        const incompleteIndexes =
          (indexes.truncated || indexes.failures.length > 0) &&
          !indexes.failures.some((failure) => confirmedUnavailable(failure.error));
        const items = reconcileItems(
          snapshot.items,
          result,
          failures,
          unavailable,
          incompleteIndexes || result.truncated,
        );
        for (const item of items) {
          // Listing sizes include binaries that discovery deliberately does not download.
          for (const quad of item.dataset) {
            const node = subjectOf(item.dataset, quad.subject);
            const size = Number(node.texts("http://www.w3.org/ns/posix/stat#size")[0]);
            if (Number.isFinite(size) && size >= 0) sizes.set(quad.subject.value, size);
          }
        }
        const views = new Map(
          await Promise.all(
            items.map(
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
        publish({
          status: failures.length && !items.length ? "error" : "ready",
          items,
          views,
          failures,
          counts: countItems(items),
          truncated: indexes.truncated || result.truncated,
          refreshing: false,
          used: [...sizes.values()].reduce((sum, size) => sum + size, 0),
          updated: background ? snapshot.updated + 1 : snapshot.updated,
        });
      } catch (error) {
        const url = error instanceof RdfFetchError ? (error.url ?? profileUrl) : profileUrl;
        const items = confirmedUnavailable(error)
          ? snapshot.items.filter((item) => !affectsItem(url, item))
          : snapshot.items;
        publish({
          ...snapshot,
          status: items.length ? "ready" : "error",
          items,
          views: new Map([...snapshot.views].filter(([item]) => items.includes(item))),
          counts: countItems(items),
          refreshing: false,
          failures: [{ url, error }],
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
