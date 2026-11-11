// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { TypedViewData } from "@jeswr/suite-ui";
import type { DatasetCore } from "@rdfjs/types";
import { Store } from "n3";
import { useEffect, useSyncExternalStore } from "react";
import { typedViewData } from "../../../components/typed-view-data";
import type { PodSession } from "../../../lib/session/pod-session";
import {
  type DomainItem,
  type DomainItems,
  discoverDomainItems,
  domainItemKey,
  sortItems,
} from "../lib/model/discovery";
import { DiscoveryBudget } from "../lib/model/discovery-budget";
import { DOMAINS, UNCATEGORISED } from "../lib/model/domains";
import { inStorage, readResource } from "../lib/model/rdf";
import {
  type DiscoveryFailure,
  type RegisteredLocation,
  readTypeIndexes,
} from "../lib/model/type-index";
import { cardView } from "./presentation";
import { storageUsage } from "./storage-usage";

interface Snapshot {
  status: "loading" | "ready" | "error" | "offline";
  items: readonly DomainItem[];
  views: ReadonlyMap<DomainItem, TypedViewData>;
  failures: readonly DiscoveryFailure[];
  counts: ReadonlyMap<string, number>;
  truncated: boolean;
  refreshing: boolean;
  used: number | undefined;
  updated: number;
  /** When the cards were last read from the pod (ms), for the offline "as of" line. */
  loadedAt?: number;
}
const initial: Snapshot = {
  status: "loading",
  items: [],
  views: new Map(),
  failures: [],
  counts: new Map(),
  truncated: false,
  refreshing: false,
  used: undefined,
  updated: 0,
};
/** Drops `mode` from each member of a session union, keeping the members distinct. */
type WithoutMode<T> = T extends unknown ? Omit<T, "mode"> : never;
/** Any suite pod session; `mode` also admits a direct Solid login. */
export type HomeSession = WithoutMode<PodSession> & {
  readonly mode: PodSession["mode"] | "solid";
  readonly caps?: { readonly liveUpdates: boolean };
};

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
  preserveUnvisited: (item: DomainItem) => boolean,
  /**
   * Resources read by the scan of the item's own domain. Another domain's scan may read
   * the item and discard it, which says nothing about whether it still exists.
   */
  visitedFor: (item: DomainItem) => ReadonlyMap<string, string | null>,
): DomainItem[] {
  const items = new Map(result.items.map((item) => [domainItemKey(item), item]));
  for (const item of previous) {
    const failedRead = failures.some((failure) => affectsItem(failure.url, item));
    const unvisited =
      preserveUnvisited(item) &&
      !visitedFor(item).has(item.url) &&
      (!result.listings.has(item.containerUrl) ||
        result.listings.get(item.containerUrl)?.has(item.url));
    if (
      !items.has(domainItemKey(item)) &&
      (failedRead || unvisited) &&
      !unavailable.some((url) => affectsItem(url, item))
    )
      items.set(domainItemKey(item), item);
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
  type IndexSource = { locations: readonly RegisteredLocation[]; via: readonly string[] };
  let knownIndexes = new Map<string, IndexSource>();
  const publish = (next: Snapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const refresh = (): Promise<void> => {
    if (pending) {
      dirty = true;
      return pending;
    }
    // Every session, the in-browser demo pod included, is unreachable offline: keep
    // what this tab already read, otherwise settle on the offline state.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
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
        const unavailable: string[] = [];
        // One response per request within this refresh: the per-domain scans and the
        // usage walk overlap on containers and registrations.
        const responses = new Map<string, Promise<Response>>();
        const fetch: typeof globalThis.fetch = async (input, init) => {
          const key = `${init?.method ?? "GET"} ${String(input)}`;
          let responsePromise = responses.get(key);
          if (!responsePromise) {
            responsePromise = session.fetch(input, init);
            responses.set(key, responsePromise);
          }
          const response = (await responsePromise).clone();
          // Discovery omits expected 404s; retain their outcome for cache eviction.
          if ([401, 403, 404, 410].includes(response.status)) unavailable.push(String(input));
          return response;
        };
        const profileFetch: typeof globalThis.fetch = inStorage(profileUrl, session.storageUrl)
          ? fetch
          : (input, init) =>
              globalThis.fetch(input, { ...init, credentials: "omit", redirect: "error" });
        let profile: DatasetCore = new Store();
        const profileFailures: DiscoveryFailure[] = [];
        try {
          // Profile discovery has its own deadline so a slow identity host cannot exhaust the scan.
          profile = (await readResource(profileFetch, profileUrl, AbortSignal.timeout(5_000)))
            .dataset;
        } catch (error) {
          profileFailures.push({ url: profileUrl, error });
          if (confirmedUnavailable(error)) unavailable.push(profileUrl);
        }
        const budget = new DiscoveryBudget();
        const freshIndexes = new Map<string, IndexSource>();
        const indexes = await readTypeIndexes(fetch, session.webId, profile, session.storageUrl, {
          budget,
          onIndex: (url, locations, via) => freshIndexes.set(url, { locations, via }),
        });
        // Usage is a separate, complete walk; it runs alongside discovery.
        const usage = storageUsage(fetch, session.storageUrl);
        // Independent budgets keep a large domain from starving every other domain.
        const scanned = [...DOMAINS, UNCATEGORISED];
        const domains = await Promise.all(
          scanned.map((domain) =>
            discoverDomainItems(domain, {
              fetch,
              storage: session.storageUrl,
              webId: session.webId,
              profile,
              typeIndex: indexes.locations,
            }),
          ),
        );
        const result: DomainItems = {
          items: domains.flatMap((domain) => domain.items),
          failures: [
            ...new Map(
              domains.flatMap((domain) => domain.failures).map((failure) => [failure.url, failure]),
            ).values(),
          ],
          truncated: domains.some((domain) => domain.truncated),
          etags: new Map(domains.flatMap((domain) => [...domain.etags])),
          listings: new Map(domains.flatMap((domain) => [...domain.listings])),
        };
        const failures = [...profileFailures, ...indexes.failures, ...result.failures];
        const indexFailures = [...profileFailures, ...indexes.failures];
        const preservedLocations: RegisteredLocation[] = [];
        for (const [url, source] of knownIndexes) {
          if (freshIndexes.has(url)) continue;
          const affected = indexFailures.filter((failure) =>
            [profileUrl, url, ...source.via].includes(failure.url),
          );
          if (
            (indexes.truncated || affected.length > 0) &&
            !affected.some((failure) => confirmedUnavailable(failure.error))
          ) {
            preservedLocations.push(...source.locations);
            freshIndexes.set(url, source);
          }
        }
        const items = reconcileItems(
          snapshot.items,
          result,
          failures,
          unavailable,
          (item) =>
            indexes.truncated ||
            result.truncated ||
            preservedLocations.some(
              (location) =>
                location.instance?.split("#")[0] === item.url ||
                (location.container !== undefined && inStorage(item.url, location.container)),
            ),
          (item) =>
            domains[scanned.findIndex((domain) => domain.id === item.domain.id)]?.etags ??
            result.etags,
        );
        const used = await usage;
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
        knownIndexes = freshIndexes;
        publish({
          status: failures.length && !items.length ? "error" : "ready",
          items,
          views,
          failures,
          counts: countItems(items),
          truncated: indexes.truncated || result.truncated,
          refreshing: false,
          used,
          updated: background ? snapshot.updated + 1 : snapshot.updated,
          loadedAt: Date.now(),
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
